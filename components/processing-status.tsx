import type {
  OcrStatus,
  OcrTextOnlyDiagnostic,
} from "@/components/ocr-workflow";
import { Spinner } from "@/components/spinner";

const statusCopy: Record<OcrStatus, string> = {
  idle: "Esperando archivo",
  validating: "Validando archivo...",
  ready: "Archivo listo para procesar",
  uploading: "Subiendo archivo...",
  processing: "Procesando archivo...",
  done: "Procesamiento completado",
  error: "No pudimos procesar el archivo",
};

type ResultQuality = "ai" | "partial" | "local-fallback";

type ProcessingStatusProps = {
  status: OcrStatus;
  details?: string;
  resultQuality?: ResultQuality;
  technicalDetail?: string;
  diagnostic?: OcrTextOnlyDiagnostic | null;
};

export function ProcessingStatus({
  status,
  details,
  resultQuality,
  technicalDetail,
  diagnostic,
}: ProcessingStatusProps) {
  const isError = status === "error";
  const isDone = status === "done";
  const isBusy =
    status === "validating" || status === "uploading" || status === "processing";
  const title = isError ? getErrorTitle(details) : getStatusTitle(status, details, resultQuality);
  const description = isError ? getErrorDescription(details) : details;

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
        isError
          ? "border-red-200 bg-red-50 text-red-700"
          : isDone
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-brand-border bg-brand-soft/70 text-brand-slate"
      }`}
      aria-live="polite"
    >
      <p className="flex items-center gap-2">
        {isBusy ? <Spinner /> : null}
        <span className="font-semibold">Estado:</span> {title}
      </p>
      {description ? <p className="mt-1 text-xs opacity-90">{description}</p> : null}
      {technicalDetail ? (
        <p className="mt-2 rounded-xl bg-white/60 px-3 py-2 text-xs opacity-90">
          <span className="font-semibold">Detalle tecnico:</span> {technicalDetail}
        </p>
      ) : null}
      {diagnostic ? <OcrDiagnosticDetails diagnostic={diagnostic} /> : null}
    </div>
  );
}

function OcrDiagnosticDetails({
  diagnostic,
}: {
  diagnostic: OcrTextOnlyDiagnostic;
}) {
  const items = [
    ["Proveedor", diagnostic.providerUsed],
    ["Perfil", diagnostic.profileUsed],
    [
      "Paginas procesadas",
      typeof diagnostic.pagesProcessed === "number"
        ? String(diagnostic.pagesProcessed)
        : undefined,
    ],
    [
      "Texto recuperado",
      typeof diagnostic.textLength === "number"
        ? `${diagnostic.textLength.toLocaleString("es-AR")} caracteres`
        : undefined,
    ],
    [
      "Puntaje de calidad",
      typeof diagnostic.qualityScore === "number"
        ? `${Math.round(diagnostic.qualityScore * 100)}%`
        : undefined,
    ],
    ["Fallback avanzado", diagnostic.fallbackUsed ? "Si" : "No"],
    ["Motivo", diagnostic.reason],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <div className="mt-3 rounded-xl border border-red-100 bg-white/70 px-3 py-3 text-xs">
      <p className="font-semibold text-red-800">Diagnostico</p>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="font-semibold text-red-700">{label}</dt>
            <dd className="mt-0.5 break-words text-red-700/90">{value}</dd>
          </div>
        ))}
      </dl>
      {diagnostic.warnings?.length ? (
        <p className="mt-3 border-t border-red-100 pt-2 text-red-700/90">
          {diagnostic.warnings.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

function getStatusTitle(status: OcrStatus, details?: string, resultQuality?: ResultQuality) {
  if (status === "done" && resultQuality === "partial") {
    return "Procesamiento completado parcialmente";
  }

  if (status === "processing" && (details ?? "").toLowerCase().includes("minutos")) {
    return "Procesando documento extenso...";
  }

  return statusCopy[status];
}

function getErrorTitle(details?: string) {
  const normalized = (details ?? "").toLowerCase();

  if (isMotorBusyError(normalized)) {
    return "Motor temporalmente ocupado";
  }

  if (normalized.includes("no pudimos estructurar el archivo")) {
    return "No pudimos estructurar el archivo con suficiente confianza";
  }

  if (normalized.includes("no se pudo estructurar la tabla logistica")) {
    return "No se pudo estructurar la tabla logistica";
  }

  if (
    normalized.includes("extracción básica no es adecuada") ||
    normalized.includes("extraccion basica no es adecuada") ||
    normalized.includes("internal-movimiento-camiones")
  ) {
    return "OCR visual tabular requerido";
  }

  if (
    normalized.includes("limite por documento") ||
    normalized.includes("límite por documento") ||
    normalized.includes("tamaño maximo") ||
    normalized.includes("tamaño máximo") ||
    normalized.includes("tamaño") ||
    normalized.includes("admiten hasta") ||
    normalized.includes("archivo excede")
  ) {
    return "Archivo excede el tamaño maximo";
  }

  if (normalized.includes("pdf, jpg") || normalized.includes("formato")) {
    return "Formato no compatible";
  }

  return "No pudimos procesar el archivo";
}

function getErrorDescription(details?: string) {
  const normalized = (details ?? "").toLowerCase();

  if (isMotorBusyError(normalized)) {
    return "El servicio alcanzo temporalmente su limite de procesamiento. Espera unos minutos e intenta nuevamente.";
  }

  if (normalized.includes("no pudimos estructurar el archivo")) {
    return "El OCR logró recuperar texto, pero el archivo presenta baja nitidez, rotación, columnas poco definidas o información desalineada. Podés descargar el texto OCR bruto o volver a intentar con una imagen más clara.";
  }

  if (normalized.includes("no se pudo estructurar la tabla logistica")) {
    return "El documento fue leido parcialmente, pero no se detecto una tabla valida para el perfil Movimiento. Proba con una imagen mas clara o solicita revision manual.";
  }

  if (
    normalized.includes("extracción básica no es adecuada") ||
    normalized.includes("extraccion basica no es adecuada") ||
    normalized.includes("internal-movimiento-camiones")
  ) {
    return "La extraccion basica no es adecuada para este documento. Se requiere OCR visual de tablas.";
  }

  if (
    normalized.includes("limite por documento") ||
    normalized.includes("límite por documento") ||
    normalized.includes("tamaño maximo") ||
    normalized.includes("tamaño máximo") ||
    normalized.includes("tamaño") ||
    normalized.includes("admiten hasta") ||
    normalized.includes("archivo excede")
  ) {
    return details;
  }

  if (normalized.includes("pdf, jpg") || normalized.includes("formato")) {
    return "Subi un archivo PDF, JPG o PNG para continuar.";
  }

  return "Verifica que el documento sea legible y volve a intentarlo. Si el problema persiste, contactanos.";
}

function isMotorBusyError(normalized: string) {
  return (
    normalized.includes("motor temporalmente ocupado") ||
    normalized.includes("limite de procesamiento") ||
    normalized.includes("límite de procesamiento") ||
    normalized.includes("429") ||
    normalized.includes("too many requests") ||
    normalized.includes("quota") ||
    normalized.includes("cuota") ||
    normalized.includes("resource exhausted") ||
    normalized.includes("high demand") ||
    normalized.includes("fetch failed") ||
    normalized.includes("service unavailable") ||
    normalized.includes("saturad")
  );
}
