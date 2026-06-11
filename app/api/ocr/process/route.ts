import { del, get, head } from "@vercel/blob";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAccessCookieName, verifyAccessCookie } from "@/lib/access-code";
import {
  getAccessSessionCookieName,
  verifyAccessSessionCookie,
  type AccessSessionPayload,
} from "@/lib/access-session";
import { auth } from "@/lib/auth";
import {
  getClientProfileCode,
  getClientProfileById,
  getClientProfileCookieName,
  isVisionTableProfile,
  resolveDocumentTypeForProfile,
  verifyClientProfileCookie,
  type ClientProfile,
} from "@/lib/client-profiles";
import { createCsvFileName, type CsvFileKind } from "@/lib/csv";
import { parseCsvPreview } from "@/lib/csv-preview";
import { detectDocumentTypeFromFileMetadata } from "@/lib/document-detection";
import type { DocumentType } from "@/lib/document-type";
import { createExtractionMetadata } from "@/lib/extraction-metadata";
import {
  CsvAnalysisError,
  GoogleAiTemporaryError,
  StructuredOutputError,
} from "@/lib/google-ai";
import { prepareImageForOcr } from "@/lib/image-optimization";
import {
  getOcrBlobUploadPrefix,
  isAllowedOcrBlobContentType,
  isOwnedOcrBlobPathname,
  normalizeOcrBlobContentType,
} from "@/lib/ocr-blob";
import { OCRTextOnlyError } from "@/lib/ocr-diagnostics";
import { isAgenticTableModeEnabled } from "@/lib/agentic-table-extraction";
import { runOcrExtraction } from "@/lib/ocr-orchestrator";
import type { OCRQualityStatus } from "@/lib/ocr-quality";
import {
  normalizeProfileRestriction,
  OCRProfileRestrictionError,
  type ProfileRestrictionMode,
} from "@/lib/profile-restrictions";
import {
  createLocalPdfTextFallbackFromBuffer,
  createLocalPdfTextFallbackResult,
} from "@/lib/pdf-local-fallback";
import { extractPdfTextByPages } from "@/lib/pdf-text";
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIp,
  getOcrRateLimitConfig,
  type RateLimitResult,
} from "@/lib/rate-limit";
import {
  getMaxSizeMbForMimeType,
  getFileSizeLimitMessage,
} from "@/lib/validations";
import {
  getOcrUsageContext,
  getPlanAwareMaxSizeMb,
  recordUsageEvent,
  type OcrPlanContext,
} from "@/lib/usage";
import { createXlsxBase64 } from "@/lib/xlsx-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const startedAt = Date.now();
  let usageContext: OcrPlanContext | null = null;
  let originalFileName = "";
  let originalMimeType = "";
  let originalFileSize = 0;
  let estimatedDocumentType: DocumentType = "auto";
  let accessSessionForUsage: AccessSessionPayload | null = null;
  let blobPathnameToDelete = "";

  console.info("OCR_PROCESS_ROUTE_REACHED", {
    method: request.method,
    pathname: new URL(request.url).pathname,
    contentType: request.headers.get("content-type"),
  });

  try {
    console.info("[OCR API] env flags", {
      forceLocalPdfFallback: process.env.FORCE_LOCAL_PDF_FALLBACK,
      nodeEnv: process.env.NODE_ENV,
    });

    const session = await auth();
    const clientIp = getClientIp(request.headers);
    const rateLimitConfig = getOcrRateLimitConfig();
    const rateLimit = await checkRateLimit({
      namespace: "ocr-process",
      key: session?.user?.email ? `user:${session.user.email}` : `ip:${clientIp}`,
      ...rateLimitConfig,
    });

    if (!rateLimit.allowed) {
      return jsonResponse(
        {
          success: false,
          error: "Demasiadas solicitudes. Esperá unos minutos e intentá nuevamente.",
        },
        429,
        rateLimit,
      );
    }

    if (!session?.user) {
      return jsonResponse(
        { success: false, error: "No autorizado. Iniciá sesión para procesar documentos." },
        401,
        rateLimit,
      );
    }

    const cookieStore = await cookies();
    const hasAccess = verifyAccessCookie(cookieStore.get(getAccessCookieName())?.value);
    const accessSession = verifyAccessSessionCookie(
      cookieStore.get(getAccessSessionCookieName())?.value,
    );
    accessSessionForUsage = accessSession;
    let clientProfile = verifyClientProfileCookie(
      cookieStore.get(getClientProfileCookieName())?.value,
    );

    if (!hasAccess) {
      return jsonResponse(
        {
          success: false,
          error: "Acceso no habilitado. Ingresá tu código privado para usar el servicio.",
        },
        403,
        rateLimit,
      );
    }

    const usageCheck = await getOcrUsageContext(accessSession);

    if (!usageCheck.allowed) {
      await recordUsageEvent({
        context: usageCheck.context,
        durationMs: Date.now() - startedAt,
        errorType: "usage_limit_reached",
        isInternalTest: accessSession?.isInternalTest,
        status: "error",
      });

      return jsonResponse(
        {
          success: false,
          error: usageCheck.message,
        },
        usageCheck.status,
        rateLimit,
      );
    }

    usageContext = usageCheck.context;
    let profileRestriction =
      usageContext?.profileRestriction ??
      normalizeProfileRestriction({
        allowedProfiles: accessSession?.allowedProfiles,
        forcedProfile: accessSession?.forcedProfile,
        mode: accessSession?.restrictionMode,
      });

    const contentType = request.headers.get("content-type") || "";

    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse(
        {
          success: false,
          error: "La solicitud debe enviar una referencia segura de Vercel Blob.",
        },
        400,
        rateLimit,
      );
    }

    const payload = await readBlobProcessRequest(request);
    const detectedDocumentType = detectDocumentTypeFromFileMetadata({
      fileName: payload.originalFileName,
      mimeType: payload.mimeType,
    }).detectedType;
    const testProfileId = normalizeTestProfileId(payload.profile);

    if (accessSession?.allowProfileTesting && testProfileId) {
      clientProfile = getClientProfileById(testProfileId);
      if (clientProfile.id !== "internal-general") {
        profileRestriction = normalizeProfileRestriction({
          forcedProfile: clientProfile.id,
          mode: "forced_profile",
        });
      }
      console.info("[OCR API] master test profile selected", {
        profileId: clientProfile.id,
        profileCode: getClientProfileCode(clientProfile),
        accessMode: accessSession.accessMode,
      });
    }

    if (payload.size <= 0) {
      return jsonResponse(
        { success: false, error: "El archivo está vacío. Seleccioná otro archivo." },
        400,
        rateLimit,
      );
    }

    const requestedMimeType = normalizeOcrBlobContentType(payload.mimeType);

    if (!isAllowedOcrBlobContentType(requestedMimeType)) {
      return jsonResponse(
        { success: false, error: "Subí un archivo PDF, JPG o PNG para continuar." },
        400,
        rateLimit,
      );
    }

    const expectedBlobPrefix = getOcrBlobUploadPrefix(
      session.user.email ?? "",
      accessSession,
    );

    if (!isOwnedOcrBlobPathname(payload.pathname, expectedBlobPrefix)) {
      return jsonResponse(
        {
          success: false,
          error: "La referencia del archivo no es válida para esta sesión.",
        },
        403,
        rateLimit,
      );
    }

    console.info("OCR_RECEIVED_BLOB_REFERENCE", {
      pathname: payload.pathname,
      originalFileName: sanitizeOriginalFileName(payload.originalFileName),
      mimeType: requestedMimeType,
      size: payload.size,
    });

    blobPathnameToDelete = payload.pathname;
    const blobMetadata = await head(payload.pathname);

    if (
      blobMetadata.pathname !== payload.pathname ||
      blobMetadata.url !== payload.blobUrl ||
      !isOwnedOcrBlobPathname(blobMetadata.pathname, expectedBlobPrefix) ||
      blobMetadata.size !== payload.size
    ) {
      return jsonResponse(
        { success: false, error: "La referencia del archivo no pudo validarse." },
        400,
        rateLimit,
      );
    }

    const blobMimeType = normalizeOcrBlobContentType(blobMetadata.contentType);

    if (
      !isAllowedOcrBlobContentType(blobMimeType) ||
      blobMimeType !== requestedMimeType
    ) {
      return jsonResponse(
        {
          success: false,
          error: "El tipo del archivo cargado no coincide con la solicitud.",
        },
        400,
        rateLimit,
      );
    }

    originalFileName = sanitizeOriginalFileName(payload.originalFileName);
    originalMimeType = blobMimeType;
    originalFileSize = blobMetadata.size;

    logApiTiming("validation", startedAt, {
      fileName: originalFileName,
      strategy: "request-validation",
    });

    console.info("BLOB_DOWNLOAD_STARTED", {
      pathname: payload.pathname,
      size: blobMetadata.size,
    });

    const blobResult = await get(payload.pathname, {
      access: "private",
      useCache: false,
    });

    if (!blobResult || blobResult.statusCode !== 200 || !blobResult.stream) {
      throw new CsvAnalysisError(
        "No pudimos recuperar el archivo cargado.",
        "BLOB_DOWNLOAD_FAILED",
      );
    }

    let fileBuffer: Buffer = Buffer.from(
      await new Response(blobResult.stream).arrayBuffer(),
    );
    console.info("BLOB_DOWNLOAD_COMPLETED", {
      pathname: payload.pathname,
      downloadedBytes: fileBuffer.byteLength,
    });
    let mimeType = blobMimeType;
    const documentType =
      isAgenticTableModeEnabled() &&
      profileRestriction.mode !== "forced_profile"
        ? "auto"
        : resolveDocumentTypeForProfile(detectedDocumentType, clientProfile);
    estimatedDocumentType = documentType;
    const globalSizeLimitMb = getMaxSizeMbForMimeType(mimeType);
    const effectiveSizeLimitMb = getPlanAwareMaxSizeMb(mimeType, usageContext, globalSizeLimitMb);

    if (blobMetadata.size > effectiveSizeLimitMb * 1024 * 1024) {
      await recordUsageEvent({
        context: usageContext,
        durationMs: Date.now() - startedAt,
        errorType: "file_size_limit",
        estimatedDocumentType,
        fileMimeType: mimeType,
        fileSizeBytes: blobMetadata.size,
        isInternalTest: accessSession?.isInternalTest,
        originalFileName,
        status: "error",
      });

      return jsonResponse(
        {
          success: false,
          error: usageContext
            ? getPlanFileSizeLimitMessage(mimeType, effectiveSizeLimitMb)
            : getFileSizeLimitMessage(mimeType),
        },
        400,
        rateLimit,
      );
    }

    if (mimeType === "image/jpeg" || mimeType === "image/png") {
      const optimizationStartedAt = Date.now();
      const optimizedImage = await prepareImageForOcr(fileBuffer, mimeType);

      if (optimizedImage) {
        fileBuffer = optimizedImage.buffer;
        mimeType = optimizedImage.mimeType;
        logApiTiming("image-optimization", optimizationStartedAt, {
          fileName: originalFileName,
          strategy: "image-optimization",
        });
      }
    }

    console.info("[OCR API] request received", {
      fileName: originalFileName,
      mimeType,
      size: blobMetadata.size,
      documentType,
      clientProfileId:
        profileRestriction.mode === "forced_profile"
          ? clientProfile.id
          : "universal-document",
      transport: "vercel-blob",
    });

    if (
      isForceLocalPdfFallbackEnabled() &&
      mimeType === "application/pdf" &&
      !isVisionTableProfile(clientProfile)
    ) {
      console.info("[OCR API] FORCE_LOCAL_PDF_FALLBACK enabled", {
        fileName: originalFileName,
        mimeType,
        size: blobMetadata.size,
      });

      const extractionStartedAt = Date.now();
      const extraction = await extractPdfTextByPages(fileBuffer);
      logApiTiming("pdf-text-extraction", extractionStartedAt, {
        fileName: originalFileName,
        strategy: "local-fallback",
      });

      console.info("[OCR API] forced local extraction result", {
        pages: extraction.pages.length,
        totalTextLength: extraction.totalTextLength,
      });

      if (extraction.totalTextLength <= 0) {
        return jsonResponse(
          {
            success: false,
            error: "No se pudo extraer texto del PDF para generar el CSV local.",
          },
          422,
          rateLimit,
        );
      }

      const fallbackStartedAt = Date.now();
      const fallback = createLocalPdfTextFallbackResult({
        pages: extraction.pages,
        originalFileName,
        totalTextLength: extraction.totalTextLength,
      });
      logApiTiming("fallback-local", fallbackStartedAt, {
        fileName: originalFileName,
        strategy: "local-fallback",
      });

      if (!fallback) {
        return jsonResponse(
          {
            success: false,
            error: "No se pudo extraer texto del PDF para generar el CSV local.",
          },
          422,
          rateLimit,
        );
      }

      console.info("[OCR API] forced local fallback success", {
        extractedRows: fallback.extractedRows,
        modelUsed: fallback.modelUsed,
      });

      return successResponse(
        {
          csvContent: fallback.csvContent,
          fileName: fallback.fileName,
          extractedRows: fallback.extractedRows,
          modelUsed: fallback.modelUsed,
          resultQuality: fallback.resultQuality,
        },
        startedAt,
        rateLimit,
        originalFileName,
        "local-fallback",
        {
          clientProfile,
          documentType,
          accessSession,
          usageContext,
          sourceFileSize: blobMetadata.size,
          sourceMimeType: mimeType,
        },
      );
    }

    try {
      console.info("[OCR API] calling OCR orchestrator");
      const analysisStartedAt = Date.now();
      const analysis = await runOcrExtraction({
        clientProfile,
        documentType,
        fileBuffer,
        fileName: originalFileName,
        mimeType,
        profileRestriction,
      });
      logApiTiming(
        mimeType === "application/pdf" ? "direct-file-analysis" : "direct-file-analysis",
        analysisStartedAt,
        {
          fileName: originalFileName,
          model: analysis.modelUsed,
          strategy: "ocr-analysis",
        },
      );

      console.info("[OCR API] OCR orchestrator success", {
        modelUsed: analysis.modelUsed,
        providerUsed: analysis.providerUsed,
        visualStructuringProvider: analysis.visualStructuringProvider,
        qualityStatus: analysis.qualityStatus,
        confidence: analysis.confidence,
        extractedRows: analysis.extractedRows,
        csvLength: analysis.csvContent?.length ?? 0,
      });

      return successResponse(analysis, startedAt, rateLimit, originalFileName, "ocr-analysis", {
        clientProfile,
        documentType,
        accessSession,
        usageContext,
        sourceFileSize: blobMetadata.size,
        sourceMimeType: mimeType,
      });
    } catch (analysisError) {
      console.warn("[OCR API] OCR orchestrator failed", getSafeErrorLog(analysisError));

      if (analysisError instanceof OCRTextOnlyError) {
        throw analysisError;
      }

      if (
        isProfileExtractionValidationError(analysisError) ||
        isAiOutputQualityLowError(analysisError) ||
        isOcrQualityGateError(analysisError)
      ) {
        throw analysisError;
      }

      if (
        mimeType === "application/pdf" &&
        !isVisionTableProfile(clientProfile) &&
        (!isAgenticTableModeEnabled() ||
          profileRestriction.mode === "forced_profile")
      ) {
        try {
          const fallbackStartedAt = Date.now();
          const fallback = await createLocalPdfTextFallbackFromBuffer(
            fileBuffer,
            originalFileName,
          );
          logApiTiming("fallback-local", fallbackStartedAt, {
            fileName: originalFileName,
            strategy: "local-fallback",
          });

          if (fallback) {
            console.info("[OCR API] endpoint local fallback success", {
              modelUsed: fallback.modelUsed,
              extractedRows: fallback.extractedRows,
              pageCount: fallback.pageCount,
              totalTextLength: fallback.totalTextLength,
              csvLength: fallback.csvContent.length,
            });

            return successResponse(
              {
                csvContent: fallback.csvContent,
                fileName: fallback.fileName,
                extractedRows: fallback.extractedRows,
                modelUsed: fallback.modelUsed,
                resultQuality: fallback.resultQuality,
              },
              startedAt,
              rateLimit,
              originalFileName,
              "local-fallback",
              {
                clientProfile,
                documentType,
                accessSession,
                usageContext,
                sourceFileSize: blobMetadata.size,
                sourceMimeType: mimeType,
              },
            );
          }

          console.warn("[OCR API] endpoint local fallback unavailable", {
            fileName: originalFileName,
            mimeType,
          });
        } catch (fallbackError) {
          console.warn("[OCR API] endpoint local fallback failed", getSafeErrorLog(fallbackError));
        }
      }

      throw analysisError;
    }
  } catch (error) {
    if (error instanceof OCRProfileRestrictionError) {
      const durationMs = Date.now() - startedAt;

      console.warn("[OCR API] profile restriction rejected document", {
        allowedProfiles: error.allowedProfiles,
        detectedProfileBeforeRestriction: error.detectedProfile.id,
        finalProfileUsed: null,
        restrictionMode: error.restrictionMode,
        restrictionReason: error.message,
      });

      await recordUsageEvent({
        context: usageContext,
        durationMs,
        errorType: "profile_not_allowed",
        estimatedDocumentType,
        fileMimeType: originalMimeType,
        fileSizeBytes: originalFileSize,
        isInternalTest: accessSessionForUsage?.isInternalTest,
        originalFileName,
        status: "error",
      });

      return NextResponse.json(
        {
          success: false,
          error: error.message,
          detectedProfileBeforeRestriction: error.detectedProfile.id,
          detectedType:
            error.detectedProfile.userFacingExtractionType ??
            error.detectedProfile.label,
          restrictionMode: error.restrictionMode,
          allowedProfiles: error.allowedProfiles,
          ...(process.env.NODE_ENV !== "production"
            ? {
                technicalDetail:
                  "El perfil detectado no esta habilitado por este codigo de acceso.",
              }
            : {}),
        },
        { status: 422 },
      );
    }

    if (error instanceof OCRTextOnlyError) {
      const diagnostic = error.diagnostic;
      const durationMs = Date.now() - startedAt;

      console.warn("[OCR API] OCR text-only quality response", {
        providerUsed: diagnostic.providerUsed,
        pagesProcessed: diagnostic.pagesProcessed,
        textLength: diagnostic.textLength,
        qualityScore: diagnostic.qualityScore,
        failedReason: diagnostic.reason,
        profileUsed: diagnostic.profileUsed,
        fallbackUsed: diagnostic.fallbackUsed,
        multimodalFallbackAttempted:
          diagnostic.multimodalFallbackAttempted,
        visualStructuringProvider:
          diagnostic.visualStructuringProvider,
      });

      logApiTiming("total", startedAt, {
        fileName: originalFileName,
        strategy: "ocr-text-only",
      });

      await recordUsageEvent({
        context: usageContext,
        durationMs,
        errorType: "ocr_text_only",
        estimatedDocumentType,
        fileMimeType: originalMimeType,
        fileSizeBytes: originalFileSize,
        isInternalTest: accessSessionForUsage?.isInternalTest,
        originalFileName,
        status: "error",
      });

      return NextResponse.json(
        {
          success: false,
          error: "No pudimos estructurar el archivo",
          message:
            "El documento fue leído parcialmente, pero no se obtuvo una tabla confiable.",
          extractionMode: diagnostic.extractionMode,
          providerUsed: diagnostic.providerUsed,
          fallbackUsed: diagnostic.fallbackUsed,
          multimodalFallbackAttempted:
            diagnostic.multimodalFallbackAttempted,
          orientationSelected: diagnostic.orientationSelected,
          companyPersonnelQualityMetrics:
            diagnostic.companyPersonnelQualityMetrics,
          profileUsed: diagnostic.profileUsed,
          pagesProcessed: diagnostic.pagesProcessed,
          textLength: diagnostic.textLength,
          qualityScore: diagnostic.qualityScore,
          qualityStatus: diagnostic.qualityStatus,
          reason: diagnostic.reason,
          warnings: diagnostic.warnings,
          visualStructuringProvider:
            diagnostic.visualStructuringProvider,
          canDownloadRawText: diagnostic.canDownloadRawText,
          rawTextContent: diagnostic.rawTextContent,
          rawTextFileName: createRawTextFileName(originalFileName),
          durationMs,
          ...(process.env.NODE_ENV !== "production"
            ? {
                technicalDetail:
                  "OCR text extracted; structured output did not pass the quality threshold.",
              }
            : {}),
        },
        { status: 422 },
      );
    }

    const safeError = toSafeUserError(error);

    console.warn("[OCR API] API error response", {
      message: safeError.message,
      technicalDetail: safeError.technicalDetail,
    });

    logApiTiming("total", startedAt, {
      strategy: "error",
    });

    await recordUsageEvent({
      context: usageContext,
      durationMs: Date.now() - startedAt,
      errorType: safeError.technicalDetail,
      estimatedDocumentType,
      fileMimeType: originalMimeType,
      fileSizeBytes: originalFileSize,
      isInternalTest: accessSessionForUsage?.isInternalTest,
      originalFileName,
      status: "error",
    });

    const body: Record<string, unknown> = {
      success: false,
      error: safeError.message,
    };

    if (process.env.NODE_ENV !== "production") {
      body.technicalDetail = safeError.technicalDetail;
    }

    return NextResponse.json(body, { status: 500 });
  } finally {
    if (blobPathnameToDelete) {
      try {
        await del(blobPathnameToDelete);
        console.info("[OCR API] temporary blob deleted", {
          pathname: blobPathnameToDelete,
        });
      } catch (cleanupError) {
        console.warn("[OCR API] temporary blob cleanup failed", {
          pathname: blobPathnameToDelete,
          errorName:
            cleanupError instanceof Error
              ? cleanupError.name
              : typeof cleanupError,
        });
      }
    }
  }
}

type BlobProcessRequest = {
  blobUrl: string;
  pathname: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  profile?: string;
};

async function readBlobProcessRequest(request: Request): Promise<BlobProcessRequest> {
  let body: Partial<BlobProcessRequest>;

  try {
    body = (await request.json()) as Partial<BlobProcessRequest>;
  } catch {
    throw new CsvAnalysisError(
      "La referencia del archivo no es valida.",
      "BLOB_PROCESS_REQUEST_INVALID_JSON",
    );
  }

  if (
    typeof body.blobUrl !== "string" ||
    typeof body.pathname !== "string" ||
    typeof body.originalFileName !== "string" ||
    typeof body.mimeType !== "string" ||
    typeof body.size !== "number" ||
    !Number.isFinite(body.size)
  ) {
    throw new CsvAnalysisError(
      "La referencia del archivo esta incompleta.",
      "BLOB_PROCESS_REQUEST_INVALID",
    );
  }

  return {
    blobUrl: body.blobUrl.trim(),
    pathname: body.pathname.trim(),
    originalFileName: body.originalFileName,
    mimeType: body.mimeType,
    size: body.size,
    profile: body.profile,
  };
}

function sanitizeOriginalFileName(value: string) {
  const withoutControlCharacters = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");
  const sanitized = withoutControlCharacters
    .replace(/[\\/]+/g, "-")
    .trim()
    .slice(0, 180);

  return sanitized || "documento";
}

function createRawTextFileName(originalFileName: string) {
  const baseName = sanitizeOriginalFileName(originalFileName)
    .replace(/\.[^.]+$/i, "")
    .trim();

  return `${baseName || "documento"}_ocr_bruto.txt`;
}

const methodNotAllowed = () =>
  NextResponse.json(
    { success: false, error: "Método no permitido. Usá POST." },
    { status: 405, headers: { Allow: "POST" } },
  );

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};

async function successResponse(
  result: {
    csvContent: string;
    fileName: string;
    extractedRows: number;
    jsonColumns?: string[];
    jsonRows?: Record<string, string>[];
    modelUsed: string;
    profileValidationWarnings?: string[];
    resultQuality?: "ai" | "partial" | "local-fallback";
    extractionMode?: string;
    extractionType?: string;
    primaryProvider?: string;
    fallbackProvider?: string;
    providerUsed?: string;
    confidence?: number;
    qualityStatus?: OCRQualityStatus;
    warnings?: string[];
    pagesProcessed?: number;
    profileCode?: string;
    profileName?: string;
    personnelQualityMetrics?: {
      filasConCUIL: number;
      filasConLocalidad: number;
      filasConLugarTrabajo: number;
      filasConNombre: number;
      filasConProvincia: number;
      porcentajeCompletitud: number;
      totalRegistros: number;
    };
    companyPersonnelQualityMetrics?: {
      cuitsDetectados: number;
      dnisDetectados: number;
      empresasDetectadas: number;
      filasConCUIT: number;
      filasConDNI: number;
      filasConEmpresa: number;
      filasConLocalidad: number;
      filasConNombre: number;
      filasConProvincia: number;
      porcentajeCompletitud: number;
      registrosEstructurados: number;
    };
    orientationSelected?: 0 | 90 | 180 | 270;
    rowsExtracted?: number;
    visualStructuringProvider?: string;
    allowedProfiles?: string[];
    detectedProfileBeforeRestriction?: string;
    forcedProfile?: string;
    restrictionMode?: ProfileRestrictionMode;
    restrictionReason?: string;
    automaticReviewApplied?: boolean;
    correctionsApplied?: string[];
    detectedDocumentType?: string;
    detectedHeaders?: string[];
    documentTitle?: string;
    documentAiUsed?: boolean;
    gptExtractorUsed?: boolean;
    gptExtractorMode?: "multimodal" | "text_layout_only";
    gptReviewerUsed?: boolean;
    gptReviewerMode?: "multimodal" | "text_layout_only";
    legacyProfilesBypassed?: boolean;
    pdfVisualRenderingAttempted?: boolean;
    pdfVisualRenderingSucceeded?: boolean;
    rejectedLegacyColumns?: string[];
    usedDocumentAiTextOnlyFallback?: boolean;
    visualPagesRendered?: boolean;
    visualRenderError?: string;
  },
  startedAt: number,
  rateLimit: RateLimitResult,
  sourceFileName?: string,
  strategy?: string,
  context: {
    clientProfile?: ClientProfile;
    documentType?: DocumentType;
    accessSession?: AccessSessionPayload | null;
    sourceFileSize?: number;
    sourceMimeType?: string;
    usageContext?: OcrPlanContext | null;
  } = {},
) {
  const durationMs = Date.now() - startedAt;
  const usesUniversalExtraction =
    result.extractionMode === "document_ai_gpt_optimized";
  const resolvedProfileCode = usesUniversalExtraction
    ? undefined
    : result.profileCode ?? getClientProfileCode(context.clientProfile);
  const resolvedProfileName = usesUniversalExtraction
    ? result.profileName
    : result.profileName ?? context.clientProfile?.label;
  const extractionKind = resolveCsvFileKind(result, strategy, context);
  const fileName = createCsvFileName(extractionKind);
  const jsonFileName = fileName.replace(/\.csv$/i, ".json");
  const xlsxFileName = fileName.replace(/\.csv$/i, ".xlsx");
  const parsedCsv = parseCsvPreview(result.csvContent);
  const columns = parsedCsv.columns;
  const rows = parsedCsv.rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ""])),
  );
  const jsonColumns = result.jsonColumns ?? columns;
  const jsonRows = result.jsonRows ?? rows;
  const xlsxContentBase64 = await createXlsxBase64({
    columns,
    rows,
    sheetName: result.detectedDocumentType || "Resultados",
  });
  const metadata = createExtractionMetadata({
    clientProfileId: usesUniversalExtraction
      ? undefined
      : result.profileCode ?? context.clientProfile?.id,
    accessMode: context.accessSession?.accessMode === "master" ? "master" : "client",
    isInternalTest: context.accessSession?.isInternalTest === true,
    durationMs,
    automaticReviewApplied: result.automaticReviewApplied,
    correctionsApplied: result.correctionsApplied,
    detectedHeaders: result.detectedHeaders,
    documentAiUsed: result.documentAiUsed,
    documentType:
      result.detectedDocumentType ?? context.clientProfile?.documentType,
    extractionKind,
    extractionMode: result.extractionMode ?? context.clientProfile?.extractionMode,
    fields: columns.length,
    originalFileName: sourceFileName ?? "",
    outputFileName: fileName,
    outputJsonFileName: jsonFileName,
    orientationSelected: result.orientationSelected,
    profileCode: resolvedProfileCode,
    profileName: resolvedProfileName,
    records: rows.length,
    primaryProvider: result.primaryProvider,
    fallbackProvider: result.fallbackProvider,
    providerUsed: result.providerUsed,
    gptExtractorUsed: result.gptExtractorUsed,
    gptExtractorMode: result.gptExtractorMode,
    gptReviewerUsed: result.gptReviewerUsed,
    gptReviewerMode: result.gptReviewerMode,
    legacyProfilesBypassed: result.legacyProfilesBypassed,
    pdfVisualRenderingAttempted: result.pdfVisualRenderingAttempted,
    pdfVisualRenderingSucceeded: result.pdfVisualRenderingSucceeded,
    confidence: result.confidence,
    qualityStatus: result.qualityStatus,
    pagesProcessed: result.pagesProcessed,
    rowsExtracted: result.rowsExtracted ?? result.extractedRows,
    rejectedLegacyColumns: result.rejectedLegacyColumns,
    usedDocumentAiTextOnlyFallback:
      result.usedDocumentAiTextOnlyFallback,
    visualPagesRendered: result.visualPagesRendered,
    visualRenderError: result.visualRenderError,
    visualStructuringProvider: result.visualStructuringProvider,
    warnings: [...(result.profileValidationWarnings ?? []), ...(result.warnings ?? [])],
  });
  const jsonContent = JSON.stringify({ metadata, columns: jsonColumns, rows: jsonRows }, null, 2);
  const allowJsonExport = context.usageContext?.plan.allowJsonExport ?? true;
  logApiTiming("total", startedAt, {
    fileName: sourceFileName,
    model: result.modelUsed,
    strategy,
  });

  await recordUsageEvent({
    context: context.usageContext ?? null,
    durationMs,
    estimatedDocumentType: context.documentType,
    extractionKind,
    fields: columns.length,
    fileMimeType: context.sourceMimeType,
    fileSizeBytes: context.sourceFileSize,
    originalFileName: sourceFileName,
    outputCsvFileName: fileName,
    outputJsonFileName: allowJsonExport ? jsonFileName : undefined,
    records: rows.length,
    isInternalTest: context.accessSession?.isInternalTest,
    status: "success",
  });

  return jsonResponse(
    {
      success: true,
      csvContent: result.csvContent,
      fileName,
      jsonContent: allowJsonExport ? jsonContent : undefined,
      jsonFileName: allowJsonExport ? jsonFileName : undefined,
      xlsxContentBase64,
      xlsxFileName,
      allowJsonExport,
      extractedRows: result.extractedRows,
      modelUsed: result.modelUsed,
      profileCode: resolvedProfileCode,
      profileName: resolvedProfileName,
      extractionMode: result.extractionMode ?? context.clientProfile?.extractionMode,
      extractionType: result.extractionType ?? context.clientProfile?.userFacingExtractionType,
      automaticReviewApplied: result.automaticReviewApplied,
      correctionsApplied: result.correctionsApplied,
      detectedDocumentType: result.detectedDocumentType,
      detectedHeaders: result.detectedHeaders,
      documentTitle: result.documentTitle,
      documentAiUsed: result.documentAiUsed,
      gptExtractorUsed: result.gptExtractorUsed,
      gptExtractorMode: result.gptExtractorMode,
      gptReviewerUsed: result.gptReviewerUsed,
      gptReviewerMode: result.gptReviewerMode,
      legacyProfilesBypassed: result.legacyProfilesBypassed,
      pdfVisualRenderingAttempted: result.pdfVisualRenderingAttempted,
      pdfVisualRenderingSucceeded: result.pdfVisualRenderingSucceeded,
      rejectedLegacyColumns: result.rejectedLegacyColumns,
      usedDocumentAiTextOnlyFallback:
        result.usedDocumentAiTextOnlyFallback,
      visualPagesRendered: result.visualPagesRendered,
      visualRenderError: result.visualRenderError,
      resultQuality: result.resultQuality,
      providerUsed: result.providerUsed,
      visualStructuringProvider: result.visualStructuringProvider,
      qualityStatus: result.qualityStatus,
      confidence: result.confidence,
      warnings: result.warnings,
      personnelQualityMetrics: result.personnelQualityMetrics,
      companyPersonnelQualityMetrics:
        result.companyPersonnelQualityMetrics,
      orientationSelected: result.orientationSelected,
      allowedProfiles: result.allowedProfiles,
      detectedProfileBeforeRestriction:
        result.detectedProfileBeforeRestriction,
      forcedProfile: result.forcedProfile,
      restrictionMode: result.restrictionMode,
      restrictionReason: result.restrictionReason,
      durationMs,
    },
    200,
    rateLimit,
  );
}

function resolveCsvFileKind(
  result: {
    csvContent: string;
    detectedDocumentType?: string;
    detectedHeaders?: string[];
    extractionMode?: string;
    modelUsed: string;
    profileCode?: string;
    resultQuality?: "ai" | "partial" | "local-fallback";
  },
  strategy?: string,
  context: {
    clientProfile?: ClientProfile;
    documentType?: DocumentType;
  } = {},
): CsvFileKind {
  const modelUsed = result.modelUsed.toLowerCase();
  const normalizedDetectedType = normalizeCsvHeaderForKind(
    result.detectedDocumentType ?? "",
  );
  const normalizedDetectedHeaders = (result.detectedHeaders ?? []).map(
    normalizeCsvHeaderForKind,
  );

  if (
    normalizedDetectedType.includes("proveedor") ||
    ["nombreempresa", "proveedor", "cuit", "servicioarea"].filter((column) =>
      normalizedDetectedHeaders.includes(column),
    ).length >= 3
  ) {
    return "PROVEEDORES";
  }

  if (result.extractionMode === "document_ai_gpt_optimized") {
    if (
      normalizedDetectedType.includes("nomina") ||
      normalizedDetectedType.includes("personal")
    ) {
      return "NOMINA";
    }

    if (
      normalizedDetectedType.includes("movimiento") &&
      ["fechasalida", "cantidadcamion", "rutacaminospuna"].filter((column) =>
        normalizedDetectedHeaders.includes(column),
      ).length >= 2
    ) {
      return "MOVIMIENTO";
    }

    return "TABLA_DOCUMENTAL";
  }

  if (result.profileCode === "internal-nomina-personal") {
    return "NOMINA";
  }

  if (result.profileCode === "internal-personal-empresa-localidad") {
    return "PERSONAL_EMPRESA";
  }

  if (
    result.profileCode === "internal-movimiento-camiones" ||
    context.clientProfile?.id === "internal-movimiento-camiones" ||
    context.clientProfile?.extractionMode === "vision_table"
  ) {
    return "MOVIMIENTO";
  }

  if (result.profileCode === "internal-tabla-administrativa") {
    return "LISTADO";
  }

  if (result.extractionMode === "agentic_document_table") {
    return "TABLA_DOCUMENTAL";
  }

  if (result.resultQuality === "local-fallback" || modelUsed.includes("local pdf text fallback")) {
    return "EXTRACCION_BASICA";
  }

  if (modelUsed.includes("pdf table fallback")) {
    return "PDF_TABULAR";
  }

  if (context.documentType === "table") {
    return "LISTADO";
  }

  const normalizedColumns = getCsvHeaderColumns(result.csvContent).map(normalizeCsvHeaderForKind);

  if (looksLikeListColumns(normalizedColumns)) {
    return "LISTADO";
  }

  if (
    context.documentType === "invoice" ||
    context.clientProfile?.defaultExtractionProfile === "commercial-operations" ||
    looksLikeCommercialColumns(normalizedColumns)
  ) {
    return "COMPROBANTE";
  }

  if (
    context.documentType === "report" ||
    context.clientProfile?.defaultExtractionProfile === "technical-admin" ||
    looksLikeTechnicalColumns(normalizedColumns)
  ) {
    return "DOCUMENTO_TECNICO";
  }

  if (strategy === "local-fallback") {
    return "EXTRACCION_BASICA";
  }

  return "GENERAL";
}

function getCsvHeaderColumns(csvContent: string) {
  const firstLine = csvContent.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "";
  return firstLine
    .split(",")
    .map((column) => column.replace(/^"|"$/g, "").replace(/""/g, '"').trim())
    .filter(Boolean);
}

function normalizeCsvHeaderForKind(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function looksLikeListColumns(columns: string[]) {
  const required = ["razonsocial", "cuit", "localidad", "actividadprincipal"];
  return required.filter((column) => columns.includes(column)).length >= 3;
}

function looksLikeCommercialColumns(columns: string[]) {
  const commercial = [
    "tipodocumento",
    "organismo",
    "numerodocumento",
    "cuve",
    "cadtv",
    "cuitemisor",
    "cuitreceptor",
    "producto",
    "pesototal",
    "transportista",
    "patentechasis",
    "patenteacoplado",
    "codigocierre",
  ];

  return commercial.filter((column) => columns.includes(column)).length >= 5;
}

function looksLikeTechnicalColumns(columns: string[]) {
  const technical = [
    "seccion",
    "categoria",
    "dato",
    "valor",
    "expedienteresolucion",
    "empresaproyecto",
    "ubicacion",
  ];

  return technical.filter((column) => columns.includes(column)).length >= 5;
}

function jsonResponse(body: Record<string, unknown>, status: number, rateLimit: RateLimitResult) {
  return NextResponse.json(body, {
    status,
    headers: createRateLimitHeaders(rateLimit),
  });
}

function getPlanFileSizeLimitMessage(mimeType: string, limitMb: number) {
  if (mimeType === "application/pdf") {
    return `Archivo excede el tamaño máximo. Tu plan permite PDFs de hasta ${limitMb} MB.`;
  }

  if (mimeType === "image/jpeg" || mimeType === "image/png") {
    return `Archivo excede el tamaño máximo. Tu plan permite imágenes de hasta ${limitMb} MB.`;
  }

  return `Archivo excede el tamaño máximo. Tu plan permite archivos de hasta ${limitMb} MB.`;
}

function normalizeTestProfileId(value: unknown) {
  if (typeof value !== "string") return "";

  const normalized = value.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  const allowed = new Set(["general", "mateo", "movimiento", "technical-admin"]);

  return allowed.has(normalized) ? normalized : "";
}

function isForceLocalPdfFallbackEnabled() {
  const value = process.env.FORCE_LOCAL_PDF_FALLBACK ?? "";
  return value.trim().replace(/^['"]|['"]$/g, "").toLowerCase() === "true";
}

function logApiTiming(
  stage: string,
  startedAt: number,
  context: {
    fileName?: string;
    strategy?: string;
    model?: string;
  } = {},
) {
  console.info("[OCR] timing", {
    stage,
    durationMs: Date.now() - startedAt,
    fileName: context.fileName,
    strategy: context.strategy,
    model: context.model,
  });
}

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return sanitizeTechnicalDetail(error.message).slice(0, 220);
  }

  return "Error desconocido durante el procesamiento OCR.";
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message === "OCR processing timed out" ||
      error.message.toLowerCase().includes("procesamiento tard"))
  );
}

function toSafeUserError(error: unknown) {
  if (isProfileExtractionValidationError(error)) {
    return {
      message:
        "No se pudo estructurar la tabla logistica. El documento fue leido parcialmente, pero no se detecto una tabla valida para el perfil Movimiento. Proba con una imagen mas clara o solicita revision manual.",
      technicalDetail: "failed_quality_gate_movimiento",
    };
  }

  if (isAiQuotaOrSaturationError(error)) {
    return {
      message:
        "Motor temporalmente ocupado. El servicio alcanzó temporalmente su límite de procesamiento. Esperá unos minutos e intentá nuevamente.",
      technicalDetail: "Límite temporal del motor IA.",
    };
  }

  if (isHtmlJsonParseLeak(error)) {
    return {
      message: "No se pudo estructurar la respuesta del modelo. Intentá nuevamente.",
      technicalDetail: "AI response could not be converted to structured output",
    };
  }

  if (isAiOutputQualityLowError(error)) {
    return {
      message:
        "No pudimos estructurar el archivo. El documento fue leido parcialmente, pero no se obtuvo una tabla confiable. Proba con una imagen mas nitida o mas centrada.",
      technicalDetail: "La salida del motor no alcanzo el umbral minimo de calidad.",
    };
  }

  if (isOcrQualityGateError(error)) {
    return {
      message:
        "No pudimos estructurar el archivo. El documento fue leido parcialmente, pero no se obtuvo una tabla confiable. Proba con una imagen mas nitida o mas centrada.",
      technicalDetail: "La salida del motor no alcanzo el umbral minimo de calidad.",
    };
  }

  if (isTimeoutError(error)) {
    return {
      message:
        "El procesamiento tardó demasiado. Probá con un archivo más liviano o dividí el documento en partes.",
      technicalDetail: "OCR processing timed out",
    };
  }

  if (error instanceof GoogleAiTemporaryError && error.fallbackFailed) {
    return {
      message: "El servicio de IA está temporalmente ocupado. Intentá nuevamente más tarde.",
      technicalDetail: sanitizeTechnicalDetail(error.technicalDetail),
    };
  }

  if (error instanceof GoogleAiTemporaryError) {
    return {
      message: "El modelo de IA está temporalmente saturado. Intentá nuevamente en unos minutos.",
      technicalDetail: sanitizeTechnicalDetail(error.technicalDetail),
    };
  }

  if (error instanceof StructuredOutputError) {
    return {
      message: "No se pudo estructurar la respuesta del modelo. Intentá nuevamente.",
      technicalDetail: "AI response could not be converted to structured output",
    };
  }

  if (isDocumentAiError(error)) {
    return {
      message: "No pudimos procesar el documento con OCR avanzado",
      technicalDetail: "Google Document AI processing failed",
    };
  }

  if (error instanceof CsvAnalysisError) {
    return {
      message: error.message,
      technicalDetail: sanitizeTechnicalDetail(error.technicalDetail),
    };
  }

  return {
    message: "No pudimos procesar el archivo",
    technicalDetail: summarizeError(error),
  };
}

function isDocumentAiError(error: unknown) {
  const detail =
    error instanceof CsvAnalysisError
      ? `${error.message} ${error.technicalDetail}`
      : error instanceof Error
        ? `${error.name} ${error.message}`
        : String(error ?? "");
  const normalized = detail.toLowerCase();

  return (
    normalized.includes("google document ai") ||
    normalized.includes("google_document_ai") ||
    normalized.includes("advanced_ocr_normalization")
  );
}

function isProfileExtractionValidationError(error: unknown) {
  const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  const normalized = detail.toLowerCase();

  return (
    normalized.includes("profileextractionvalidationerror") ||
    normalized.includes("profile_extraction_validation_error") ||
    normalized.includes("profile_rejected_generic_line_csv")
  );
}

function isAiOutputQualityLowError(error: unknown) {
  const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  const normalized = detail.toLowerCase();

  return (
    normalized.includes("aioutputqualityerror") ||
    normalized.includes("ai result quality was too low") ||
    normalized.includes("ai_output_quality_low")
  );
}

function isOcrQualityGateError(error: unknown) {
  const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  const normalized = detail.toLowerCase();

  return (
    normalized.includes("ocr_quality_gate_failed") ||
    normalized.includes("ocr_fallback_quality_gate_failed") ||
    normalized.includes("quality gate")
  );
}

function isAiQuotaOrSaturationError(error: unknown) {
  const detail =
    error instanceof GoogleAiTemporaryError
      ? error.technicalDetail
      : error instanceof Error
        ? error.message
        : String(error ?? "");
  const normalized = detail.toLowerCase();

  return (
    normalized.includes("429") ||
    normalized.includes("too many requests") ||
    normalized.includes("quota") ||
    normalized.includes("exceeded your current quota") ||
    normalized.includes("resource exhausted") ||
    normalized.includes("high demand") ||
    normalized.includes("fetch failed") ||
    normalized.includes("service unavailable") ||
    normalized.includes("temporarily") ||
    normalized.includes("saturad") ||
    normalized.includes("network")
  );
}

function isHtmlJsonParseLeak(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const normalized = detail.toLowerCase();

  return (
    normalized.includes("unexpected token '<'") ||
    normalized.includes("<!doctype") ||
    normalized.includes("<html")
  );
}

function sanitizeTechnicalDetail(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  const normalized = compact.toLowerCase();

  if (
    normalized.includes("<!doctype") ||
    normalized.includes("<html") ||
    normalized.includes("unexpected token '<'")
  ) {
    return "AI response could not be converted to structured output";
  }

  return compact.replace(/</g, "‹").replace(/>/g, "›").slice(0, 220);
}

function getSafeErrorLog(error: unknown) {
  const errorName = error instanceof Error ? error.name : typeof error;
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const errorCode =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";

  return {
    errorName,
    errorMessage: sanitizeTechnicalDetail(rawMessage),
    errorCode,
  };
}
