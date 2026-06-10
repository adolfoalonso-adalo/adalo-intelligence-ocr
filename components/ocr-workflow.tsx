"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import { CsvResultsPreview } from "@/components/csv-results-preview";
import { DownloadCsvButton } from "@/components/download-csv-button";
import { DownloadJsonButton } from "@/components/download-json-button";
import { DownloadRawTextButton } from "@/components/download-raw-text-button";
import { PdfDropzone } from "@/components/pdf-dropzone";
import { ProcessingStatus } from "@/components/processing-status";
import { Spinner } from "@/components/spinner";
import { parseCsvPreview } from "@/lib/csv-preview";
import { getSupportedMimeType } from "@/lib/validations";

export type OcrStatus =
  | "idle"
  | "validating"
  | "ready"
  | "uploading"
  | "processing"
  | "done"
  | "error";

type ResultQuality = "ai" | "partial" | "local-fallback";

type ProcessResponse = {
  success: boolean;
  csvContent?: string;
  fileName?: string;
  jsonContent?: string;
  jsonFileName?: string;
  allowJsonExport?: boolean;
  extractedRows?: number;
  modelUsed?: string;
  profileCode?: string;
  profileName?: string;
  extractionMode?: string;
  extractionType?: string;
  resultQuality?: ResultQuality;
  durationMs?: number;
  error?: string;
  message?: string;
  technicalDetail?: string;
  providerUsed?: string;
  fallbackUsed?: boolean;
  profileUsed?: string;
  pagesProcessed?: number;
  textLength?: number;
  qualityScore?: number;
  qualityStatus?: string;
  reason?: string;
  warnings?: string[];
  canDownloadRawText?: boolean;
  rawTextContent?: string;
  rawTextFileName?: string;
};

export type OcrTextOnlyDiagnostic = {
  providerUsed?: string;
  fallbackUsed?: boolean;
  profileUsed?: string;
  pagesProcessed?: number;
  textLength?: number;
  qualityScore?: number;
  qualityStatus?: string;
  reason?: string;
  warnings?: string[];
  rawTextContent?: string;
  rawTextFileName?: string;
};

type TestProfileId = "general" | "mateo" | "movimiento" | "technical-admin";

export function OcrWorkflow({
  accessMode,
  allowProfileTesting = false,
  uploadPrefix,
}: {
  accessMode?: "client" | "legacy" | "master";
  allowProfileTesting?: boolean;
  uploadPrefix: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [error, setError] = useState<string>("");
  const [technicalDetail, setTechnicalDetail] = useState<string>("");
  const [textOnlyDiagnostic, setTextOnlyDiagnostic] =
    useState<OcrTextOnlyDiagnostic | null>(null);
  const [testProfileId, setTestProfileId] = useState<TestProfileId>("general");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<{
    csvContent: string;
    fileName: string;
    jsonContent?: string;
    jsonFileName?: string;
    allowJsonExport?: boolean;
    extractedRows: number;
    profileCode?: string;
    profileName?: string;
    extractionMode?: string;
    extractionType?: string;
    resultQuality?: ResultQuality;
    durationMs?: number;
  } | null>(null);
  const parsedResult = result ? parseCsvPreview(result.csvContent) : null;

  function handleFileSelected(selectedFile: File) {
    setFile(null);
    setResult(null);
    setError("");
    setTechnicalDetail("");
    setTextOnlyDiagnostic(null);
    setUploadProgress(0);
    setStatus("validating");

    window.setTimeout(() => {
      setFile(selectedFile);
      setStatus("ready");
    }, 350);
  }

  function handleInvalidFile(message: string) {
    setFile(null);
    setResult(null);
    setError(message);
    setTechnicalDetail("");
    setTextOnlyDiagnostic(null);
    setStatus("error");
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError("");
    setTechnicalDetail("");
    setTextOnlyDiagnostic(null);
    setUploadProgress(0);
    setStatus("idle");
  }

  async function processDocument() {
    if (!file || status !== "ready") return;

    setStatus("uploading");
    setError("");
    setTechnicalDetail("");
    setTextOnlyDiagnostic(null);
    setResult(null);
    setUploadProgress(0);

    try {
      const mimeType = getSupportedMimeType(file);
      const pathname = `${uploadPrefix}${Date.now()}-${sanitizeBlobFileName(file.name)}`;
      console.info("upload:start", {
        endpoint: "/api/upload",
        method: "POST",
        fileName: file.name,
        mimeType,
        size: file.size,
      });
      const blob = await upload(pathname, file, {
        access: "private",
        contentType: mimeType,
        handleUploadUrl: "/api/upload",
        multipart: true,
        clientPayload: JSON.stringify({
          mimeType,
          originalFileName: file.name,
          size: file.size,
        }),
        onUploadProgress: ({ percentage }) => {
          setUploadProgress(Math.round(percentage));
        },
      });

      console.info("upload:complete", {
        endpoint: "/api/upload",
        method: "POST",
        pathname: blob.pathname,
      });
      setUploadProgress(100);
      setStatus("processing");

      console.info("ocr:start", {
        endpoint: "/api/ocr/process",
        method: "POST",
        pathname: blob.pathname,
      });
      const response = await fetch("/api/ocr/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          blobUrl: blob.url,
          pathname: blob.pathname,
          originalFileName: file.name,
          mimeType,
          size: file.size,
          profile:
            allowProfileTesting && accessMode === "master"
              ? testProfileId
              : undefined,
        }),
      });
      console.info("ocr:complete", {
        endpoint: "/api/ocr/process",
        method: "POST",
        status: response.status,
        success: response.ok,
      });
      const data = await readProcessResponse(
        response,
        "POST",
        "/api/ocr/process",
      );

      if (
        data.extractionMode === "ocr_text_only" &&
        data.success === false
      ) {
        setTextOnlyDiagnostic({
          providerUsed: data.providerUsed,
          fallbackUsed: data.fallbackUsed,
          profileUsed:
            allowProfileTesting && accessMode === "master"
              ? data.profileUsed
              : undefined,
          pagesProcessed: data.pagesProcessed,
          textLength: data.textLength,
          qualityScore: data.qualityScore,
          qualityStatus: data.qualityStatus,
          reason: data.reason,
          warnings: data.warnings,
          rawTextContent: data.rawTextContent,
          rawTextFileName: data.rawTextFileName,
        });
        setError(data.error || "No pudimos estructurar el archivo");
        setTechnicalDetail(data.technicalDetail || "");
        setStatus("error");
        return;
      }

      if (!response.ok || !data.success || !data.csvContent || !data.fileName) {
        const processingError = new Error(data.error || "No pudimos procesar el archivo");
        processingError.cause = data.technicalDetail;
        throw processingError;
      }

      setResult({
        csvContent: data.csvContent,
        fileName: data.fileName,
        jsonContent: data.jsonContent,
        jsonFileName: data.jsonFileName,
        allowJsonExport: data.allowJsonExport,
        extractedRows: data.extractedRows ?? 0,
        profileCode: data.profileCode,
        profileName: data.profileName,
        extractionMode: data.extractionMode,
        extractionType: data.extractionType,
        resultQuality: data.resultQuality,
        durationMs: data.durationMs,
      });
      setStatus("done");
    } catch (caughtError) {
      const message = toSafeClientErrorMessage(caughtError);
      const safeTechnicalDetail =
        caughtError instanceof Error && typeof caughtError.cause === "string"
          ? toSafeTechnicalDetail(caughtError.cause)
          : "";
      setError(message);
      setTechnicalDetail(safeTechnicalDetail);
      setStatus("error");
    }
  }

  return (
    <div className="space-y-5">
      <PdfDropzone
        file={file}
        disabled={
          status === "processing" ||
          status === "uploading" ||
          status === "validating"
        }
        isValidating={status === "validating"}
        onFileSelected={handleFileSelected}
        onInvalidFile={handleInvalidFile}
      />

      {allowProfileTesting && accessMode === "master" ? (
        <div className="rounded-2xl border border-brand-border bg-brand-card px-4 py-3 text-left shadow-sm">
          <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-brand-accent">
            Perfil de prueba OCR
          </label>
          <select
            value={testProfileId}
            onChange={(event) => setTestProfileId(event.target.value as TestProfileId)}
            className="mt-2 w-full rounded-xl border border-brand-border bg-white px-3 py-2 text-sm font-semibold text-brand-deep outline-none transition focus:border-brand-accent"
          >
            <option value="general">Automatico / general</option>
            <option value="mateo">Mateo / comprobantes DTVe</option>
            <option value="movimiento">Movimiento / tablas logisticas</option>
            <option value="technical-admin">Documento tecnico-administrativo</option>
          </select>
          <p className="mt-2 text-xs leading-5 text-brand-slate">
            Visible solo con codigo maestro. Permite probar perfiles internos sin convertirlos en codigos de acceso.
          </p>
        </div>
      ) : null}

      <div className="space-y-2 text-center text-xs leading-5 text-brand-slate">
        <p>Tus archivos se procesan de forma temporal y no se almacenan despues de la extraccion.</p>
        <p>Reconocimiento optimizado para documentos administrativos, tecnicos y comerciales.</p>
      </div>

      <ProcessingStatus
        status={status}
        details={
          status === "processing" && file
            ? file.size > 2 * 1024 * 1024
              ? "Archivo cargado, iniciando OCR. Estamos analizando el contenido para generar una salida estructurada. Puede demorar unos minutos."
              : "Archivo cargado, iniciando OCR. Estamos identificando la estructura del documento y preparando los datos para exportar."
            : status === "uploading"
              ? `Subiendo archivo... ${uploadProgress}%`
            : status === "done" && result
              ? buildSuccessDetails(
                  result.extractedRows,
                  parsedResult?.columns.length,
                  result.resultQuality,
                  result.durationMs,
                )
              : status === "ready"
                ? "Ya podes presionar \"Procesar documento\"."
                : error
        }
        resultQuality={status === "done" ? result?.resultQuality : undefined}
        technicalDetail={status === "error" ? technicalDetail : ""}
        diagnostic={status === "error" ? textOnlyDiagnostic : null}
      />

      {result && status === "done" && result.profileName ? (
        <div className="rounded-2xl border border-brand-border bg-brand-card px-4 py-3 text-center text-xs leading-5 text-brand-slate">
          <p className="font-semibold text-brand-deep">
            Tipo detectado: {result.extractionType || result.profileName}
          </p>
          <p>
            Extraccion: {formatExtractionMode(result.extractionMode)}
            {" · "}
            Salida: CSV estructurado + JSON estructurado
          </p>
          {allowProfileTesting && accessMode === "master" && result.profileCode ? (
            <p className="mt-1 text-[11px] opacity-70">
              profileUsed: {result.profileCode}
            </p>
          ) : null}
        </div>
      ) : null}

      {result && status === "done" ? <CsvResultsPreview csvContent={result.csvContent} /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        {status !== "done" ? (
          <button
            type="button"
            onClick={() => {
              const input = document.querySelector<HTMLInputElement>('input[type="file"]');
              input?.click();
            }}
            disabled={
              status === "validating" ||
              status === "uploading" ||
              status === "processing"
            }
            className="rounded-2xl border border-brand-border bg-brand-card px-5 py-3 text-sm font-semibold text-brand-deep transition hover:-translate-y-0.5 hover:border-brand-accent hover:text-brand-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {file ? "Cambiar archivo" : "Seleccionar archivo"}
          </button>
        ) : null}

        {status === "error" &&
        textOnlyDiagnostic?.rawTextContent &&
        textOnlyDiagnostic.rawTextFileName ? (
          <DownloadRawTextButton
            fileName={textOnlyDiagnostic.rawTextFileName}
            textContent={textOnlyDiagnostic.rawTextContent}
          />
        ) : null}

        {status !== "done" ? (
          <button
            type="button"
            onClick={processDocument}
            disabled={
              !file ||
              status === "validating" ||
              status === "error" ||
              status === "uploading" ||
              status === "processing"
            }
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-deep px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-deep/20 transition hover:-translate-y-0.5 hover:bg-brand-petrol disabled:cursor-not-allowed disabled:opacity-70"
          >
            {status === "processing" || status === "uploading" ? (
              <>
                <Spinner />
                {status === "uploading" ? "Subiendo..." : "Procesando..."}
              </>
            ) : (
              "Procesar documento"
            )}
          </button>
        ) : null}

        {result && status === "done" ? (
          <>
            <DownloadCsvButton csvContent={result.csvContent} fileName={result.fileName} />
            {result.allowJsonExport !== false && result.jsonContent && result.jsonFileName ? (
              <DownloadJsonButton
                fileName={result.jsonFileName}
                jsonContent={result.jsonContent}
              />
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="rounded-2xl border border-brand-border bg-brand-card px-5 py-3 text-sm font-semibold text-brand-deep transition hover:-translate-y-0.5 hover:border-brand-accent hover:text-brand-accent"
            >
              Procesar nuevo documento
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function sanitizeBlobFileName(value: string) {
  const sanitized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);

  return sanitized || "documento";
}

async function readProcessResponse(
  response: Response,
  method: string,
  endpoint: string,
): Promise<ProcessResponse> {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    const text = await response.text().catch(() => "");
    const responseContext = `${method} ${endpoint} · HTTP ${response.status} · non-JSON response`;
    console.error("ocr:non-json-response", {
      method,
      endpoint,
      status: response.status,
      contentType,
    });
    const responseError = new Error(
      "No se pudo estructurar la respuesta del modelo. Intenta nuevamente.",
    );
    responseError.cause = looksLikeHtmlOrJsonParseError(text)
      ? `${responseContext} · AI returned HTML instead of JSON`
      : responseContext;
    throw responseError;
  }

  try {
    return (await response.json()) as ProcessResponse;
  } catch {
    const responseContext = `${method} ${endpoint} · HTTP ${response.status} · invalid JSON response`;
    console.error("ocr:invalid-json-response", {
      method,
      endpoint,
      status: response.status,
      contentType,
    });
    const responseError = new Error(
      "No se pudo estructurar la respuesta del modelo. Intenta nuevamente.",
    );
    responseError.cause = responseContext;
    throw responseError;
  }
}

function buildSuccessDetails(
  extractedRows: number,
  columnCount?: number,
  resultQuality?: ResultQuality,
  durationMs?: number,
) {
  const parts =
    resultQuality === "local-fallback"
      ? ["Extraccion basica generada desde texto del PDF", "Salida CSV/JSON", "Motor ADALO"]
      : resultQuality === "partial"
        ? [
            "Se extrajo informacion util, aunque algunas secciones no pudieron estructurarse completamente",
            "Salida CSV/JSON",
            "Motor ADALO",
          ]
        : [
            formatRecordCount(extractedRows),
            ...(typeof columnCount === "number" && columnCount > 0
              ? [`${columnCount} campos estructurados`]
              : []),
            "Salida CSV/JSON",
            "Motor ADALO",
          ];

  if (typeof durationMs === "number") {
    parts.push(formatDuration(durationMs));
  }

  return parts.join(" · ");
}

function formatRecordCount(value: number) {
  return value === 1 ? "1 registro detectado" : `${value} registros detectados`;
}

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1).replace(".", ",")} s`;
}

function formatExtractionMode(value?: string) {
  if (value === "vision_table") return "OCR visual tabular";
  if (value === "text_chunks") return "Texto por chunks";
  if (value === "direct_file") return "Archivo directo";
  return "Motor ADALO";
}

function toSafeClientErrorMessage(error: unknown) {
  if (looksLikeUploadError(error)) {
    return getUploadErrorMessage(error);
  }

  if (looksLikeQuotaOrSaturationError(error)) {
    return "Motor temporalmente ocupado. El servicio alcanzo temporalmente su limite de procesamiento. Espera unos minutos e intenta nuevamente.";
  }

  if (looksLikeHtmlOrJsonParseError(error)) {
    return "No se pudo estructurar la respuesta del modelo. Intenta nuevamente.";
  }

  if (error instanceof Error && error.message && !looksLikeRawTechnicalError(error.message)) {
    return error.message;
  }

  return "No pudimos procesar el archivo";
}

function looksLikeUploadError(value: unknown) {
  const text =
    value instanceof Error
      ? `${value.message} ${String(value.cause ?? "")}`
      : String(value ?? "");
  const normalized = text.toLowerCase();

  return (
    normalized.includes("blob") ||
    normalized.includes("upload") ||
    normalized.includes("subir el archivo") ||
    normalized.includes("file too large") ||
    normalized.includes("413")
  );
}

function getUploadErrorMessage(value: unknown) {
  const text =
    value instanceof Error
      ? `${value.message} ${String(value.cause ?? "")}`
      : String(value ?? "");
  const normalized = text.toLowerCase();

  if (
    normalized.includes("too large") ||
    normalized.includes("file_too_large") ||
    normalized.includes("413") ||
    normalized.includes("50 mb")
  ) {
    return "El archivo supera el tamaño máximo permitido de 50 MB.";
  }

  return "No pudimos subir el archivo";
}

function toSafeTechnicalDetail(value: string) {
  if (value.includes("/api/ocr/process") && value.includes("HTTP")) {
    return value
      .replace(/\s+/g, " ")
      .replace(/</g, "[")
      .replace(/>/g, "]")
      .slice(0, 180);
  }

  if (looksLikeProfileValidationError(value)) {
    return "";
  }

  if (looksLikeQuotaOrSaturationError(value)) {
    return "Limite temporal del motor IA.";
  }

  if (looksLikeHtmlOrJsonParseError(value) || looksLikeRawTechnicalError(value)) {
    return "AI response could not be converted to structured output";
  }

  return value.replace(/\s+/g, " ").replace(/</g, "[").replace(/>/g, "]").slice(0, 180);
}

function looksLikeProfileValidationError(value: unknown) {
  const normalized = String(value ?? "").toLowerCase();

  return (
    normalized.includes("profile_extraction_validation_failed") ||
    normalized.includes("profile-specific ocr validation failed") ||
    normalized.includes("profile_rejected_generic_line_csv")
  );
}

function looksLikeHtmlOrJsonParseError(value: unknown) {
  const text = value instanceof Error ? `${value.message} ${String(value.cause ?? "")}` : String(value ?? "");
  const normalized = text.toLowerCase();

  return (
    normalized.includes("unexpected token '<'") ||
    normalized.includes("<!doctype") ||
    normalized.includes("<html")
  );
}

function looksLikeRawTechnicalError(value: string) {
  const normalized = value.toLowerCase();

  return (
    normalized.includes("syntaxerror") ||
    normalized.includes("json.parse") ||
    normalized.includes("unexpected token")
  );
}

function looksLikeQuotaOrSaturationError(value: unknown) {
  const text = value instanceof Error ? `${value.message} ${String(value.cause ?? "")}` : String(value ?? "");
  const normalized = text.toLowerCase();

  return (
    normalized.includes("429") ||
    normalized.includes("too many requests") ||
    normalized.includes("quota") ||
    normalized.includes("cuota") ||
    normalized.includes("resource exhausted") ||
    normalized.includes("high demand") ||
    normalized.includes("fetch failed") ||
    normalized.includes("service unavailable") ||
    normalized.includes("saturad") ||
    normalized.includes("limite de procesamiento") ||
    normalized.includes("limite temporal")
  );
}
