import { recordsToCsv } from "@/lib/structured-output";
import type { PdfTextPage } from "@/lib/pdf-text";

export const STRUCTURED_SECTIONS_COLUMNS = [
  "Sección",
  "Categoría",
  "Dato",
  "Valor",
  "Detalle",
  "Fecha",
  "Expediente/Resolución",
  "Empresa/Proyecto",
  "Ubicación",
  "Observación",
];

const SECTION_MARKERS = [
  "Audiencia Pública",
  "Campamento",
  "Componentes del Proyecto",
  "Concesionario",
  "Consumo de Agua",
  "Consumo Eléctrico",
  "Correo",
  "Domicilio",
  "Documentos en Proceso",
  "Empresa",
  "Etapa del proyecto",
  "Inicio Actividad",
  "Inspecciones Realizadas",
  "Inversión",
  "Mineral/Sustancia",
  "Pozo de producción",
  "Producción anual",
  "Proyecto",
  "Representante Legal",
  "Resoluciones Anteriores",
  "Teléfono",
  "Zona Geográfica",
];

export function detectStructuredSectionsPdf(text: string): boolean {
  const normalizedText = normalizeSearchText(text);
  const matches = SECTION_MARKERS.filter((marker) =>
    normalizedText.includes(normalizeSearchText(marker)),
  );

  return matches.length >= 4;
}

export function buildStructuredSectionsFromPdfText(
  pages: PdfTextPage[],
): { columns: string[]; csvContent: string; rows: Record<string, string>[] } | null {
  const text = pages.map((page) => page.text).join("\n");

  if (!detectStructuredSectionsPdf(text)) {
    return null;
  }

  const rows: Record<string, string>[] = [];
  let currentSection = "Datos generales";

  for (const page of pages) {
    const lines = page.text
      .split(/\r?\n/)
      .map(normalizeLine)
      .filter(Boolean);

    for (const line of lines) {
      const detectedSection = detectSectionTitle(line);

      if (detectedSection) {
        currentSection = detectedSection;

        if (!isOnlySectionTitle(line, detectedSection)) {
          const value = line.replace(new RegExp(escapeRegExp(detectedSection), "i"), "").trim();
          if (value) {
            rows.push(createStructuredRow(currentSection, detectedSection, value));
          }
        }

        continue;
      }

      const bulletValue = parseBulletLine(line);

      if (bulletValue) {
        rows.push(createStructuredRow(currentSection, inferDataLabel(bulletValue), bulletValue));
        continue;
      }

      const fieldValue = parseFieldValueLine(line);

      if (fieldValue) {
        rows.push(createStructuredRow(currentSection, fieldValue.field, fieldValue.value));
        continue;
      }

      const category = inferCategory(line, currentSection);

      if (category) {
        rows.push(createStructuredRow(currentSection, inferDataLabel(line), line, category));
      }
    }
  }

  const usefulRows = dedupeRows(rows).filter((row) => row.Detalle || row.Valor);

  if (usefulRows.length < 10) {
    return null;
  }

  return {
    columns: STRUCTURED_SECTIONS_COLUMNS,
    csvContent: recordsToCsv(STRUCTURED_SECTIONS_COLUMNS, usefulRows),
    rows: usefulRows,
  };
}

function createStructuredRow(
  section: string,
  dato: string,
  value: string,
  forcedCategory?: string,
): Record<string, string> {
  const category = forcedCategory ?? inferCategory(value, section) ?? "Dato";

  return {
    Sección: section,
    Categoría: category,
    Dato: dato,
    Valor: shouldUseValueColumn(value, category) ? value : "",
    Detalle: shouldUseValueColumn(value, category) ? "" : value,
    Fecha: extractDate(value),
    "Expediente/Resolución": extractExpedienteOrResolution(value, category),
    "Empresa/Proyecto": extractEmpresaProyecto(value, dato, section),
    Ubicación: extractLocation(value, dato, section),
    Observación: "",
  };
}

function detectSectionTitle(line: string) {
  const normalizedLine = normalizeSearchText(line);

  return SECTION_MARKERS.find((marker) => {
    const normalizedMarker = normalizeSearchText(marker);
    return normalizedLine === normalizedMarker || normalizedLine.startsWith(normalizedMarker + " ");
  });
}

function isOnlySectionTitle(line: string, section: string) {
  return normalizeSearchText(line) === normalizeSearchText(section);
}

function parseBulletLine(line: string) {
  const match = line.match(/^[•\-–*]\s*(.+)$/);
  return match?.[1]?.trim() ?? "";
}

function parseFieldValueLine(line: string) {
  const match = line.match(/^([^:]{2,80}):\s*(.+)$/);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    field: match[1].trim(),
    value: match[2].trim(),
  };
}

function inferCategory(line: string, section: string) {
  const normalized = normalizeSearchText(`${section} ${line}`);

  if (normalized.includes("resolucion")) return "Resolución";
  if (normalized.includes("expediente")) return "Expediente";
  if (normalized.includes("componente")) return "Componente del proyecto";
  if (normalized.includes("inspeccion")) return "Inspección";
  if (normalized.includes("consumo") || normalized.includes("agua") || normalized.includes("electrico")) {
    return "Consumo";
  }
  if (
    normalized.includes("produccion") ||
    normalized.includes("inversion") ||
    normalized.includes("pozo")
  ) {
    return "Indicador";
  }
  if (normalized.includes("ubicacion") || normalized.includes("zona geografica") || normalized.includes("domicilio")) {
    return "Ubicación";
  }
  if (normalized.includes("proyecto") || normalized.includes("empresa") || normalized.includes("concesionario")) {
    return "Proyecto";
  }

  return "";
}

function inferDataLabel(line: string) {
  const fieldValue = parseFieldValueLine(line);
  if (fieldValue) return fieldValue.field;

  const words = line.split(/\s+/).filter(Boolean);
  return words.slice(0, 6).join(" ").replace(/[.,;:]$/, "") || "Dato";
}

function shouldUseValueColumn(value: string, category: string) {
  return (
    category === "Dato" ||
    category === "Indicador" ||
    category === "Consumo" ||
    value.length <= 80
  );
}

function extractDate(value: string) {
  return value.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}\b/)?.[0] ?? "";
}

function extractExpedienteOrResolution(value: string, category: string) {
  if (category === "Resolución" || category === "Expediente") {
    return value;
  }

  const match = value.match(/\b(?:resoluci[oó]n|expediente|expte\.?)\s*[:-]?\s*[^.;,\n]+/i);
  return match?.[0]?.trim() ?? "";
}

function extractEmpresaProyecto(value: string, dato: string, section: string) {
  const normalized = normalizeSearchText(`${dato} ${section}`);

  if (
    normalized.includes("empresa") ||
    normalized.includes("proyecto") ||
    normalized.includes("concesionario")
  ) {
    return value;
  }

  return "";
}

function extractLocation(value: string, dato: string, section: string) {
  const normalized = normalizeSearchText(`${dato} ${section}`);

  if (
    normalized.includes("ubicacion") ||
    normalized.includes("zona geografica") ||
    normalized.includes("domicilio")
  ) {
    return value;
  }

  return "";
}

function dedupeRows(rows: Record<string, string>[]) {
  const seen = new Set<string>();
  const uniqueRows: Record<string, string>[] = [];

  for (const row of rows) {
    const signature = STRUCTURED_SECTIONS_COLUMNS.map((column) => row[column] ?? "").join("|");

    if (seen.has(signature)) continue;

    seen.add(signature);
    uniqueRows.push(row);
  }

  return uniqueRows;
}

function normalizeLine(line: string) {
  return line.replace(/[ \t\f\v]+/g, " ").trim();
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°º#.,:;()[\]{}_ -]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

