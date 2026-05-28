import { recordsToCsv } from "@/lib/structured-output";
import type { PdfTextPage } from "@/lib/pdf-text";

export const KNOWN_ANEXO_TABLE_COLUMNS = [
  "N° Anexo",
  "Nombre Anexo",
  "Romano",
  "N° Punto",
  "Frecuencia",
  "Tipo de Plazo",
  "Cant. Días",
];

export function buildKnownAnexoTableFromPdfText(
  pages: PdfTextPage[],
): { columns: string[]; csvContent: string; rows: Record<string, string>[] } | null {
  const text = pages.map((page) => page.text).join("\n");

  if (!looksLikeKnownAnexoTable(text)) {
    return null;
  }

  const rows: Record<string, string>[] = [];
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean);
  const lines = joinWrappedTableLines(rawLines);

  for (const line of lines) {
    const row = parseKnownAnexoLine(line);

    if (row) {
      rows.push(row);
    }
  }

  if (rows.length < 3) {
    return null;
  }

  return {
    columns: KNOWN_ANEXO_TABLE_COLUMNS,
    csvContent: recordsToCsv(KNOWN_ANEXO_TABLE_COLUMNS, rows),
    rows,
  };
}

function parseKnownAnexoLine(line: string) {
  const match = line.match(
    /^(\d+)\s+(.+?)\s+([IVXLCDM]+)\s+(\d+)\s+(Permanente|Única|Unica|Por evento|Anual|Bianual|Mensual|Trimestral)\s+(Permanente|Sin plazo|Días corridos|Dias corridos|Días hábiles|Dias habiles|Calendario)?\s*(\d+)?$/i,
  );

  if (!match) return null;

  return {
    "N° Anexo": match[1] ?? "",
    "Nombre Anexo": match[2]?.trim() ?? "",
    Romano: match[3] ?? "",
    "N° Punto": match[4] ?? "",
    Frecuencia: match[5]?.trim() ?? "",
    "Tipo de Plazo": match[6]?.trim() ?? "",
    "Cant. Días": match[7] ?? "",
  };
}

function joinWrappedTableLines(lines: string[]) {
  const joined: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];

    if (line && next && /^\d+\s+/.test(line) && !/\s+[IVXLCDM]+\s+\d+\s+/.test(line)) {
      joined.push(`${line} ${next}`);
      index += 1;
      continue;
    }

    joined.push(line);
  }

  return joined;
}

function looksLikeKnownAnexoTable(value: string) {
  const normalized = normalizeSearchText(value);
  const markers = [
    "n anexo",
    "nombre anexo",
    "romano",
    "n punto",
    "frecuencia",
    "tipo de plazo",
    "cant dias",
  ];

  return markers.filter((marker) => normalized.includes(marker)).length >= 5;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°º#.,:;()[\]{}_-]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}
