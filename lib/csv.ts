export type CsvFileKind =
  | "COMPROBANTE"
  | "DOCUMENTO_TECNICO"
  | "EXTRACCION_BASICA"
  | "GENERAL"
  | "LISTADO"
  | "MOVIMIENTO"
  | "NOMINA"
  | "PDF_TABULAR";

export function createCsvFileName(kind: CsvFileKind = "GENERAL", date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `ADALO_OCR_${kind}_${year}${month}${day}_${hours}${minutes}.csv`;
}

export function stripCodeFences(value: string) {
  return value
    .trim()
    .replace(/^```(?:csv)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function extractCsvContent(value: string) {
  const trimmed = value.replace(/^\uFEFF/, "").trim();
  const fencedCsv = trimmed.match(/```(?:csv)?\s*([\s\S]*?)```/i);
  const candidate = fencedCsv?.[1] ? fencedCsv[1].trim() : stripCodeFences(trimmed);
  const lines = candidate
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const firstCsvLineIndex = lines.findIndex(isLikelyCsvLine);

  if (firstCsvLineIndex === -1) {
    return "";
  }

  const lastCsvLineIndex = findLastCsvLineIndex(lines);
  return lines.slice(firstCsvLineIndex, lastCsvLineIndex + 1).join("\n").trim();
}

export function validateCsvContent(csvContent: string) {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { valid: false, reason: "La respuesta de IA no contiene contenido CSV." };
  }

  if (!isLikelyCsvLine(lines[0])) {
    return { valid: false, reason: "La respuesta de IA no contiene una línea de encabezados CSV." };
  }

  return { valid: true, reason: "" };
}

export function countCsvRows(csvContent: string) {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return Math.max(lines.length - 1, 0);
}

function findLastCsvLineIndex(lines: string[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isLikelyCsvLine(lines[index])) {
      return index;
    }
  }

  return lines.length - 1;
}

function isLikelyCsvLine(line: string) {
  const normalized = line.trim();

  if (!normalized || normalized.startsWith("```")) {
    return false;
  }

  return normalized.split(",").length >= 2;
}
