"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useState } from "react";
import { CsvResultsPreview } from "@/components/csv-results-preview";
import { DownloadCsvButton } from "@/components/download-csv-button";
import { DownloadJsonButton } from "@/components/download-json-button";
import { DownloadRawTextButton } from "@/components/download-raw-text-button";
import { DownloadXlsxButton } from "@/components/download-xlsx-button";
import { PdfDropzone } from "@/components/pdf-dropzone";
import { ProcessingStatus } from "@/components/processing-status";
import {
  ProcessingProgress,
  type ProcessingProgressStage,
} from "@/components/processing-progress";
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

type PersonnelQualityMetrics = {
  filasConCUIL: number;
  filasConLocalidad: number;
  filasConLugarTrabajo: number;
  filasConNombre: number;
  filasConProvincia: number;
  porcentajeCompletitud: number;
  totalRegistros: number;
};

type CompanyPersonnelQualityMetrics = {
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

type ProcessingProgressState = {
  currentStep: string;
  debugStage?: string;
  detailMessage: string;
  isIndeterminate: boolean;
  percentage: number;
  stage: ProcessingProgressStage;
};

const INITIAL_PROGRESS: ProcessingProgressState = {
  currentStep: "Preparando archivo…",
  detailMessage: "Estamos preparando el circuito de procesamiento.",
  isIndeterminate: false,
  percentage: 0,
  stage: "preparing",
};

type ProcessResponse = {
  success: boolean;
  csvContent?: string;
  fileName?: string;
  jsonContent?: string;
  jsonFileName?: string;
  xlsxContentBase64?: string;
  xlsxFileName?: string;
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
  multimodalFallbackAttempted?: boolean;
  visualStructuringProvider?: string;
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
  personnelQualityMetrics?: PersonnelQualityMetrics;
  companyPersonnelQualityMetrics?: CompanyPersonnelQualityMetrics;
  orientationSelected?: number;
  automaticReviewApplied?: boolean;
  correctionsApplied?: string[];
  detectedDocumentType?: string;
  detectedHeaders?: string[];
  documentTitle?: string;
  confidence?: number;
  allowedProfiles?: string[];
  detectedProfileBeforeRestriction?: string;
  forcedProfile?: string;
  restrictionMode?: string;
  restrictionReason?: string;
};

export type OcrTextOnlyDiagnostic = {
  providerUsed?: string;
  fallbackUsed?: boolean;
  multimodalFallbackAttempted?: boolean;
  visualStructuringProvider?: string;
  profileUsed?: string;
  pagesProcessed?: number;
  textLength?: number;
  qualityScore?: number;
  qualityStatus?: string;
  reason?: string;
  warnings?: string[];
  rawTextContent?: string;
  rawTextFileName?: string;
  companyPersonnelQualityMetrics?: CompanyPersonnelQualityMetrics;
  orientationSelected?: number;
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
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
  const [ocrStartedAt, setOcrStartedAt] = useState<number | null>(null);
  const [progress, setProgress] =
    useState<ProcessingProgressState>(INITIAL_PROGRESS);
  const [result, setResult] = useState<{
    csvContent: string;
    fileName: string;
    jsonContent?: string;
    jsonFileName?: string;
    xlsxContentBase64?: string;
    xlsxFileName?: string;
    allowJsonExport?: boolean;
    extractedRows: number;
    profileCode?: string;
    profileName?: string;
    extractionMode?: string;
    extractionType?: string;
    resultQuality?: ResultQuality;
    durationMs?: number;
    personnelQualityMetrics?: PersonnelQualityMetrics;
    companyPersonnelQualityMetrics?: CompanyPersonnelQualityMetrics;
    orientationSelected?: number;
    automaticReviewApplied?: boolean;
    correctionsApplied?: string[];
    detectedDocumentType?: string;
    detectedHeaders?: string[];
    documentTitle?: string;
    confidence?: number;
    warnings?: string[];
    allowedProfiles?: string[];
    detectedProfileBeforeRestriction?: string;
    forcedProfile?: string;
    restrictionMode?: string;
    restrictionReason?: string;
  } | null>(null);
  const parsedResult = result ? parseCsvPreview(result.csvContent) : null;
  const showProcessingProgress =
    processingStartedAt !== null &&
    (status === "uploading" ||
      status === "processing" ||
      status === "done" ||
      status === "error");
  const isLargeOrExtendedDocument =
    file !== null &&
    (file.size > 2 * 1024 * 1024 || file.type === "application/pdf");

  useEffect(() => {
    if (status !== "processing" || !file || !ocrStartedAt) return;

    const updateEstimatedProgress = () => {
      setProgress(
        getEstimatedOcrProgress({
          elapsedMs: Date.now() - ocrStartedAt,
          isPdf: file.type === "application/pdf",
        }),
      );
    };

    updateEstimatedProgress();
    const intervalId = window.setInterval(updateEstimatedProgress, 1000);

    return () => window.clearInterval(intervalId);
  }, [file, ocrStartedAt, status]);

  function handleFileSelected(selectedFile: File) {
    setFile(null);
    setResult(null);
    setError("");
    setTechnicalDetail("");
    setTextOnlyDiagnostic(null);
    setProcessingStartedAt(null);
    setOcrStartedAt(null);
    setProgress(INITIAL_PROGRESS);
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
    setProcessingStartedAt(null);
    setOcrStartedAt(null);
    setProgress(INITIAL_PROGRESS);
    setStatus("idle");
  }

  async function processDocument() {
    if (!file || (status !== "ready" && status !== "error")) return;

    const startedAt = Date.now();
    setProcessingStartedAt(startedAt);
    setOcrStartedAt(null);
    setProgress(INITIAL_PROGRESS);
    setStatus("uploading");
    setError("");
    setTechnicalDetail("");
    setTextOnlyDiagnostic(null);
    setResult(null);

    try {
      const mimeType = getSupportedMimeType(file);
      await waitForProgressPaint();
      setProgress({
        currentStep: "Subiendo documento de forma segura…",
        debugStage: "upload:start",
        detailMessage: "La carga se realiza mediante un canal temporal y seguro.",
        isIndeterminate: false,
        percentage: 10,
        stage: "uploading",
      });
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
          const roundedPercentage = Math.round(percentage);
          setProgress({
            currentStep: "Subiendo documento de forma segura…",
            debugStage: "upload:start",
            detailMessage: `Carga segura del archivo: ${roundedPercentage}%`,
            isIndeterminate: false,
            percentage: roundedPercentage >= 50 ? 25 : 10,
            stage: "uploading",
          });
        },
      });

      console.info("upload:complete", {
        endpoint: "/api/upload",
        method: "POST",
        pathname: blob.pathname,
      });
      setProgress({
        currentStep: "Archivo cargado correctamente…",
        debugStage: "upload:complete",
        detailMessage: "La carga terminó. Estamos iniciando el análisis documental.",
        isIndeterminate: true,
        percentage: 40,
        stage: "preprocessing",
      });
      setStatus("processing");
      setOcrStartedAt(Date.now());

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
          multimodalFallbackAttempted:
            data.multimodalFallbackAttempted,
          visualStructuringProvider:
            data.visualStructuringProvider,
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
          companyPersonnelQualityMetrics:
            data.companyPersonnelQualityMetrics,
          orientationSelected: data.orientationSelected,
        });
        setError(data.error || "No pudimos estructurar el archivo");
        setTechnicalDetail(data.technicalDetail || "");
        setProgress({
          currentStep: "No pudimos estructurar el archivo con suficiente confianza",
          debugStage: "quality-gate:failed",
          detailMessage:
            "El OCR logró recuperar texto, pero el archivo presenta baja nitidez, rotación, columnas poco definidas o información desalineada. Podés descargar el texto OCR bruto o volver a intentar con una imagen más clara.",
          isIndeterminate: false,
          percentage: 90,
          stage: "error",
        });
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
        xlsxContentBase64: data.xlsxContentBase64,
        xlsxFileName: data.xlsxFileName,
        allowJsonExport: data.allowJsonExport,
        extractedRows: data.extractedRows ?? 0,
        profileCode: data.profileCode,
        profileName: data.profileName,
        extractionMode: data.extractionMode,
        extractionType: data.extractionType,
        resultQuality: data.resultQuality,
        durationMs: data.durationMs,
        personnelQualityMetrics: data.personnelQualityMetrics,
        companyPersonnelQualityMetrics:
          data.companyPersonnelQualityMetrics,
        orientationSelected: data.orientationSelected,
        automaticReviewApplied: data.automaticReviewApplied,
        correctionsApplied: data.correctionsApplied,
        detectedDocumentType: data.detectedDocumentType,
        detectedHeaders: data.detectedHeaders,
        documentTitle: data.documentTitle,
        confidence: data.confidence,
        warnings: data.warnings,
        allowedProfiles: data.allowedProfiles,
        detectedProfileBeforeRestriction:
          data.detectedProfileBeforeRestriction,
        forcedProfile: data.forcedProfile,
        restrictionMode: data.restrictionMode,
        restrictionReason: data.restrictionReason,
      });
      setProgress({
        currentStep: "Procesamiento completado",
        debugStage: "cleanup:complete",
        detailMessage:
          "Los datos fueron estructurados correctamente y ya podés descargar los resultados.",
        isIndeterminate: false,
        percentage: 100,
        stage: "completed",
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
      setProgress((currentProgress) => ({
        currentStep: "No pudimos completar el procesamiento",
        debugStage: "processing:error",
        detailMessage:
          "El proceso se detuvo. Revisá el diagnóstico y volvé a intentar o cambiá el archivo.",
        isIndeterminate: false,
        percentage: currentProgress.percentage,
        stage: "error",
      }));
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

      {status !== "uploading" && status !== "processing" ? (
        <ProcessingStatus
          status={status}
          details={
            status === "done" && result
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
      ) : null}

      {showProcessingProgress ? (
        <ProcessingProgress
          percentage={progress.percentage}
          currentStep={progress.currentStep}
          detailMessage={progress.detailMessage}
          stage={progress.stage}
          isIndeterminate={progress.isIndeterminate}
          startedAt={processingStartedAt}
          elapsedTime={status === "done" ? result?.durationMs : undefined}
          debugStage={progress.debugStage}
          showDebug={allowProfileTesting && accessMode === "master"}
          showLongDocumentHint={isLargeOrExtendedDocument}
        />
      ) : null}

      {result && status === "done" && result.profileName ? (
        <div className="rounded-2xl border border-brand-border bg-brand-card px-4 py-3 text-center text-xs leading-5 text-brand-slate">
          <p className="font-semibold text-brand-deep">
            Tipo detectado: {result.extractionType || result.profileName}
          </p>
          <p>
            Extraccion: {formatExtractionMode(result.extractionMode)}
            {" · "}
            Salida: CSV + JSON + Excel
          </p>
          {result.detectedHeaders?.length ? (
            <p className="mt-1">
              Encabezados detectados: {result.detectedHeaders.join(" · ")}
            </p>
          ) : null}
          <p className="mt-1">
            {typeof result.confidence === "number"
              ? `Confianza: ${Math.round(result.confidence * 100)}%`
              : null}
            {result.automaticReviewApplied
              ? `${typeof result.confidence === "number" ? " · " : ""}Revision automatica aplicada`
              : ""}
          </p>
          {result.correctionsApplied?.length ? (
            <p className="mt-1">
              Correcciones: {result.correctionsApplied.join(" · ")}
            </p>
          ) : null}
          {result.warnings?.length ? (
            <p className="mt-1">
              Advertencias: {result.warnings.slice(0, 3).join(" · ")}
            </p>
          ) : null}
          {allowProfileTesting && accessMode === "master" && result.profileCode ? (
            <div className="mt-1 text-[11px] opacity-70">
              <p>profileUsed: {result.profileCode}</p>
              <p>
                restrictionMode: {result.restrictionMode ?? "automatic"}
                {result.forcedProfile
                  ? ` · forcedProfile: ${result.forcedProfile}`
                  : ""}
              </p>
              {result.detectedProfileBeforeRestriction ? (
                <p>
                  detectedProfileBeforeRestriction:{" "}
                  {result.detectedProfileBeforeRestriction}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {result?.personnelQualityMetrics && status === "done" ? (
        <div className="rounded-2xl border border-brand-border bg-brand-card px-4 py-3 text-center text-xs leading-5 text-brand-slate">
          <p className="font-semibold text-brand-deep">Calidad de la nómina</p>
          <p className="mt-1">
            {result.personnelQualityMetrics.totalRegistros} registros
            {" · "}
            {result.personnelQualityMetrics.filasConNombre} con nombre
            {" · "}
            {result.personnelQualityMetrics.filasConCUIL} con CUIL
            {" · "}
            {result.personnelQualityMetrics.filasConLugarTrabajo} con lugar de trabajo
          </p>
          <p>
            {result.personnelQualityMetrics.filasConLocalidad} con localidad
            {" · "}
            {result.personnelQualityMetrics.filasConProvincia} con provincia
            {" · "}
            {formatPercentage(result.personnelQualityMetrics.porcentajeCompletitud)} de completitud
          </p>
        </div>
      ) : null}

      {result?.companyPersonnelQualityMetrics && status === "done" ? (
        <div className="rounded-2xl border border-brand-border bg-brand-card px-4 py-3 text-center text-xs leading-5 text-brand-slate">
          <p className="font-semibold text-brand-deep">
            Diagnóstico del listado de personal
          </p>
          <p className="mt-1">
            Tipo detectado: Listado de personal por empresa/localidad
            {" · "}
            Orientación seleccionada: {result.orientationSelected ?? 0}°
          </p>
          <p>
            {result.companyPersonnelQualityMetrics.empresasDetectadas} empresa(s)
            {" · "}
            {result.companyPersonnelQualityMetrics.cuitsDetectados} CUIT
            {" · "}
            {result.companyPersonnelQualityMetrics.dnisDetectados} DNI
            {" · "}
            {result.companyPersonnelQualityMetrics.registrosEstructurados} registros
          </p>
          <p>
            {formatPercentage(
              result.companyPersonnelQualityMetrics.porcentajeCompletitud,
            )} de completitud
          </p>
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
            ) : status === "error" ? (
              "Reintentar"
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
            {result.xlsxContentBase64 && result.xlsxFileName ? (
              <DownloadXlsxButton
                base64Content={result.xlsxContentBase64}
                fileName={result.xlsxFileName}
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

function getEstimatedOcrProgress({
  elapsedMs,
  isPdf,
}: {
  elapsedMs: number;
  isPdf: boolean;
}): ProcessingProgressState {
  const elapsedSeconds = elapsedMs / 1000;

  if (elapsedSeconds < 7) {
    if (isPdf) {
      const pdfSteps = [
        {
          currentStep: "Analizando páginas del PDF…",
          debugStage: "preprocessing:start",
          detailMessage: "Detectando si el PDF es digital o escaneado.",
        },
        {
          currentStep: "Detectando orientación y calidad visual…",
          debugStage: "orientation:selected",
          detailMessage: "Estamos revisando rotación, nitidez y estructura de las páginas.",
        },
        {
          currentStep: "Procesando páginas relevantes…",
          debugStage: "preprocessing:start",
          detailMessage: "Optimizando el PDF para mejorar la lectura.",
        },
      ];
      const step = pdfSteps[Math.min(Math.floor(elapsedSeconds / 2.3), 2)];

      return {
        ...step,
        isIndeterminate: true,
        percentage: 60,
        stage: "preprocessing",
      };
    }

    const imageSteps = [
      {
        currentStep: "Analizando orientación de la imagen…",
        debugStage: "preprocessing:start",
        detailMessage: "Estamos revisando nitidez, contraste y encuadre.",
      },
      {
        currentStep: "Probando rotaciones para mejorar la lectura…",
        debugStage: "orientation:selected",
        detailMessage: "Buscamos la orientación que permita recuperar más información.",
      },
      {
        currentStep: "Seleccionando la versión más legible…",
        debugStage: "orientation:selected",
        detailMessage: "Optimizando la imagen antes de iniciar el OCR.",
      },
    ];
    const step = imageSteps[Math.min(Math.floor(elapsedSeconds / 2.3), 2)];

    return {
      ...step,
      isIndeterminate: true,
      percentage: 60,
      stage: "preprocessing",
    };
  }

  if (elapsedSeconds < 18) {
    return elapsedSeconds < 13
      ? {
          currentStep: "Procesando con motor OCR avanzado…",
          debugStage: "document-ai:start",
          detailMessage: "Recuperando texto y estructura visual del documento.",
          isIndeterminate: true,
          percentage: 75,
          stage: "ocr",
        }
      : {
          currentStep: "Recuperando texto del documento…",
          debugStage: "document-ai:complete",
          detailMessage: "Seguimos procesando según la calidad y extensión del archivo.",
          isIndeterminate: true,
          percentage: 75,
          stage: "ocr",
        };
  }

  const finalSteps = [
    {
      currentStep: "Clasificando información extraída…",
      debugStage: "classifier:start",
      detailMessage: "Identificando el tipo documental y la estructura más adecuada.",
      stage: "structuring" as const,
    },
    {
      currentStep: "Detectando tablas, columnas y patrones…",
      debugStage: "classifier:complete",
      detailMessage: "Buscando encabezados, filas y campos repetidos.",
      stage: "structuring" as const,
    },
    {
      currentStep: "Normalizando datos extraídos…",
      debugStage: "structuring:start",
      detailMessage: "Convirtiendo texto en columnas ordenadas y coherentes.",
      stage: "structuring" as const,
    },
    {
      currentStep: "Intentando interpretación visual avanzada…",
      debugStage: "multimodal-fallback:start",
      detailMessage:
        "Si la estructura inicial no alcanza, analizamos visualmente las páginas relevantes.",
      stage: "structuring" as const,
    },
    {
      currentStep: "Reconstruyendo columnas desde la imagen…",
      debugStage: "multimodal-fallback:structuring",
      detailMessage:
        "Estamos contrastando la disposición visual con el texto OCR recuperado.",
      stage: "structuring" as const,
    },
    {
      currentStep: "Validando confiabilidad de los resultados…",
      debugStage: "multimodal-fallback:quality-gate",
      detailMessage: "Validando estructura generada, filas y campos clave.",
      stage: "quality" as const,
    },
    {
      currentStep: "Generando archivos de salida…",
      debugStage: "output-generation:start",
      detailMessage: "Preparando CSV y JSON para la descarga.",
      stage: "output" as const,
    },
    {
      currentStep: "Finalizando procesamiento…",
      debugStage: "output-generation:start",
      detailMessage:
        "Seguimos procesando, esto puede demorar según la calidad y extensión del archivo.",
      stage: "output" as const,
    },
  ];
  const finalStepIndex = Math.floor((elapsedSeconds - 18) / 6) % finalSteps.length;

  return {
    ...finalSteps[finalStepIndex],
    isIndeterminate: true,
    percentage: 90,
  };
}

function waitForProgressPaint() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 180);
  });
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

function formatPercentage(value: number) {
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function formatExtractionMode(value?: string) {
  if (value === "agentic_document_table") {
    return "Extraccion documental con revision automatica";
  }
  if (value === "vision_table") return "OCR visual tabular";
  if (value === "multimodal_structured") return "Interpretación visual avanzada";
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
