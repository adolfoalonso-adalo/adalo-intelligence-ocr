export type AiStructuredOutput = {
  mode: "table" | "structured";
  columns: string[];
  rows: Array<Record<string, unknown> | unknown[]>;
};

export type ParsedStructuredOutput = {
  columns: string[];
  rows: Record<string, string>[];
};

export type ExtractionQuality = {
  quality: "high" | "medium" | "low";
  reason: string;
};

export type ExtractionQualityContext = {
  clientProfileId?: string;
  documentType?: "auto" | "table" | "invoice" | "report";
  extractionProfile?: string;
};

const COMMERCIAL_OPERATIONS_COLUMNS = [
  "TipoDocumento",
  "Organismo",
  "NumeroDocumento",
  "CUVE",
  "CADTV",
  "FechaEmision",
  "FechaCarga",
  "FechaVencimiento",
  "Motivo",
  "Emisor",
  "CUITEmisor",
  "Receptor",
  "CUITReceptor",
  "DomicilioOrigen",
  "LocalidadOrigen",
  "ProvinciaOrigen",
  "DomicilioDestino",
  "LocalidadDestino",
  "ProvinciaDestino",
  "Producto",
  "Variedad",
  "Acondicionamiento",
  "Cantidad",
  "Peso",
  "Unidad",
  "Total",
  "Importe",
  "FormaPago",
  "Transportista",
  "CUITTransportista",
  "PatenteChasis",
  "PatenteAcoplado",
  "CodigoCierre",
  "Observaciones",
] as const;

export type StructuredOutputErrorCode =
  | "AI_RESPONSE_EMPTY"
  | "AI_RESPONSE_HTML_INSTEAD_OF_JSON"
  | "AI_RESPONSE_NOT_JSON"
  | "AI_RESPONSE_INVALID_JSON"
  | "AI_RESPONSE_SCHEMA_INVALID";

export const STRUCTURED_CHUNK_COLUMNS = [
  "Sección",
  "Tipo de dato",
  "Título",
  "Descripción",
  "Fecha",
  "Expediente",
  "Empresa",
  "Volumen",
  "Cantidad",
  "Estado",
  "Riesgo",
  "Decisión/Recomendación",
  "Página",
];

const SAFE_USER_PARSE_MESSAGE =
  "No se pudo estructurar la respuesta del modelo. Intentá nuevamente.";

export class StructuredOutputError extends Error {
  readonly technicalDetail: string;
  readonly code: StructuredOutputErrorCode;

  constructor(
    message: string,
    technicalDetail: string,
    code: StructuredOutputErrorCode,
  ) {
    super(message);
    this.name = "StructuredOutputError";
    this.technicalDetail = technicalDetail;
    this.code = code;
  }
}

export function parseAiStructuredOutput(rawText: unknown): ParsedStructuredOutput {
  const safeText = safeString(rawText);
  const trimmed = safeText.replace(/^\uFEFF/, "").trim();

  if (!trimmed) {
    throw createStructuredOutputError(
      "AI_RESPONSE_EMPTY",
      "AI response was empty",
    );
  }

  if (looksLikeHtml(trimmed)) {
    throw createStructuredOutputError(
      "AI_RESPONSE_HTML_INSTEAD_OF_JSON",
      "AI returned HTML instead of JSON",
    );
  }

  const jsonText = extractJsonObject(trimmed);

  if (!jsonText) {
    const csvLikeOutput = tryParseCsvLikeOutput(trimmed);

    if (csvLikeOutput) {
      return csvLikeOutput;
    }

    throw createStructuredOutputError(
      "AI_RESPONSE_NOT_JSON",
      "AI response did not contain a JSON object",
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw createStructuredOutputError(
      "AI_RESPONSE_INVALID_JSON",
      "AI response was not valid JSON",
    );
  }

  if (!isStructuredOutput(parsed)) {
    throw createStructuredOutputError(
      "AI_RESPONSE_SCHEMA_INVALID",
      "AI response JSON did not match expected structure",
    );
  }

  const columns = parsed.columns.map((column) => normalizeCellValue(column)).filter(Boolean);

  if (columns.length === 0) {
    throw createStructuredOutputError(
      "AI_RESPONSE_SCHEMA_INVALID",
      "AI response did not include valid columns",
    );
  }

  const rows = parsed.rows.map((row) => normalizeRow(row, columns));

  return { columns, rows };
}

export function isRecoverableStructuredOutputError(error: unknown) {
  return error instanceof StructuredOutputError;
}

export function tryParseCsvLikeOutput(rawText: unknown): ParsedStructuredOutput | null {
  const text = removeMarkdownFence(safeString(rawText).replace(/^\uFEFF/, "").trim());

  if (!text || looksLikeHtml(text) || !looksLikeCsv(text)) {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return null;
  }

  const columns = parseCsvLine(lines[0]).map(normalizeCellValue).filter(Boolean);

  if (columns.length < 2 || columns.length > 40) {
    return null;
  }

  const parsedRows = lines.slice(1).map((line) => parseCsvLine(line));
  const usableRows = parsedRows.filter((row) => row.some((cell) => normalizeCellValue(cell)));

  if (usableRows.length === 0) {
    return null;
  }

  const rows = usableRows.map((row) => csvCellsToRecord(columns, row));

  return { columns, rows };
}

export function recordsToCsv(columns: string[], rows: Record<string, string>[]) {
  const columnPlan = createCsvColumnPlan(columns);
  const header = columnPlan.map(({ output }) => escapeCsvCell(output)).join(",");
  const usableRows = rows.filter((row) =>
    columnPlan.some(({ sources }) => sources.some((source) => normalizeCellValue(row[source]))),
  );
  const body = usableRows.map((row) =>
    columnPlan.map(({ sources }) => escapeCsvCell(getFirstAvailableCell(row, sources))).join(","),
  );

  return [header, ...body].join("\n");
}

export function normalizeCsvColumns(columns: string[]) {
  const seen = new Map<string, number>();

  return columns
    .map((column, index) => normalizeCsvColumnName(column, index))
    .map((column) => {
      const count = seen.get(column) ?? 0;
      seen.set(column, count + 1);

      return count === 0 ? column : `${column}_${count + 1}`;
    });
}

function createCsvColumnPlan(columns: string[]) {
  if (isCommercialOperationsSchema(columns)) {
    return COMMERCIAL_OPERATIONS_COLUMNS.map((column) => ({
      output: column,
      sources: findSourcesForCommercialColumn(column, columns),
    }));
  }

  const normalizedColumns = normalizeCsvColumns(columns);

  return columns.map((column, index) => ({
    output: normalizedColumns[index] ?? `Columna_${index + 1}`,
    sources: [column],
  }));
}

function findSourcesForCommercialColumn(targetColumn: string, columns: string[]) {
  const targetKey = normalizeCommercialColumnKey(targetColumn);
  const sources = columns.filter((column) =>
    getCommercialColumnAliases(targetKey).includes(normalizeCommercialColumnKey(column)),
  );

  return sources.length > 0 ? sources : [targetColumn];
}

function getCommercialColumnAliases(targetKey: string) {
  const aliases: Record<string, string[]> = {
    numerodocumento: ["numerodocumento", "ndocumento", "documentonumero", "nrodocumento"],
    fechaemision: ["fechaemision", "fecha"],
    peso: ["peso", "pesototal", "pesoneto", "pesobruto"],
    producto: ["producto", "productouso", "productoservicio"],
    patentechasis: ["patentechasis", "patente", "dominiochasis"],
    patenteacoplado: ["patenteacoplado", "dominioacoplado"],
    codigocierre: ["codigocierre", "codigo"],
    cuitemisor: ["cuitemisor", "cuitemitente"],
    cuitreceptor: ["cuitreceptor", "cuitdestinatario"],
    cuittransportista: ["cuittransportista"],
  };

  return aliases[targetKey] ?? [targetKey];
}

export function assessExtractionQuality(
  columns: string[],
  rows: Record<string, string>[],
  context: ExtractionQualityContext = {},
): ExtractionQuality {
  const normalizedColumns = columns.map(normalizeColumnForQuality).filter(Boolean);
  const uniqueColumns = new Set(normalizedColumns);
  const genericLineColumns = ["pagina", "linea", "texto"];
  const isLocalTextFallback =
    normalizedColumns.length === genericLineColumns.length &&
    genericLineColumns.every((column) => uniqueColumns.has(column));
  const usefulColumns = normalizedColumns.filter((column) => !isGenericQualityColumn(column));
  const nonEmptyRows = rows.filter((row) =>
    columns.some((column) => normalizeCellValue(row[column]).length > 0),
  );
  const structuredDocumentColumns = [
    "seccion",
    "categoria",
    "dato",
    "valor",
    "detalle",
    "fecha",
    "expediente resolucion",
    "empresa proyecto",
    "ubicacion",
    "observacion",
  ];
  const hasStructuredDocumentColumns =
    structuredDocumentColumns.filter((column) => uniqueColumns.has(column)).length >= 6;
  const commercialColumnCount = countCommercialOperationsColumns(normalizedColumns);
  const logisticsMovementColumnCount = countLogisticsMovementColumns(normalizedColumns);
  const isCommercialContext =
    context.documentType === "invoice" ||
    context.extractionProfile === "commercial-operations" ||
    context.clientProfileId === "mateo";
  const isVisionTableContext =
    context.extractionProfile === "vision-table" || context.clientProfileId === "movimiento";

  if (isLocalTextFallback) {
    return {
      quality: "low",
      reason: "Generic PDF text fallback columns detected",
    };
  }

  if (columns.length <= 1 || nonEmptyRows.length === 0) {
    return {
      quality: "low",
      reason: "Too few columns or rows",
    };
  }

  if (isCommercialContext && nonEmptyRows.length >= 1 && commercialColumnCount >= 6) {
    if (columns.length >= 12 && commercialColumnCount >= 8) {
      return {
        quality: "high",
        reason: "Single-row commercial operations document with useful schema",
      };
    }

    if (columns.length >= 8) {
      return {
        quality: "medium",
        reason: "Commercial operations document has usable fields",
      };
    }
  }

  if (isVisionTableContext && nonEmptyRows.length >= 1 && logisticsMovementColumnCount >= 8) {
    return {
      quality: "high",
      reason: "Logistics movement table profile with expected schema",
    };
  }

  if (context.documentType === "table" && !isVisionTableContext && nonEmptyRows.length < 3) {
    return {
      quality: "low",
      reason: "Table/list extraction requires multiple rows",
    };
  }

  if (hasStructuredDocumentColumns && columns.length > 5 && nonEmptyRows.length > 10) {
    return {
      quality: "high",
      reason: "Technical-administrative document columns detected with enough rows",
    };
  }

  if (columns.length > 3 && nonEmptyRows.length > 3 && usefulColumns.length >= 3) {
    return {
      quality: "high",
      reason: "Structured result has enough useful columns and rows",
    };
  }

  if (columns.length >= 3 && nonEmptyRows.length >= 2 && usefulColumns.length >= 2) {
    return {
      quality: "medium",
      reason: "Structured result has usable columns and rows",
    };
  }

  return {
    quality: "low",
    reason: "Result is too generic to be useful",
  };
}

export function isCommercialOperationsSchema(columns: string[]) {
  return countCommercialOperationsColumns(columns.map(normalizeColumnForQuality)) >= 6;
}

export function mergeStructuredOutputs(outputs: ParsedStructuredOutput[]): ParsedStructuredOutput {
  if (outputs.length > 0 && outputs.every(hasSameColumnsAsFirstOutput)) {
    const columns = outputs[0].columns;
    const rows = mergeRowsForColumns(outputs, columns);

    return { columns, rows };
  }

  const seen = new Set<string>();
  const rows: Record<string, string>[] = [];

  for (const output of outputs) {
    for (const row of output.rows) {
      const normalized = normalizeRow(row, STRUCTURED_CHUNK_COLUMNS);
      const signature = STRUCTURED_CHUNK_COLUMNS.map((column) => normalized[column]).join("|");

      if (seen.has(signature)) continue;

      seen.add(signature);
      rows.push(normalized);
    }
  }

  return {
    columns: STRUCTURED_CHUNK_COLUMNS,
    rows,
  };
}

export function areStructuredChunkColumns(columns: string[]) {
  return haveSameColumns(columns, STRUCTURED_CHUNK_COLUMNS);
}

export function pdfTextPagesToCsvFallback(
  pages: Array<{ pageNumber: number; text: string }>,
) {
  const columns: ["Página", "Línea", "Texto"] = ["Página", "Línea", "Texto"];
  const rows: Array<Record<string, string>> = [];

  for (const page of pages) {
    const lines = page.text
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
      .filter(Boolean);

    lines.forEach((line, index) => {
      rows.push({
        Página: String(page.pageNumber),
        Línea: String(index + 1),
        Texto: line,
      });
    });
  }

  return {
    columns,
    rows,
    csvContent: recordsToCsv(columns, rows),
  };
}

export function createChunkErrorRow(
  pageRange: string,
  description = "La respuesta del modelo no pudo estructurarse como JSON.",
): Record<string, string> {
  return normalizeRow(
    {
      Sección: "Sistema",
      "Tipo de dato": "Error de procesamiento",
      Título: "Chunk no procesado",
      Descripción: description,
      Página: pageRange,
    },
    STRUCTURED_CHUNK_COLUMNS,
  );
}

function extractJsonObject(rawText: string) {
  const unfenced = removeMarkdownFence(rawText);
  const startIndex = unfenced.indexOf("{");

  if (startIndex === -1) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < unfenced.length; index += 1) {
    const char = unfenced[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return unfenced.slice(startIndex, index + 1);
      }
    }
  }

  return "";
}

function removeMarkdownFence(value: string) {
  const trimmed = value.trim();
  const fencedMatch = trimmed.match(/^```(?:json|csv)?\s*([\s\S]*?)\s*```$/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function looksLikeCsv(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2 || !lines[0].includes(",")) {
    return false;
  }

  if (lines[0].length > 1000 || lines[0].split(",").length < 2) {
    return false;
  }

  const sampleRows = lines.slice(0, Math.min(lines.length, 8)).map(parseCsvLine);
  const headerLength = sampleRows[0]?.length ?? 0;
  const compatibleRows = sampleRows
    .slice(1)
    .filter((row) => row.length >= Math.max(2, Math.min(headerLength, 2))).length;

  return headerLength >= 2 && compatibleRows >= Math.max(1, Math.ceil((sampleRows.length - 1) / 2));
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function csvCellsToRecord(columns: string[], cells: string[]) {
  const normalizedCells =
    cells.length > columns.length
      ? [...cells.slice(0, columns.length - 1), cells.slice(columns.length - 1).join(", ")]
      : cells;
  const row: Record<string, string> = {};

  for (const [index, column] of columns.entries()) {
    row[column] = normalizeCellValue(normalizedCells[index] ?? "");
  }

  return row;
}

function looksLikeHtml(value: string) {
  const start = value.slice(0, 80).trimStart().toLowerCase();

  return (
    start.startsWith("<!doctype") ||
    start.startsWith("<html") ||
    start.startsWith("<head") ||
    start.startsWith("<body") ||
    start.startsWith("<")
  );
}

function isStructuredOutput(value: unknown): value is AiStructuredOutput {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<AiStructuredOutput>;
  return Array.isArray(candidate.columns) && Array.isArray(candidate.rows);
}

function hasSameColumnsAsFirstOutput(
  output: ParsedStructuredOutput,
  index: number,
  outputs: ParsedStructuredOutput[],
) {
  const firstColumns = outputs[0]?.columns ?? [];

  if (haveSameColumns(firstColumns, STRUCTURED_CHUNK_COLUMNS)) {
    return false;
  }

  return haveSameColumns(output.columns, firstColumns);
}

function mergeRowsForColumns(outputs: ParsedStructuredOutput[], columns: string[]) {
  const seen = new Set<string>();
  const rows: Record<string, string>[] = [];

  for (const output of outputs) {
    for (const row of output.rows) {
      const normalized = normalizeRow(row, columns);
      const signature = columns.map((column) => normalized[column]).join("|");

      if (seen.has(signature)) continue;

      seen.add(signature);
      rows.push(normalized);
    }
  }

  return rows;
}

function haveSameColumns(left: string[], right: string[]) {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

function normalizeRow(row: Record<string, unknown> | unknown[], columns: string[]) {
  const normalized: Record<string, string> = {};

  for (const column of columns) {
    normalized[column] = "";
  }

  if (Array.isArray(row)) {
    columns.forEach((column, index) => {
      normalized[column] = normalizeCellValue(row[index]);
    });
    return normalized;
  }

  if (!row || typeof row !== "object") {
    return normalized;
  }

  for (const column of columns) {
    normalized[column] = normalizeCellValue(row[column]);
  }

  return normalized;
}

function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (Array.isArray(value)) {
    return value.map(normalizeCellValue).filter(Boolean).join("; ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value).replace(/\r?\n/g, " ").trim();
  }

  return String(value).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeColumnForQuality(value: string) {
  return normalizeCellValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°º#.,:;()[\]{}_-]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function normalizeCsvColumnName(value: string, index: number) {
  const normalized = normalizeCellValue(value)
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? " " : char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || `Columna_${index + 1}`;
}

function isGenericQualityColumn(column: string) {
  return [
    "pagina",
    "linea",
    "texto",
    "estado",
    "mensaje",
  ].includes(column);
}

function countCommercialOperationsColumns(normalizedColumns: string[]) {
  const usefulCommercialColumns = new Set([
    "acondicionamiento",
    "cadtv",
    "codigocierre",
    "comprobante",
    "cuit",
    "cuitemisor",
    "cuitreceptor",
    "cuittransportista",
    "cuve",
    "domiciliodestino",
    "domicilioorigen",
    "emisor",
    "fecha",
    "fechacarga",
    "fechaemision",
    "fechavencimiento",
    "formapago",
    "importe",
    "localidaddestino",
    "localidadorigen",
    "motivo",
    "numerodocumento",
    "organismo",
    "patente",
    "patenteacoplado",
    "patentechasis",
    "peso",
    "pesototal",
    "producto",
    "productouso",
    "provinciadestino",
    "provinciaorigen",
    "receptor",
    "tipodocumento",
    "total",
    "transportista",
    "unidad",
    "variedad",
    "observaciones",
  ]);
  const matches = new Set<string>();

  for (const column of normalizedColumns) {
    const compactColumn = normalizeCommercialColumnKey(column);

    if (usefulCommercialColumns.has(compactColumn)) {
      matches.add(compactColumn);
      continue;
    }

    if (compactColumn.includes("documento") && compactColumn.includes("numero")) {
      matches.add("numerodocumento");
    }

    if (compactColumn.includes("cuit") && compactColumn.includes("emisor")) {
      matches.add("cuitemisor");
    }

    if (compactColumn.includes("cuit") && compactColumn.includes("receptor")) {
      matches.add("cuitreceptor");
    }

    if (compactColumn.includes("patente")) {
      matches.add("patente");
    }

    if (compactColumn.includes("peso")) {
      matches.add("peso");
    }
  }

  return matches.size;
}

function countLogisticsMovementColumns(normalizedColumns: string[]) {
  const required = new Set([
    "fechasalida",
    "cantidadcamion",
    "unidad",
    "tons",
    "proveedor",
    "producto",
    "origen",
    "rutacaminospuna",
    "destino",
    "fechaarribo",
    "cantidadescoltas",
  ]);
  const matches = new Set<string>();

  for (const column of normalizedColumns) {
    const compactColumn = normalizeCommercialColumnKey(column);

    if (required.has(compactColumn)) {
      matches.add(compactColumn);
      continue;
    }

    if (compactColumn.includes("fecha") && compactColumn.includes("salida")) {
      matches.add("fechasalida");
    }

    if (compactColumn.includes("fecha") && compactColumn.includes("arribo")) {
      matches.add("fechaarribo");
    }

    if (compactColumn.includes("camion")) {
      matches.add("cantidadcamion");
    }

    if (compactColumn.includes("escolta")) {
      matches.add("cantidadescoltas");
    }

    if (compactColumn.includes("ruta") && compactColumn.includes("puna")) {
      matches.add("rutacaminospuna");
    }
  }

  return matches.size;
}

function normalizeCommercialColumnKey(value: string) {
  return normalizeCellValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function getFirstAvailableCell(row: Record<string, string>, sources: string[]) {
  for (const source of sources) {
    const value = normalizeCellValue(row[source]);

    if (value) {
      return value;
    }
  }

  return "";
}

function escapeCsvCell(value: string) {
  return `"${value.replace(/\r?\n/g, " ").replace(/"/g, '""')}"`;
}

function createStructuredOutputError(
  code: StructuredOutputErrorCode,
  technicalDetail: string,
) {
  return new StructuredOutputError(SAFE_USER_PARSE_MESSAGE, technicalDetail, code);
}

function safeString(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}
