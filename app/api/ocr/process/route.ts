import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAccessCookieName, verifyAccessCookie } from "@/lib/access-code";
import {
  getAccessSessionCookieName,
  verifyAccessSessionCookie,
} from "@/lib/access-session";
import { auth } from "@/lib/auth";
import {
  getClientProfileCookieName,
  resolveDocumentTypeForProfile,
  verifyClientProfileCookie,
  type ClientProfile,
} from "@/lib/client-profiles";
import { createCsvFileName, type CsvFileKind } from "@/lib/csv";
import { parseCsvPreview } from "@/lib/csv-preview";
import { normalizeDocumentType, type DocumentType } from "@/lib/document-type";
import { createExtractionMetadata } from "@/lib/extraction-metadata";
import {
  analyzeFileToCsv,
  CsvAnalysisError,
  GoogleAiTemporaryError,
  StructuredOutputError,
} from "@/lib/google-ai";
import { prepareImageForOcr } from "@/lib/image-optimization";
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
  getSupportedMimeType,
  isAllowedOcrFile,
} from "@/lib/validations";
import {
  getOcrUsageContext,
  getPlanAwareMaxSizeMb,
  recordUsageEvent,
  type OcrPlanContext,
} from "@/lib/usage";

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
    const clientProfile = verifyClientProfileCookie(
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

    const contentType = request.headers.get("content-type") || "";

    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return jsonResponse(
        { success: false, error: "La solicitud debe enviar un archivo mediante formulario." },
        400,
        rateLimit,
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const detectedDocumentType = normalizeDocumentType(formData.get("documentType"));

    if (!(file instanceof File)) {
      return jsonResponse(
        { success: false, error: "No se recibió ningún archivo." },
        400,
        rateLimit,
      );
    }

    if (file.size === 0) {
      return jsonResponse(
        { success: false, error: "El archivo está vacío. Seleccioná otro archivo." },
        400,
        rateLimit,
      );
    }

    if (!isAllowedOcrFile(file)) {
      return jsonResponse(
        { success: false, error: "Subí un archivo PDF, JPG o PNG para continuar." },
        400,
        rateLimit,
      );
    }

    logApiTiming("validation", startedAt, {
      fileName: file.name,
      strategy: "request-validation",
    });

    let fileBuffer: Buffer = Buffer.from(await file.arrayBuffer());
    let mimeType = getSupportedMimeType(file);
    originalFileName = file.name;
    originalMimeType = mimeType;
    originalFileSize = file.size;
    const documentType = resolveDocumentTypeForProfile(detectedDocumentType, clientProfile);
    estimatedDocumentType = documentType;
    const globalSizeLimitMb = getMaxSizeMbForMimeType(mimeType);
    const effectiveSizeLimitMb = getPlanAwareMaxSizeMb(mimeType, usageContext, globalSizeLimitMb);

    if (file.size > effectiveSizeLimitMb * 1024 * 1024) {
      await recordUsageEvent({
        context: usageContext,
        durationMs: Date.now() - startedAt,
        errorType: "file_size_limit",
        estimatedDocumentType,
        fileMimeType: mimeType,
        fileSizeBytes: file.size,
        originalFileName: file.name,
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
          fileName: file.name,
          strategy: "image-optimization",
        });
      }
    }

    console.info("[OCR API] request received", {
      fileName: file.name,
      mimeType,
      size: file.size,
      documentType,
      clientProfileId: clientProfile.id,
    });

    if (isForceLocalPdfFallbackEnabled() && mimeType === "application/pdf") {
      console.info("[OCR API] FORCE_LOCAL_PDF_FALLBACK enabled", {
        fileName: file.name,
        mimeType,
        size: file.size,
      });

      const extractionStartedAt = Date.now();
      const extraction = await extractPdfTextByPages(fileBuffer);
      logApiTiming("pdf-text-extraction", extractionStartedAt, {
        fileName: file.name,
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
        originalFileName: file.name,
        totalTextLength: extraction.totalTextLength,
      });
      logApiTiming("fallback-local", fallbackStartedAt, {
        fileName: file.name,
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
        file.name,
        "local-fallback",
        {
          clientProfile,
          documentType,
          usageContext,
          sourceFileSize: file.size,
          sourceMimeType: mimeType,
        },
      );
    }

    try {
      console.info("[OCR API] calling analyzeFileToCsv");
      const analysisStartedAt = Date.now();
      const analysis = await analyzeFileToCsv(
        fileBuffer,
        file.name,
        mimeType,
        documentType,
        clientProfile,
      );
      logApiTiming(
        mimeType === "application/pdf" ? "direct-file-analysis" : "direct-file-analysis",
        analysisStartedAt,
        {
          fileName: file.name,
          model: analysis.modelUsed,
          strategy: "ocr-analysis",
        },
      );

      console.info("[OCR API] analyzeFileToCsv success", {
        modelUsed: analysis.modelUsed,
        extractedRows: analysis.extractedRows,
        csvLength: analysis.csvContent?.length ?? 0,
      });

      return successResponse(analysis, startedAt, rateLimit, file.name, "ocr-analysis", {
        clientProfile,
        documentType,
        usageContext,
        sourceFileSize: file.size,
        sourceMimeType: mimeType,
      });
    } catch (analysisError) {
      console.warn("[OCR API] analyzeFileToCsv failed", getSafeErrorLog(analysisError));

      if (mimeType === "application/pdf") {
        try {
          const fallbackStartedAt = Date.now();
          const fallback = await createLocalPdfTextFallbackFromBuffer(fileBuffer, file.name);
          logApiTiming("fallback-local", fallbackStartedAt, {
            fileName: file.name,
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
              file.name,
              "local-fallback",
              {
                clientProfile,
                documentType,
                usageContext,
                sourceFileSize: file.size,
                sourceMimeType: mimeType,
              },
            );
          }

          console.warn("[OCR API] endpoint local fallback unavailable", {
            fileName: file.name,
            mimeType,
          });
        } catch (fallbackError) {
          console.warn("[OCR API] endpoint local fallback failed", getSafeErrorLog(fallbackError));
        }
      }

      throw analysisError;
    }
  } catch (error) {
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
  }
}

const methodNotAllowed = () =>
  NextResponse.json(
    { success: false, error: "Método no permitido. Usá POST para procesar documentos." },
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
    modelUsed: string;
    resultQuality?: "ai" | "partial" | "local-fallback";
  },
  startedAt: number,
  rateLimit: RateLimitResult,
  sourceFileName?: string,
  strategy?: string,
  context: {
    clientProfile?: ClientProfile;
    documentType?: DocumentType;
    sourceFileSize?: number;
    sourceMimeType?: string;
    usageContext?: OcrPlanContext | null;
  } = {},
) {
  const durationMs = Date.now() - startedAt;
  const extractionKind = resolveCsvFileKind(result, strategy, context);
  const fileName = createCsvFileName(extractionKind);
  const jsonFileName = fileName.replace(/\.csv$/i, ".json");
  const parsedCsv = parseCsvPreview(result.csvContent);
  const columns = parsedCsv.columns;
  const rows = parsedCsv.rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ""])),
  );
  const metadata = createExtractionMetadata({
    clientProfileId: context.clientProfile?.id,
    durationMs,
    extractionKind,
    fields: columns.length,
    originalFileName: sourceFileName ?? "",
    outputFileName: fileName,
    outputJsonFileName: jsonFileName,
    records: rows.length,
  });
  const jsonContent = JSON.stringify({ metadata, columns, rows }, null, 2);
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
    status: "success",
  });

  return jsonResponse(
    {
      success: true,
      csvContent: result.csvContent,
      fileName,
      jsonContent: allowJsonExport ? jsonContent : undefined,
      jsonFileName: allowJsonExport ? jsonFileName : undefined,
      allowJsonExport,
      extractedRows: result.extractedRows,
      modelUsed: result.modelUsed,
      resultQuality: result.resultQuality,
      durationMs,
    },
    200,
    rateLimit,
  );
}

function resolveCsvFileKind(
  result: {
    csvContent: string;
    modelUsed: string;
    resultQuality?: "ai" | "partial" | "local-fallback";
  },
  strategy?: string,
  context: {
    clientProfile?: ClientProfile;
    documentType?: DocumentType;
  } = {},
): CsvFileKind {
  const modelUsed = result.modelUsed.toLowerCase();

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

function isAiOutputQualityLowError(error: unknown) {
  const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  const normalized = detail.toLowerCase();

  return (
    normalized.includes("aioutputqualityerror") ||
    normalized.includes("ai result quality was too low") ||
    normalized.includes("ai_output_quality_low")
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
