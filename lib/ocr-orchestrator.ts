import {
  getClientProfileCode,
  isVisionTableProfile,
  type ClientProfile,
} from "@/lib/client-profiles";
import { analyzeDocumentForOcr } from "@/lib/document-preprocessing";
import type { DocumentType } from "@/lib/document-type";
import { CsvAnalysisError, type CsvAnalysisResult } from "@/lib/google-ai";
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

export type OrchestratedOCRResult = CsvAnalysisResult & {
  confidence?: number;
  fallbackProvider?: OCRProviderName;
  pagesProcessed?: number;
  primaryProvider?: OCRProviderName;
  profileCode?: string;
  profileName?: string;
  providerUsed?: OCRProviderName;
  qualityStatus?: OCRQualityStatus;
  rowsExtracted?: number;
  warnings?: string[];
};

export async function runOcrExtraction(input: {
  clientProfile?: ClientProfile;
  documentType: DocumentType;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
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
  const preprocessing = await analyzeDocumentForOcr({
    fileBuffer: input.fileBuffer,
    fileName: input.fileName,
    mimeType: input.mimeType,
    profile: input.clientProfile,
  });

  console.info("[OCR] provider strategy", {
    fileName: input.fileName,
    mimeType: input.mimeType,
    primaryProvider: primaryProvider.name,
    fallbackProvider: fallbackProvider.name,
    fallbackEnabled,
    profileCode: getClientProfileCode(input.clientProfile),
    extractionMode: input.clientProfile?.extractionMode,
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
      profileCode: getClientProfileCode(input.clientProfile),
      reason: "PDF has no reliable embedded text",
    });

    try {
      return await runFallbackProviderOrThrow({
        fallbackProvider,
        input,
        pagesProcessed: preprocessing.pagesProcessed,
        preprocessing,
        primaryError: new CsvAnalysisError(
          "El PDF escaneado requiere OCR documental avanzado.",
          "SCANNED_PDF_ADVANCED_OCR_REQUIRED",
        ),
        primaryProviderName: primaryProvider.name,
      });
    } catch (advancedError) {
      console.warn("[OCR] advanced provider failed for scanned PDF; trying primary provider", {
        fileName: input.fileName,
        provider: fallbackProvider.name,
        profileCode: getClientProfileCode(input.clientProfile),
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
      ...input,
      preprocessing,
    });
  } catch (primaryError) {
    console.warn("[OCR] primary provider failed", {
      fileName: input.fileName,
      primaryProvider: primaryProvider.name,
      fallbackProvider: fallbackProvider.name,
      fallbackEnabled,
      profileCode: getClientProfileCode(input.clientProfile),
      errorName: primaryError instanceof Error ? primaryError.name : typeof primaryError,
      errorMessage:
        primaryError instanceof Error
          ? sanitizeLogText(primaryError.message).slice(0, 180)
          : "Unknown primary provider error",
    });

    if (fallbackEnabled && fallbackProvider.name !== primaryProvider.name) {
      return runFallbackProviderOrThrow({
        fallbackProvider,
        input,
        pagesProcessed: preprocessing.pagesProcessed,
        preprocessing,
        primaryError,
        primaryProviderName: primaryProvider.name,
      });
    }

    throw primaryError;
  }

  const primaryAssessment = assessOCRQuality(primaryResult, input.clientProfile, preprocessing);
  logOCRQualityAssessment({
    assessment: primaryAssessment,
    profile: input.clientProfile,
    providerUsed: primaryProvider.name,
    rowsExtracted: primaryResult.extractedRows,
  });

  if (primaryAssessment.acceptable) {
    return enrichOCRResult(primaryResult, {
      assessment: primaryAssessment,
      fallbackProvider: fallbackProvider.name,
      pagesProcessed: preprocessing.pagesProcessed,
      primaryProvider: primaryProvider.name,
      profile: input.clientProfile,
    });
  }

  if (
    shouldAllowLocalFallbackResult(
      primaryResult,
      input.clientProfile,
      fallbackEnabled,
      fallbackProvider.name,
    )
  ) {
    return enrichOCRResult(primaryResult, {
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
      profile: input.clientProfile,
    });
  }

  if (fallbackEnabled && fallbackProvider.name !== primaryProvider.name && primaryAssessment.shouldFallback) {
    console.info("[OCR] fallback required", {
      fileName: input.fileName,
      primaryProvider: primaryProvider.name,
      fallbackProvider: fallbackProvider.name,
      profileCode: getClientProfileCode(input.clientProfile),
      reason: primaryAssessment.reason,
    });

    try {
      return await runFallbackProviderOrThrow({
        fallbackProvider,
        input,
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
        profileCode: getClientProfileCode(input.clientProfile),
        errorName: fallbackError instanceof Error ? fallbackError.name : typeof fallbackError,
        errorMessage:
          fallbackError instanceof Error
            ? sanitizeLogText(fallbackError.message).slice(0, 180)
            : "Unknown fallback error",
      });

      if (
        shouldAllowLocalFallbackResult(
          primaryResult,
          input.clientProfile,
          false,
          fallbackProvider.name,
        )
      ) {
        return enrichOCRResult(primaryResult, {
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
          profile: input.clientProfile,
        });
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
  };
  pagesProcessed: number;
  preprocessing: Awaited<ReturnType<typeof analyzeDocumentForOcr>>;
  primaryError: unknown;
  primaryProviderName: OCRProviderName;
}) {
  const fallbackResult = await fallbackProvider.extract({
    ...input,
    preprocessing,
  });
  const fallbackAssessment = assessOCRQuality(fallbackResult, input.clientProfile, preprocessing);
  logOCRQualityAssessment({
    assessment: fallbackAssessment,
    profile: input.clientProfile,
    providerUsed: fallbackProvider.name,
    rowsExtracted: fallbackResult.extractedRows,
  });

  if (fallbackAssessment.acceptable) {
    return enrichOCRResult(fallbackResult, {
      assessment: fallbackAssessment,
      fallbackProvider: fallbackProvider.name,
      pagesProcessed,
      primaryProvider: primaryProviderName,
      profile: input.clientProfile,
    });
  }

  throw new CsvAnalysisError(
    "La extraccion no alcanzo la calidad minima requerida.",
    `OCR_FALLBACK_QUALITY_GATE_FAILED: ${fallbackAssessment.reason}; primary=${summarizeError(primaryError)}`,
  );
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
