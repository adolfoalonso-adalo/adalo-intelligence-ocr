export const SUPPLIER_TABLE_COLUMNS = [
  "Nombre empresa",
  "Proveedor",
  "CUIT",
  "Servicio/Área",
  "Provincia",
  "Zona de radicación",
  "Fecha/Periodo de contratación",
  "Modalidad de contratación",
] as const;

export type SupplierTableColumn = (typeof SUPPLIER_TABLE_COLUMNS)[number];

export type DocumentTableRecoveryResult = {
  confidence: number;
  detectedHeaders: string[];
  rows: Record<SupplierTableColumn, string>[];
  source:
    | "reviewer_rows"
    | "extractor_rows"
    | "document_ai_table"
    | "text_layout";
  warnings: string[];
};

const CUIT_PATTERN = /\b\d{2}-\d{8}-\d\b/g;
const DATE_PATTERN =
  /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4})(?:\s+(?:al|a)\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4})?\b/i;
const ARGENTINE_PROVINCES = [
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
];

const HEADER_ALIASES: Record<SupplierTableColumn, string[]> = {
  "Nombre empresa": [
    "nombre empresa",
    "empresa",
    "razon social",
    "razón social",
  ],
  Proveedor: ["proveedor", "nombre proveedor"],
  CUIT: ["cuit"],
  "Servicio/Área": [
    "servicio/area",
    "servicio/área",
    "servicio area",
    "servicio área",
    "area/servicio",
    "área/servicio",
  ],
  Provincia: ["provincia", "provin"],
  "Zona de radicación": [
    "zona de radicacion",
    "zona de radicación",
    "radicacion",
    "radicación",
  ],
  "Fecha/Periodo de contratación": [
    "fecha/periodo de contratacion",
    "fecha/período de contratación",
    "fecha periodo de contratacion",
    "fecha período de contratación",
    "periodo de contratacion",
    "período de contratación",
  ],
  "Modalidad de contratación": [
    "modalidad contratacion",
    "modalidad contratación",
    "modalidad de contratacion",
    "modalidad de contratación",
    "modalidal contratacion",
    "modalidal contratación",
  ],
};

const WARNING_ALIGNMENT =
  "La revisión automática detectó dudas de alineación, pero se reconstruyó una tabla utilizable a partir de encabezados y CUIT detectados.";
const WARNING_MANUAL_REVIEW =
  "Se recomienda revisión manual de filas con celdas partidas.";

export function normalizeDocumentTableFromTextLayout(input: {
  extractedHeaders?: string[];
  extractedRows?: Record<string, string>[];
  rawTextContent: string;
  reviewerConfidence: number;
  reviewedHeaders?: string[];
  reviewedRows?: Record<string, string>[];
}): DocumentTableRecoveryResult | null {
  const detectedHeaders = detectSupplierHeaders([
    ...(input.reviewedHeaders ?? []),
    ...(input.extractedHeaders ?? []),
    input.rawTextContent,
  ]);
  const cuitCount = new Set(input.rawTextContent.match(CUIT_PATTERN) ?? [])
    .size;

  if (detectedHeaders.length < 5 || cuitCount < 5) {
    return null;
  }

  const candidates: Array<{
    rows: Record<SupplierTableColumn, string>[];
    source: DocumentTableRecoveryResult["source"];
  }> = [
    {
      rows: normalizeCandidateRows(input.reviewedRows ?? []),
      source: "reviewer_rows",
    },
    {
      rows: normalizeCandidateRows(input.extractedRows ?? []),
      source: "extractor_rows",
    },
    {
      rows: extractPipeDelimitedRows(input.rawTextContent),
      source: "document_ai_table",
    },
    {
      rows: extractRowsAroundCuit(input.rawTextContent),
      source: "text_layout",
    },
  ];
  const best = candidates
    .map((candidate) => ({
      ...candidate,
      rows: deduplicateRows(candidate.rows).filter(isUsableSupplierRow),
    }))
    .sort((left, right) => right.rows.length - left.rows.length)[0];

  if (!best || best.rows.length < 5) {
    return null;
  }

  return {
    confidence: Math.max(input.reviewerConfidence, 0.65),
    detectedHeaders: [...SUPPLIER_TABLE_COLUMNS],
    rows: best.rows,
    source: best.source,
    warnings: [WARNING_ALIGNMENT, WARNING_MANUAL_REVIEW],
  };
}

export function detectSupplierHeaders(values: string[]) {
  const searchable = normalizeKey(values.join(" "));

  return SUPPLIER_TABLE_COLUMNS.filter((column) =>
    HEADER_ALIASES[column].some((alias) =>
      searchable.includes(normalizeKey(alias)),
    ),
  );
}

export function countValidCuits(rows: Record<string, string>[]) {
  return new Set(
    rows
      .map((row) => String(row.CUIT ?? "").match(CUIT_PATTERN)?.[0] ?? "")
      .filter(Boolean),
  ).size;
}

function normalizeCandidateRows(rows: Record<string, string>[]) {
  return rows.map((row) => {
    const normalized = createEmptyRow();

    for (const [sourceHeader, value] of Object.entries(row)) {
      const targetHeader = resolveSupplierHeader(sourceHeader);
      if (targetHeader) normalized[targetHeader] = cleanCell(value);
    }

    return normalized;
  });
}

function extractPipeDelimitedRows(rawText: string) {
  const lines = getUsefulLines(rawText);
  let headerMap: Array<SupplierTableColumn | null> = [];
  const rows: Record<SupplierTableColumn, string>[] = [];

  for (const line of lines) {
    if (!line.includes("|")) continue;
    const cells = line.split("|").map(cleanCell);
    const candidateMap = cells.map(resolveSupplierHeader);

    if (candidateMap.filter(Boolean).length >= 5) {
      headerMap = candidateMap;
      continue;
    }
    const containsCuit = cells.some((cell) => {
      CUIT_PATTERN.lastIndex = 0;
      return CUIT_PATTERN.test(cell);
    });
    CUIT_PATTERN.lastIndex = 0;
    if (headerMap.length === 0 || !containsCuit) continue;

    const row = createEmptyRow();
    cells.forEach((cell, index) => {
      const header = headerMap[index];
      if (header) row[header] = cell;
    });
    rows.push(row);
  }

  return rows;
}

function extractRowsAroundCuit(rawText: string) {
  const lines = getUsefulLines(rawText).filter(
    (line) => !line.includes("|") && !resolveSupplierHeader(line),
  );
  const anchors = lines
    .map((line, index) => ({
      cuit: line.match(CUIT_PATTERN)?.[0],
      index,
    }))
    .filter(
      (anchor): anchor is { cuit: string; index: number } =>
        Boolean(anchor.cuit),
    );

  return anchors.map((anchor, anchorIndex) => {
    const previousIndex =
      anchorIndex > 0 ? anchors[anchorIndex - 1].index : -1;
    const nextIndex =
      anchorIndex + 1 < anchors.length
        ? anchors[anchorIndex + 1].index
        : lines.length;
    const before = lines
      .slice(Math.max(previousIndex + 1, anchor.index - 4), anchor.index)
      .filter((line) => !looksLikeMetadata(line));
    const after = lines
      .slice(anchor.index + 1, nextIndex)
      .filter((line) => !looksLikeMetadata(line));
    const nextIdentityLines =
      anchorIndex + 1 < anchors.length ? Math.min(2, after.length) : 0;
    const rowContent =
      nextIdentityLines > 0 ? after.slice(0, -nextIdentityLines) : after;
    const row = createEmptyRow();
    const provinceIndex = rowContent.findIndex((line) =>
      Boolean(findProvince(line)),
    );
    const dateIndex = rowContent.findIndex((line) => DATE_PATTERN.test(line));

    row["Nombre empresa"] = cleanCell(before.at(-2) ?? "");
    row.Proveedor = cleanCell(before.at(-1) ?? "");
    row.CUIT = anchor.cuit;
    row["Servicio/Área"] = cleanCell(
      rowContent
        .slice(0, provinceIndex >= 0 ? provinceIndex : 1)
        .join(" "),
    );
    row.Provincia =
      provinceIndex >= 0 ? findProvince(rowContent[provinceIndex]) ?? "" : "";
    row["Zona de radicación"] = cleanCell(
      rowContent
        .slice(
          provinceIndex >= 0 ? provinceIndex + 1 : 1,
          dateIndex >= 0 ? dateIndex : Math.max(rowContent.length - 1, 1),
        )
        .join(" "),
    );
    row["Fecha/Periodo de contratación"] =
      dateIndex >= 0 ? cleanCell(rowContent[dateIndex]) : "";
    row["Modalidad de contratación"] = cleanCell(
      dateIndex >= 0
        ? rowContent.slice(dateIndex + 1).join(" ")
        : rowContent.at(-1) ?? "",
    );

    return row;
  });
}

function resolveSupplierHeader(value: string): SupplierTableColumn | null {
  const key = normalizeKey(value);

  for (const column of SUPPLIER_TABLE_COLUMNS) {
    if (
      HEADER_ALIASES[column].some((alias) => {
        const aliasKey = normalizeKey(alias);
        return key === aliasKey || key.includes(aliasKey);
      })
    ) {
      return column;
    }
  }

  return null;
}

function isUsableSupplierRow(row: Record<SupplierTableColumn, string>) {
  if (!/^\d{2}-\d{8}-\d$/.test(row.CUIT)) return false;

  const companySet = [row["Nombre empresa"], row.Proveedor, row.CUIT].filter(
    Boolean,
  ).length;
  const serviceSet = [row.Proveedor, row.CUIT, row["Servicio/Área"]].filter(
    Boolean,
  ).length;

  return companySet === 3 || serviceSet === 3;
}

function deduplicateRows(rows: Record<SupplierTableColumn, string>[]) {
  const seen = new Set<string>();

  return rows.filter((row) => {
    const key = `${row.CUIT}|${normalizeKey(row.Proveedor)}|${normalizeKey(
      row["Servicio/Área"],
    )}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createEmptyRow(): Record<SupplierTableColumn, string> {
  return Object.fromEntries(
    SUPPLIER_TABLE_COLUMNS.map((column) => [column, ""]),
  ) as Record<SupplierTableColumn, string>;
}

function getUsefulLines(rawText: string) {
  return rawText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(cleanCell)
    .filter(Boolean)
    .filter(
      (line) =>
        !/camscanner|https?:\/\/|^\s*(pagina|página)\s+\d+\s+tabla\s+\d+\s*$/i.test(
          line,
        ),
    );
}

function findProvince(value: string) {
  const normalized = normalizeKey(value);
  return ARGENTINE_PROVINCES.find(
    (province) => normalizeKey(province) === normalized,
  );
}

function looksLikeMetadata(value: string) {
  return (
    resolveSupplierHeader(value) !== null ||
    /^(folio|secretaria|sec|pagina|página)\b/i.test(value)
  );
}

function cleanCell(value: unknown) {
  return [...String(value ?? "")]
    .map((character) => {
      const code = character.charCodeAt(0);
      const allowedWhitespace = code === 9 || code === 10 || code === 13;
      return code < 32 && !allowedWhitespace || code === 127
        ? " "
        : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value: string) {
  return cleanCell(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}
