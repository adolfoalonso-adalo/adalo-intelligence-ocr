"use client";

import { useState } from "react";
import { CsvResultsPreview } from "@/components/csv-results-preview";
import { DownloadCsvButton } from "@/components/download-csv-button";
import { DownloadJsonButton } from "@/components/download-json-button";
import { PdfDropzone } from "@/components/pdf-dropzone";
import { ProcessingStatus } from "@/components/processing-status";
import { Spinner } from "@/components/spinner";
import {
  detectDocumentTypeFromFileMetadata,
  type DocumentDetectionResult,
} from "@/lib/document-detection";
import { parseCsvPreview } from "@/lib/csv-preview";
import { getSupportedMimeType } from "@/lib/validations";

export type OcrStatus = "idle" | "validating" | "ready" | "processing" | "done" | "error";

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
  resultQuality?: ResultQuality;
  durationMs?: number;
  error?: string;
  technicalDetail?: string;
};

export function OcrWorkflow() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [error, setError] = useState<string>("");
  const [technicalDetail, setTechnicalDetail] = useState<string>("");
  const [detectedDocumentType, setDetectedDocumentType] =
    useState<DocumentDetectionResult | null>(null);
  const [result, setResult] = useState<{
    csvContent: string;
    fileName: string;
    jsonContent?: string;
    jsonFileName?: string;
    allowJsonExport?: boolean;
    extractedRows: number;
    resultQuality?: ResultQuality;
    durationMs?: number;
  } | null>(null);
  const parsedResult = result ? parseCsvPreview(result.csvContent) : null;

  function handleFileSelected(selectedFile: File) {
    setFile(null);
    setResult(null);
    setError("");
    setTechnicalDetail("");
    setStatus("validating");

    window.setTimeout(() => {
      const detection = detectDocumentTypeFromFileMetadata({
        fileName: selectedFile.name,
        mimeType: getSupportedMimeType(selectedFile),
      });

      setDetectedDocumentType(detection);
      setFile(selectedFile);
      setStatus("ready");
    }, 350);
  }

  function handleInvalidFile(message: string) {
    setFile(null);
    setResult(null);
    setDetectedDocumentType(null);
    setError(message);
    setTechnicalDetail("");
    setStatus("error");
  }

  function reset() {
    setFile(null);
    setResult(null);
    setDetectedDocumentType(null);
    setError("");
    setTechnicalDetail("");
    setStatus("idle");
  }

  async function processDocument() {
    if (!file || status !== "ready") return;

    setStatus("processing");
    setError("");
    setTechnicalDetail("");
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("documentType", detectedDocumentType?.detectedType ?? "auto");

    try {
      const response = await fetch("/api/ocr/process", {
        method: "POST",
        body: formData,
      });
      const data = await readProcessResponse(response);

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
        disabled={status === "processing" || status === "validating"}
        isValidating={status === "validating"}
        onFileSelected={handleFileSelected}
        onInvalidFile={handleInvalidFile}
      />

      <div className="space-y-2 text-center text-xs leading-5 text-brand-slate">
        <p>Tus archivos se procesan de forma temporal y no se almacenan despues de la extraccion.</p>
        <p>Reconocimiento optimizado para documentos administrativos, tecnicos y comerciales.</p>
      </div>

      <ProcessingStatus
        status={status}
        details={
          status === "processing" && file
            ? file.size > 2 * 1024 * 1024
              ? "Estamos analizando el contenido para generar una salida estructurada. Puede demorar unos minutos."
              : "Estamos identificando la estructura del documento y preparando los datos para exportar."
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
      />

      {result && status === "done" ? <CsvResultsPreview csvContent={result.csvContent} /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        {status !== "done" ? (
          <button
            type="button"
            onClick={() => {
              const input = document.querySelector<HTMLInputElement>('input[type="file"]');
              input?.click();
            }}
            disabled={status === "validating" || status === "processing"}
            className="rounded-2xl border border-brand-border bg-brand-card px-5 py-3 text-sm font-semibold text-brand-deep transition hover:-translate-y-0.5 hover:border-brand-accent hover:text-brand-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {file ? "Cambiar archivo" : "Seleccionar archivo"}
          </button>
        ) : null}

        {status !== "done" ? (
          <button
            type="button"
            onClick={processDocument}
            disabled={!file || status === "validating" || status === "error" || status === "processing"}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-deep px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-deep/20 transition hover:-translate-y-0.5 hover:bg-brand-petrol disabled:cursor-not-allowed disabled:opacity-70"
          >
            {status === "processing" ? (
              <>
                <Spinner />
                Procesando...
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

async function readProcessResponse(response: Response): Promise<ProcessResponse> {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    const text = await response.text().catch(() => "");
    const responseError = new Error(
      "No se pudo estructurar la respuesta del modelo. Intenta nuevamente.",
    );
    responseError.cause = looksLikeHtmlOrJsonParseError(text)
      ? "AI response could not be converted to structured output"
      : "OCR endpoint returned a non-JSON response";
    throw responseError;
  }

  try {
    return (await response.json()) as ProcessResponse;
  } catch {
    const responseError = new Error(
      "No se pudo estructurar la respuesta del modelo. Intenta nuevamente.",
    );
    responseError.cause = "AI response could not be converted to structured output";
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
      ? ["Extraccion basica generada desde texto del PDF", "Salida CSV", "Motor ADALO"]
      : resultQuality === "partial"
        ? [
            "Se extrajo informacion util, aunque algunas secciones no pudieron estructurarse completamente",
            "Salida CSV",
            "Motor ADALO",
          ]
        : [
            formatRecordCount(extractedRows),
            ...(typeof columnCount === "number" && columnCount > 0
              ? [`${columnCount} campos estructurados`]
              : []),
            "Salida CSV",
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

function toSafeClientErrorMessage(error: unknown) {
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

function toSafeTechnicalDetail(value: string) {
  if (looksLikeQuotaOrSaturationError(value)) {
    return "Limite temporal del motor IA.";
  }

  if (looksLikeHtmlOrJsonParseError(value) || looksLikeRawTechnicalError(value)) {
    return "AI response could not be converted to structured output";
  }

  return value.replace(/\s+/g, " ").replace(/</g, "[").replace(/>/g, "]").slice(0, 180);
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
