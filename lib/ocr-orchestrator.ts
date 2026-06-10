import {
  getClientProfileCode,
  getClientProfileById,
  isVisionTableProfile,
  resolveDocumentTypeForProfile,
  type ClientProfile,
} from "@/lib/client-profiles";
import { analyzeDocumentForOcr } from "@/lib/document-preprocessing";
import type { DocumentType } from "@/lib/document-type";
import { CsvAnalysisError, type CsvAnalysisResult } from "@/lib/google-ai";
import {
  OCRTextOnlyError,
  withOCRTextOnlyContext,
} from "@/lib/ocr-diagnostics";
import { classifyInternalOCRProfile } from "@/lib/internal-profile-classifier";
import {
  assessOCRQuality,
  logOCRQualityAssessment,
  type OCRQualityAssessment,
  type OCRQualityStatus,
} from "@/lib/ocr-quality";
import {
  createOCRProvider,
  normalizeProviderName,
  type OCRProviderName,
  type OCRProviderResult,
} from "@/lib/ocr-providers";
import {
  runOpenAiVisualStructuring,
  shouldAttemptOpenAiVisualFallback,
} from "@/lib/openai-visual-structuring";
import {
  applyProfileRestriction,
  automaticProfileRestriction,
  OCRProfileRestrictionError,
  type OCRProfileRestriction,
  type ProfileRestrictionDecision,
  type ProfileRestrictionMode,
} from "@/lib/profile-restrictions";

export type OrchestratedOCRResult = CsvAnalysisResult & {
  confidence?: number;
  extractionType?: string;
  fallbackProvider?: OCRProviderName;
  pagesProcessed?: number;
  primaryProvider?: OCRProviderName;
  profileCode?: string;
  profileName?: string;
  providerUsed?: OCRProviderName;
  qualityStatus?: OCRQualityStatus;
  rowsExtracted?: number;
  allowedProfiles?: string[];
  detectedProfileBeforeRestriction?: string;
  forcedProfile?: string;
  restrictionMode?: ProfileRestrictionMode;
  restrictionReason?: string;
  visualStructuringProvider?: string;
  warnings?: string[];
};

export async function runOcrExtraction(input: {
  clientProfile?: ClientProfile;
  documentType: DocumentType;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  profileRestriction?: OCRProfileRestriction;
}): Promise<OrchestratedOCRResult> {
  const primaryProviderName = normalizeProviderName(process.env.OCR_PRIMARY_PROVIDER);
  const fallbackProviderName = normalizeProviderName(
    process.env.OCR_ADVANCED_PROVIDER ||
      process.env.OCR_FALLBACK_PROVIDER ||
      "advanced-document",
  );
  const fallbackEnabled = readBoolean(process.env.OCR_ENABLE_FALLBACK, true);
  const primaryProvider = createOCRProvider(primaryProviderName);
  const fallbackProvider = createOCRProvider(fallbackProviderName);
  let advancedTextOnlyError: OCRTextOnlyError | null = null;
  const preprocessing = await analyzeDocumentForOcr({
    fileBuffer: input.fileBuffer,
    fileName: input.fileName,
    mimeType: input.mimeType,
    profile: input.clientProfile,
  });
  const preliminaryRestriction =
    input.profileRestriction?.mode === "forced_profile"
      ? input.profileRestriction
      : automaticProfileRestriction();
  const preliminaryConfiguredProfile =
    preprocessing.extractedText?.trim() ||
    preliminaryRestriction.mode === "forced_profile"
      ? input.clientProfile
      : undefined;
  const initialClassification = classifyInternalOCRProfile({
    configuredProfile: preliminaryConfiguredProfile,
    fileName: input.fileName,
    hasTableSignals: preprocessing.hasTableSignals,
    restriction: preliminaryRestriction,
    text: preprocessing.extractedText,
  });
  const internalProfile = initialClassification.profile;
  const effectiveInput = {
    ...input,
    clientProfile: internalProfile,
    documentType: resolveDocumentTypeForProfile(
      initialClassification.confidence === "low" ? input.documentType : "auto",
      internalProfile,
    ),
  };

  console.info("[OCR] internal profile classified", {
    allowedProfiles: input.profileRestriction?.allowedProfiles ?? [],
    confidence: initialClassification.confidence,
    detectedProfileBeforeRestriction:
      initialClassification.detectedProfileBeforeRestriction.id,
    finalProfileUsed: getClientProfileCode(internalProfile),
    forcedProfile: input.profileRestriction?.forcedProfile,
    profileUsed: getClientProfileCode(internalProfile),
    reason: initialClassification.reason,
    restrictionMode: input.profileRestriction?.mode ?? "automatic",
    restrictionReason: initialClassification.restrictionReason,
    providerUsed: "preprocessing",
  });

  console.info("[OCR] provider strategy", {
    fileName: input.fileName,
    mimeType: input.mimeType,
    primaryProvider: primaryProvider.name,
    fallbackProvider: fallbackProvider.name,
    fallbackEnabled,
    profileCode: getClientProfileCode(internalProfile),
    extractionMode: internalProfile.extractionMode,
    documentKind: preprocessing.documentKind,
    pagesProcessed: preprocessing.pagesProcessed,
    hasTableSignals: preprocessing.hasTableSignals,
  });

  if (
    shouldPreferAdvancedProvider({
      fallbackEnabled,
      fallbackProviderName: fallbackProvider.name,
      mimeType: input.mimeType,
      preprocessing,
      primaryProviderName: primaryProvider.name,
    })
  ) {
    console.info("[OCR] scanned PDF routed to advanced provider", {
      fileName: input.fileName,
      provider: fallbackProvider.name,
      profileCode: getClientProfileCode(internalProfile),
      reason: "PDF has no reliable embedded text",
    });

    try {
      return await runFallbackProviderOrThrow({
        fallbackProvider,
        input: effectiveInput,
        pagesProcessed: preprocessing.pagesProcessed,
        preprocessing,
        primaryError: new CsvAnalysisError(
          "El PDF escaneado requiere OCR documental avanzado.",
          "SCANNED_PDF_ADVANCED_OCR_REQUIRED",
        ),
        primaryProviderName: primaryProvider.name,
      });
    } catch (advancedError) {
      if (advancedError instanceof OCRProfileRestrictionError) {
        throw advancedError;
      }

      if (advancedError instanceof OCRTextOnlyError) {
        advancedTextOnlyError = withOCRTextOnlyContext(advancedError, {
          fallbackUsed: true,
          providerUsed: fallbackProvider.name,
        });
      }

      console.warn("[OCR] advanced provider failed for scanned PDF; trying primary provider", {
        fileName: input.fileName,
        provider: fallbackProvider.name,
        profileCode: getClientProfileCode(internalProfile),
        errorName: advancedError instanceof Error ? advancedError.name : typeof advancedError,
        errorMessage:
          advancedError instanceof Error
            ? sanitizeLogText(advancedError.message).slice(0, 180)
            : "Unknown advanced provider error",
      });
    }
  }

  let primaryResult: OCRProviderResult;

  try {
    primaryResult = await primaryProvider.extract({
      ...effectiveInput,
      preprocessing,
    });
  } catch (primaryError) {
    console.warn("[OCR] primary provider failed", {
      fileName: input.fileName,
      primaryProvider: primaryProvider.name,
      fallbackProvider: fallbackProvider.name,
      fallbackEnabled,
      profileCode: getClientProfileCode(internalProfile),
      errorName: primaryError instanceof Error ? primaryError.name : typeof primaryError,
      errorMessage:
        primaryError instanceof Error
          ? sanitizeLogText(primaryError.message).slice(0, 180)
          : "Unknown primary provider error",
    });

    if (advancedTextOnlyError) {
      throw advancedTextOnlyError;
    }

    if (primaryError instanceof OCRTextOnlyError) {
      const visualAttempt = await tryOpenAiVisualFallback({
        documentAiDetectedTables:
          primaryError.diagnostic.documentAiDetectedTables,
        input: effectiveInput,
        pagesProcessed: primaryError.diagnostic.pagesProcessed,
        preprocessing,
        primaryProviderName: primaryProvider.name,
        profile: getClientProfileById(primaryError.diagnostic.profileUsed),
        rawTextContent: primaryError.diagnostic.rawTextContent,
        sourceProviderName: primaryProvider.name,
        fallbackProviderName: fallbackProvider.name,
      });

      if (visualAttempt.result) {
        return visualAttempt.result;
      }

      const primaryTextOnlyError = withOCRTextOnlyContext(primaryError, {
        fallbackUsed: false,
        multimodalFallbackAttempted: visualAttempt.attempted,
        providerUsed: primaryProvider.name,
        visualStructuringProvider: visualAttempt.attempted
          ? "openai"
          : undefined,
        warnings: [
          ...primaryError.diagnostic.warnings,
          ...visualAttempt.warnings,
        ],
      });

      if (fallbackEnabled && fallbackProvider.name !== primaryProvider.name) {
        try {
          return await runFallbackProviderOrThrow({
            fallbackProvider,
            input: effectiveInput,
            pagesProcessed: preprocessing.pagesProcessed,
            preprocessing,
            primaryError,
            primaryProviderName: primaryProvider.name,
          });
        } catch (fallbackError) {
          if (fallbackError instanceof OCRTextOnlyError) {
            throw fallbackError;
          }

          throw primaryTextOnlyError;
        }
      }

      throw primaryTextOnlyError;
    }

    if (fallbackEnabled && fallbackProvider.name !== primaryProvider.name) {
      return runFallbackProviderOrThrow({
        fallbackProvider,
        input: effectiveInput,
        pagesProcessed: preprocessing.pagesProcessed,
        preprocessing,
        primaryError,
        primaryProviderName: primaryProvider.name,
      });
    }

    throw primaryError;
  }

  const detectedResultProfile = primaryResult.internalProfile ?? internalProfile;
  const restrictionDecision = applyProfileRestriction(
    detectedResultProfile,
    input.profileRestriction,
  );
  const resultProfile = restrictionDecision.finalProfile;
  logProfileRestrictionDecision(restrictionDecision);
  const primaryAssessment = assessOCRQuality(primaryResult, resultProfile, preprocessing);
  logOCRQualityAssessment({
    assessment: primaryAssessment,
    profile: resultProfile,
    providerUsed: primaryProvider.name,
    rowsExtracted: primaryResult.extractedRows,
  });

  if (primaryAssessment.acceptable) {
    return withRestrictionMetadata(enrichOCRResult(primaryResult, {
      assessment: primaryAssessment,
      fallbackProvider: fallbackProvider.name,
      pagesProcessed: preprocessing.pagesProcessed,
      primaryProvider: primaryProvider.name,
      profile: resultProfile,
    }), restrictionDecision);
  }

  if (primaryProvider.name === "google-document-ai" && primaryResult.rawTextContent) {
    const visualAttempt = await tryOpenAiVisualFallback({
      documentAiDetectedTables: primaryResult.documentAiDetectedTables,
      input: effectiveInput,
      pagesProcessed: primaryResult.pagesProcessed ?? preprocessing.pagesProcessed,
      preprocessing,
      primaryProviderName: primaryProvider.name,
      profile: resultProfile,
      rawTextContent: primaryResult.rawTextContent,
      sourceProviderName: primaryProvider.name,
      fallbackProviderName: fallbackProvider.name,
    });

    if (visualAttempt.result) {
      return visualAttempt.result;
    }

    throw new OCRTextOnlyError({
      canDownloadRawText: true,
      companyPersonnelQualityMetrics:
        primaryResult.companyPersonnelQualityMetrics,
      documentAiDetectedTables: primaryResult.documentAiDetectedTables,
      extractionMode: "ocr_text_only",
      fallbackUsed: false,
      multimodalFallbackAttempted: visualAttempt.attempted,
      orientationSelected: primaryResult.orientationSelected,
      pagesProcessed: primaryResult.pagesProcessed ?? preprocessing.pagesProcessed,
      profileUsed: getClientProfileCode(resultProfile),
      providerUsed: primaryProvider.name,
      qualityScore: primaryAssessment.confidence,
      qualityStatus: primaryAssessment.requiresManualReview
        ? "manual_review_required"
        : "failed_quality_gate",
      rawTextContent: primaryResult.rawTextContent,
      reason: primaryAssessment.reason,
      textLength: primaryResult.textLength ?? primaryResult.rawTextContent.length,
      visualStructuringProvider: visualAttempt.attempted ? "openai" : undefined,
      warnings: [
        ...primaryAssessment.warnings,
        ...visualAttempt.warnings,
      ],
    });
  }

  if (advancedTextOnlyError) {
    throw advancedTextOnlyError;
  }

  if (
    shouldAllowLocalFallbackResult(
      primaryResult,
      resultProfile,
      fallbackEnabled,
      fallbackProvider.name,
    )
  ) {
    return withRestrictionMetadata(enrichOCRResult(primaryResult, {
      assessment: {
        ...primaryAssessment,
        acceptable: true,
        qualityStatus: "completed_with_warnings",
        reason: "Local PDF text fallback accepted as last safety net",
        requiresManualReview: false,
        shouldFallback: false,
        warnings: [
          ...primaryAssessment.warnings,
          "Extraccion basica generada desde texto local del PDF.",
        ],
      },
      fallbackProvider: fallbackProvider.name,
      pagesProcessed: preprocessing.pagesProcessed,
      primaryProvider: primaryProvider.name,
      profile: resultProfile,
    }), restrictionDecision);
  }

  if (fallbackEnabled && fallbackProvider.name !== primaryProvider.name && primaryAssessment.shouldFallback) {
    console.info("[OCR] fallback required", {
      fileName: input.fileName,
      primaryProvider: primaryProvider.name,
      fallbackProvider: fallbackProvider.name,
      profileCode: getClientProfileCode(resultProfile),
      reason: primaryAssessment.reason,
    });

    try {
      return await runFallbackProviderOrThrow({
        fallbackProvider,
        input: {
          ...effectiveInput,
          clientProfile: resultProfile,
        },
        pagesProcessed: preprocessing.pagesProcessed,
        preprocessing,
        primaryError: new CsvAnalysisError(
          "La extraccion primaria no alcanzo la calidad minima requerida.",
          primaryAssessment.reason,
        ),
        primaryProviderName: primaryProvider.name,
      });
    } catch (fallbackError) {
      console.warn("[OCR] fallback provider failed", {
        fileName: input.fileName,
        provider: fallbackProvider.name,
        profileCode: getClientProfileCode(resultProfile),
        errorName: fallbackError instanceof Error ? fallbackError.name : typeof fallbackError,
        errorMessage:
          fallbackError instanceof Error
            ? sanitizeLogText(fallbackError.message).slice(0, 180)
            : "Unknown fallback error",
      });

      if (
        shouldAllowLocalFallbackResult(
          primaryResult,
          resultProfile,
          false,
          fallbackProvider.name,
        )
      ) {
        return withRestrictionMetadata(enrichOCRResult(primaryResult, {
          assessment: {
            ...primaryAssessment,
            acceptable: true,
            qualityStatus: "completed_with_warnings",
            reason: "Advanced OCR fallback unavailable; local PDF fallback accepted",
            requiresManualReview: false,
            shouldFallback: false,
            warnings: [
              ...primaryAssessment.warnings,
              "Proveedor OCR avanzado no disponible; se entrego fallback local.",
            ],
          },
          fallbackProvider: fallbackProvider.name,
          pagesProcessed: preprocessing.pagesProcessed,
          primaryProvider: primaryProvider.name,
          profile: resultProfile,
        }), restrictionDecision);
      }
    }
  }

  throw new CsvAnalysisError(
    primaryAssessment.requiresManualReview
      ? "El documento requiere revision manual antes de exportarse."
      : "La extraccion no alcanzo la calidad minima requerida.",
    `OCR_QUALITY_GATE_FAILED: ${primaryAssessment.reason}`,
  );
}

async function runFallbackProviderOrThrow({
  fallbackProvider,
  input,
  pagesProcessed,
  preprocessing,
  primaryError,
  primaryProviderName,
}: {
  fallbackProvider: ReturnType<typeof createOCRProvider>;
  input: {
    clientProfile?: ClientProfile;
    documentType: DocumentType;
    fileBuffer: Buffer;
    fileName: string;
    mimeType: string;
    profileRestriction?: OCRProfileRestriction;
  };
  pagesProcessed: number;
  preprocessing: Awaited<ReturnType<typeof analyzeDocumentForOcr>>;
  primaryError: unknown;
  primaryProviderName: OCRProviderName;
}) {
  let fallbackResult: OCRProviderResult;

  try {
    fallbackResult = await fallbackProvider.extract({
      ...input,
      preprocessing,
    });
  } catch (error) {
    if (error instanceof OCRTextOnlyError) {
      const visualAttempt = await tryOpenAiVisualFallback({
        documentAiDetectedTables: error.diagnostic.documentAiDetectedTables,
        fallbackProviderName: fallbackProvider.name,
        input,
        pagesProcessed: error.diagnostic.pagesProcessed || pagesProcessed,
        preprocessing,
        primaryProviderName,
        profile: getClientProfileById(error.diagnostic.profileUsed),
        rawTextContent: error.diagnostic.rawTextContent,
        sourceProviderName: fallbackProvider.name,
      });

      if (visualAttempt.result) {
        return visualAttempt.result;
      }

      throw withOCRTextOnlyContext(error, {
        fallbackUsed: fallbackProvider.name !== primaryProviderName,
        multimodalFallbackAttempted: visualAttempt.attempted,
        providerUsed: fallbackProvider.name,
        visualStructuringProvider: visualAttempt.attempted
          ? "openai"
          : undefined,
        warnings: [
          ...error.diagnostic.warnings,
          ...visualAttempt.warnings,
        ],
      });
    }

    throw error;
  }
  const detectedFallbackProfile =
    fallbackResult.internalProfile ?? input.clientProfile ?? getClientProfileById("internal-general");
  const restrictionDecision = applyProfileRestriction(
    detectedFallbackProfile,
    input.profileRestriction,
  );
  const fallbackProfile = restrictionDecision.finalProfile;
  logProfileRestrictionDecision(restrictionDecision);
  const fallbackAssessment = assessOCRQuality(fallbackResult, fallbackProfile, preprocessing);
  let multimodalFallbackAttempted = false;
  let multimodalWarnings: string[] = [];
  logOCRQualityAssessment({
    assessment: fallbackAssessment,
    profile: fallbackProfile,
    providerUsed: fallbackProvider.name,
    rowsExtracted: fallbackResult.extractedRows,
  });

  if (fallbackAssessment.acceptable) {
    return withRestrictionMetadata(enrichOCRResult(fallbackResult, {
      assessment: fallbackAssessment,
      fallbackProvider: fallbackProvider.name,
      pagesProcessed,
      primaryProvider: primaryProviderName,
      profile: fallbackProfile,
    }), restrictionDecision);
  }

  if (
    fallbackProvider.name === "google-document-ai" &&
    fallbackResult.rawTextContent
  ) {
    const visualAttempt = await tryOpenAiVisualFallback({
      documentAiDetectedTables: fallbackResult.documentAiDetectedTables,
      fallbackProviderName: fallbackProvider.name,
      input,
      pagesProcessed: fallbackResult.pagesProcessed ?? pagesProcessed,
      preprocessing,
      primaryProviderName,
      profile: fallbackProfile,
      rawTextContent: fallbackResult.rawTextContent,
      sourceProviderName: fallbackProvider.name,
    });

    if (visualAttempt.result) {
      return visualAttempt.result;
    }

    if (visualAttempt.attempted) {
      multimodalFallbackAttempted = true;
      multimodalWarnings = visualAttempt.warnings;
    }
  }

  if (fallbackResult.rawTextContent) {
    throw new OCRTextOnlyError({
      canDownloadRawText: true,
      companyPersonnelQualityMetrics:
        fallbackResult.companyPersonnelQualityMetrics,
      documentAiDetectedTables: fallbackResult.documentAiDetectedTables,
      extractionMode: "ocr_text_only",
      fallbackUsed: fallbackProvider.name !== primaryProviderName,
      multimodalFallbackAttempted,
      orientationSelected: fallbackResult.orientationSelected,
      pagesProcessed: fallbackResult.pagesProcessed ?? pagesProcessed,
      profileUsed: getClientProfileCode(fallbackProfile),
      providerUsed: fallbackProvider.name,
      qualityScore: fallbackAssessment.confidence,
      qualityStatus: fallbackAssessment.requiresManualReview
        ? "manual_review_required"
        : "failed_quality_gate",
      rawTextContent: fallbackResult.rawTextContent,
      reason: fallbackAssessment.reason,
      textLength: fallbackResult.textLength ?? fallbackResult.rawTextContent.length,
      visualStructuringProvider: multimodalFallbackAttempted
        ? "openai"
        : undefined,
      warnings: [
        ...fallbackAssessment.warnings,
        ...multimodalWarnings,
      ],
    });
  }

  throw new CsvAnalysisError(
    "La extraccion no alcanzo la calidad minima requerida.",
    `OCR_FALLBACK_QUALITY_GATE_FAILED: ${fallbackAssessment.reason}; primary=${summarizeError(primaryError)}`,
  );
}

async function tryOpenAiVisualFallback(input: {
  documentAiDetectedTables?: boolean;
  fallbackProviderName: OCRProviderName;
  input: {
    clientProfile?: ClientProfile;
    documentType: DocumentType;
    fileBuffer: Buffer;
    fileName: string;
    mimeType: string;
    profileRestriction?: OCRProfileRestriction;
  };
  pagesProcessed: number;
  preprocessing: Awaited<ReturnType<typeof analyzeDocumentForOcr>>;
  primaryProviderName: OCRProviderName;
  profile?: ClientProfile;
  rawTextContent: string;
  sourceProviderName: OCRProviderName;
}): Promise<{
  attempted: boolean;
  result: OrchestratedOCRResult | null;
  warnings: string[];
}> {
  const eligible =
    input.sourceProviderName === "google-document-ai" &&
    shouldAttemptOpenAiVisualFallback({
      documentAiDetectedTables: input.documentAiDetectedTables,
      mimeType: input.input.mimeType,
      preprocessing: input.preprocessing,
      qualityGateFailed: true,
      rawTextContent: input.rawTextContent,
    });

  if (!eligible) {
    return {
      attempted: false,
      result: null,
      warnings: [],
    };
  }

  console.info("[OCR] multimodal fallback selected", {
    provider: "openai",
    pagesAnalyzed: input.pagesProcessed,
    profileUsed: getClientProfileCode(input.profile),
    fallbackUsed: true,
    reason: input.documentAiDetectedTables
      ? "Document AI structure did not pass quality gate"
      : "Document AI recovered text without explicit tables",
  });

  try {
    const visualResult = await runOpenAiVisualStructuring({
      documentType: input.input.documentType,
      fileBuffer: input.input.fileBuffer,
      fileName: input.input.fileName,
      mimeType: input.input.mimeType,
      pagesProcessed: input.pagesProcessed,
      preprocessing: input.preprocessing,
      profile: input.profile,
      rawTextContent: input.rawTextContent,
    });
    const providerResult: OCRProviderResult = {
      ...visualResult,
      documentAiDetectedTables: input.documentAiDetectedTables,
      internalProfile: input.profile,
      providerUsed: "google-document-ai",
      rawTextContent: input.rawTextContent,
      textLength: input.rawTextContent.length,
    };
    const assessment = assessOCRQuality(
      providerResult,
      input.profile,
      input.preprocessing,
    );

    logOCRQualityAssessment({
      assessment,
      profile: input.profile,
      providerUsed: "openai-visual-structuring",
      rowsExtracted: providerResult.extractedRows,
    });

    console.info("[OCR] multimodal fallback quality", {
      provider: "openai",
      pagesAnalyzed: providerResult.pagesProcessed ?? input.pagesProcessed,
      profileUsed: getClientProfileCode(input.profile),
      qualityScore: assessment.confidence,
      qualityStatus: assessment.qualityStatus,
      rowsExtracted: providerResult.extractedRows,
      fallbackUsed: true,
      warnings: assessment.warnings.length,
    });

    if (!assessment.acceptable) {
      return {
        attempted: true,
        result: null,
        warnings: [
          `La interpretacion visual avanzada no supero calidad: ${assessment.reason}`,
        ],
      };
    }

    return {
      attempted: true,
      result: withRestrictionMetadata(enrichOCRResult(providerResult, {
        assessment,
        fallbackProvider: input.fallbackProviderName,
        pagesProcessed: providerResult.pagesProcessed ?? input.pagesProcessed,
        primaryProvider: input.primaryProviderName,
        profile: input.profile,
      }), applyProfileRestriction(
        input.profile ?? getClientProfileById("internal-general"),
        input.input.profileRestriction,
      )),
      warnings: [],
    };
  } catch (error) {
    console.warn("[OCR] multimodal fallback failed", {
      provider: "openai",
      pagesAnalyzed: input.pagesProcessed,
      profileUsed: getClientProfileCode(input.profile),
      fallbackUsed: true,
      errorName: error instanceof Error ? error.name : typeof error,
    });

    return {
      attempted: true,
      result: null,
      warnings: ["La interpretacion visual avanzada no pudo completarse."],
    };
  }
}

function enrichOCRResult(
  result: OCRProviderResult,
  context: {
    assessment: OCRQualityAssessment;
    fallbackProvider: OCRProviderName;
    pagesProcessed: number;
    primaryProvider: OCRProviderName;
    profile?: ClientProfile;
  },
): OrchestratedOCRResult {
  return {
    ...result,
    confidence: context.assessment.confidence,
    extractionType: context.profile?.userFacingExtractionType,
    fallbackProvider: context.fallbackProvider,
    pagesProcessed: result.pagesProcessed ?? context.pagesProcessed,
    primaryProvider: context.primaryProvider,
    profileCode: getClientProfileCode(context.profile),
    profileName: context.profile?.label,
    providerUsed: result.providerUsed,
    qualityStatus: context.assessment.qualityStatus,
    rowsExtracted: result.extractedRows,
    warnings: context.assessment.warnings,
  };
}

function withRestrictionMetadata(
  result: OrchestratedOCRResult,
  decision: ProfileRestrictionDecision,
): OrchestratedOCRResult {
  return {
    ...result,
    allowedProfiles: decision.allowedProfiles,
    detectedProfileBeforeRestriction:
      decision.detectedProfileBeforeRestriction.id,
    forcedProfile: decision.forcedProfile,
    profileCode: decision.finalProfile.id,
    profileName: decision.finalProfile.label,
    restrictionMode: decision.restrictionMode,
    restrictionReason: decision.restrictionReason,
  };
}

function logProfileRestrictionDecision(
  decision: ProfileRestrictionDecision,
) {
  console.info("[OCR] profile restriction decision", {
    allowedProfiles: decision.allowedProfiles,
    detectedProfileBeforeRestriction:
      decision.detectedProfileBeforeRestriction.id,
    finalProfileUsed: decision.finalProfile.id,
    forcedProfile: decision.forcedProfile,
    restrictionMode: decision.restrictionMode,
    restrictionReason: decision.restrictionReason,
  });
}

function shouldAllowLocalFallbackResult(
  result: CsvAnalysisResult,
  profile: ClientProfile | undefined,
  fallbackEnabled: boolean,
  fallbackProviderName: OCRProviderName,
) {
  if (isVisionTableProfile(profile)) return false;
  if (fallbackProviderName === "google-document-ai") return false;
  if (fallbackEnabled) return false;

  return result.resultQuality === "local-fallback" || result.modelUsed.includes("local pdf text fallback");
}

function shouldPreferAdvancedProvider(input: {
  fallbackEnabled: boolean;
  fallbackProviderName: OCRProviderName;
  mimeType: string;
  preprocessing: Awaited<ReturnType<typeof analyzeDocumentForOcr>>;
  primaryProviderName: OCRProviderName;
}) {
  return (
    input.fallbackEnabled &&
    input.mimeType === "application/pdf" &&
    input.preprocessing.documentKind === "scanned_pdf" &&
    input.fallbackProviderName === "google-document-ai" &&
    input.fallbackProviderName !== input.primaryProviderName
  );
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().replace(/^['"]|['"]$/g, "").toLowerCase();

  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function sanitizeLogText(value: string) {
  return value.replace(/\s+/g, " ").replace(/</g, "<").replace(/>/g, ">").trim();
}

function summarizeError(error: unknown) {
  if (error instanceof CsvAnalysisError) return error.technicalDetail;
  if (error instanceof Error) return sanitizeLogText(error.message).slice(0, 180);
  return "Unknown primary OCR error";
}
