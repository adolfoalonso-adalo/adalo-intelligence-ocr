import OpenAI from "openai";
import {
  getClientProfileCode,
  isPersonnelRosterProfile,
  type ClientProfile,
} from "@/lib/client-profiles";
import { createCsvFileName } from "@/lib/csv";
import type { DocumentPreprocessingResult } from "@/lib/document-preprocessing";
import type { DocumentType } from "@/lib/document-type";
import {
  CsvAnalysisError,
  type CsvAnalysisResult,
} from "@/lib/google-ai";
import {
  getPdfPageCount,
  renderPdfPageToImage,
} from "@/lib/pdf-page-render";
import { recordsToCsv } from "@/lib/structured-output";

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

const TECHNICAL_ADMIN_COLUMNS = [
  "Seccion",
  "Categoria",
  "Dato",
  "Valor",
  "Detalle",
  "Fecha",
  "Expediente/Resolucion",
  "Empresa/Proyecto",
  "Ubicacion",
  "Observacion",
] as const;

type OpenAiVisualExtraction = {
  assumptions?: unknown;
  columns?: unknown;
  confidence?: unknown;
  detectedTitle?: unknown;
  documentType?: unknown;
  failureReason?: unknown;
  missingFields?: unknown;
  orientationDetected?: unknown;
  rows?: unknown;
  success?: unknown;
  warnings?: unknown;
};

export type VisualImageInput = {
  detail: "high";
  image_url: string;
  type: "input_image";
};

export type OpenAiVisualStructuringInput = {
  documentType: DocumentType;
  fileBuffer: Buffer;
  fileName: string;
  forceProfileColumns?: boolean;
  maxVisualPages?: number;
  mimeType: string;
  pagesProcessed?: number;
  preprocessing?: DocumentPreprocessingResult;
  profile?: ClientProfile;
  rawTextContent: string;
};

export type OpenAiVisualStructuringResult = CsvAnalysisResult & {
  providerConfidence: number;
  visualStructuringProvider: "openai";
};

export async function runOpenAiVisualStructuring(
  input: OpenAiVisualStructuringInput,
): Promise<OpenAiVisualStructuringResult> {
  const config = getOpenAiVisualStructuringConfig();

  if (!config.enabled) {
    throw new CsvAnalysisError(
      "El fallback visual multimodal no esta habilitado.",
      config.disabledReason,
    );
  }

  const startedAt = Date.now();
  const imageInputs = await createOpenAiVisualInputs(input);

  if (imageInputs.length === 0) {
    throw new CsvAnalysisError(
      "No se pudieron preparar paginas para la interpretacion visual.",
      "OPENAI_VISUAL_INPUT_UNAVAILABLE",
    );
  }

  const expectedColumns = input.forceProfileColumns
    ? getExpectedColumns(input.profile)
    : [];
  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
  });
  const prompt = createVisualStructuringPrompt({
    documentType: input.documentType,
    expectedColumns,
    fileName: input.fileName,
    profile: input.profile,
    rawTextContent: input.rawTextContent,
  });

  console.info("[OCR] multimodal fallback started", {
    provider: "openai",
    pagesAnalyzed: imageInputs.length,
    profileUsed: getClientProfileCode(input.profile),
    hasExpectedColumns: expectedColumns.length > 0,
  });

  let response;

  try {
    response = await client.responses.create({
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
            ...imageInputs,
          ],
        },
      ],
      max_output_tokens: config.maxOutputTokens,
      model: config.model,
      store: false,
      text: {
        format: createVisualResponseFormat(expectedColumns),
      },
    });
  } catch (error) {
    throw new CsvAnalysisError(
      "La interpretacion visual avanzada no pudo completarse.",
      `OPENAI_VISUAL_REQUEST_FAILED: ${safeErrorName(error)}`,
    );
  }

  const parsed = parseOpenAiVisualResponse(response.output_text, expectedColumns);

  if (!parsed.success) {
    throw new CsvAnalysisError(
      "La interpretacion visual no encontro una estructura confiable.",
      `OPENAI_VISUAL_UNSTRUCTURED: ${parsed.failureReason || "No structure returned"}`,
    );
  }

  if (parsed.columns.length === 0 || parsed.rows.length === 0) {
    throw new CsvAnalysisError(
      "La interpretacion visual no devolvio filas estructuradas.",
      "OPENAI_VISUAL_EMPTY_STRUCTURE",
    );
  }

  const warnings = [
    ...parsed.warnings,
    ...parsed.assumptions.map((assumption) => `Supuesto informado: ${assumption}`),
    ...(parsed.missingFields.length > 0
      ? [`Campos sin lectura confiable: ${parsed.missingFields.join(", ")}.`]
      : []),
    ...(parsed.orientationDetected
      ? [`Orientacion visual detectada: ${parsed.orientationDetected}.`]
      : []),
  ];

  console.info("[OCR] multimodal fallback completed", {
    provider: "openai",
    pagesAnalyzed: imageInputs.length,
    profileUsed: getClientProfileCode(input.profile),
    qualityScore: parsed.confidence,
    rowsExtracted: parsed.rows.length,
    fallbackUsed: true,
    warnings: warnings.length,
    durationMs: Date.now() - startedAt,
  });

  return {
    csvContent: recordsToCsv(parsed.columns, parsed.rows),
    extractedRows: parsed.rows.length,
    extractionMode: "multimodal_structured",
    fileName: createCsvFileName(),
    jsonColumns: [...parsed.columns, "confidence", "warnings"],
    jsonRows: parsed.jsonRows,
    modelUsed: `${config.model} · multimodal visual structuring`,
    pagesProcessed: imageInputs.length,
    providerConfidence: parsed.confidence,
    resultQuality: "ai",
    rowsExtracted: parsed.rows.length,
    visualStructuringProvider: "openai",
    warnings,
  };
}

export function isOpenAiVisualFallbackConfigured() {
  return getOpenAiVisualStructuringConfig().enabled;
}

export function shouldAttemptOpenAiVisualFallback(input: {
  documentAiDetectedTables?: boolean;
  mimeType: string;
  preprocessing?: DocumentPreprocessingResult;
  qualityGateFailed?: boolean;
  rawTextContent?: string;
}) {
  if (!isOpenAiVisualFallbackConfigured()) return false;
  if (!input.rawTextContent?.trim()) return false;

  const isSupportedFile =
    input.mimeType === "application/pdf" ||
    input.mimeType === "image/jpeg" ||
    input.mimeType === "image/png";

  if (!isSupportedFile) return false;

  return (
    input.qualityGateFailed === true ||
    input.documentAiDetectedTables === false ||
    input.mimeType !== "application/pdf" ||
    input.preprocessing?.documentKind === "scanned_pdf" ||
    input.preprocessing?.hasTableSignals === true ||
    input.preprocessing?.rotationDetected === true ||
    input.preprocessing?.scannedTextWarning === true
  );
}

export function parseOpenAiVisualResponse(
  rawText: string,
  expectedColumns: readonly string[] = [],
) {
  let value: OpenAiVisualExtraction;

  try {
    value = JSON.parse(rawText) as OpenAiVisualExtraction;
  } catch {
    throw new CsvAnalysisError(
      "La interpretacion visual devolvio una respuesta invalida.",
      "OPENAI_VISUAL_RESPONSE_INVALID_JSON",
    );
  }

  if (!value || typeof value !== "object") {
    throw new CsvAnalysisError(
      "La interpretacion visual devolvio una respuesta invalida.",
      "OPENAI_VISUAL_RESPONSE_INVALID_SCHEMA",
    );
  }

  const sourceRows = Array.isArray(value.rows) ? value.rows : [];
  const discoveredColumns = normalizeColumns([
    ...(Array.isArray(value.columns) ? value.columns : []),
    ...sourceRows.flatMap((row) =>
      row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row) : [],
    ),
  ]);
  const columns =
    expectedColumns.length > 0
      ? normalizeColumns([...expectedColumns])
      : discoveredColumns;
  const rows = sourceRows
    .map((row) => normalizeVisualRow(row, columns))
    .filter((row) => columns.some((column) => row[column]));
  const jsonRows = sourceRows
    .map((row) => normalizeVisualJsonRow(row, columns))
    .filter((row) => columns.some((column) => row[column]));

  return {
    assumptions: normalizeStringArray(value.assumptions),
    columns,
    confidence: normalizeConfidence(value.confidence),
    detectedTitle: normalizeText(value.detectedTitle),
    documentType: normalizeText(value.documentType),
    failureReason: normalizeText(value.failureReason),
    jsonRows,
    missingFields: normalizeStringArray(value.missingFields),
    orientationDetected: normalizeText(value.orientationDetected),
    rows,
    success: value.success === true,
    warnings: normalizeStringArray(value.warnings),
  };
}

function getOpenAiVisualStructuringConfig() {
  const provider = (
    readEnv("OCR_FALLBACK_MULTIMODAL_PROVIDER") ||
    readEnv("OCR_VISUAL_STRUCTURING_PROVIDER")
  ).toLowerCase();
  const enabled = readBoolean(process.env.OCR_ENABLE_MULTIMODAL_FALLBACK, false);
  const apiKey = readEnv("OPENAI_API_KEY");

  if (!enabled) {
    return disabledConfig("OPENAI_VISUAL_FALLBACK_DISABLED");
  }

  if (provider !== "openai") {
    return disabledConfig("OPENAI_VISUAL_PROVIDER_NOT_SELECTED");
  }

  if (!apiKey) {
    return disabledConfig("OPENAI_API_KEY_NOT_CONFIGURED");
  }

  return {
    apiKey,
    disabledReason: "",
    enabled: true as const,
    maxOutputTokens: readPositiveInteger(
      process.env.OPENAI_VISUAL_MAX_OUTPUT_TOKENS,
      12000,
    ),
    model: readEnv("OPENAI_VISUAL_MODEL") || "gpt-5.4-mini",
    timeoutMs:
      readPositiveInteger(process.env.OCR_MULTIMODAL_TIMEOUT_SECONDS, 60) * 1000,
  };
}

function disabledConfig(disabledReason: string) {
  return {
    apiKey: "",
    disabledReason,
    enabled: false as const,
    maxOutputTokens: 0,
    model: "",
    timeoutMs: 0,
  };
}

export async function createOpenAiVisualInputs(
  input: OpenAiVisualStructuringInput,
): Promise<VisualImageInput[]> {
  if (input.mimeType === "image/jpeg" || input.mimeType === "image/png") {
    return [
      {
        detail: "high",
        image_url: createDataUrl(input.fileBuffer, input.mimeType),
        type: "input_image",
      },
    ];
  }

  if (input.mimeType !== "application/pdf") return [];

  const pageCount = await getPdfPageCount(input.fileBuffer);
  const maxPages = Math.min(
    pageCount,
    input.maxVisualPages ??
      readPositiveInteger(process.env.OCR_MULTIMODAL_MAX_PAGES, 4),
    readPositiveInteger(process.env.OCR_MAX_PDF_PAGES, 30),
  );
  const images: VisualImageInput[] = [];

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const rendered = await renderPdfPageToImage(input.fileBuffer, {
      maxWidth: readPositiveInteger(process.env.OCR_MULTIMODAL_MAX_IMAGE_WIDTH, 2000),
      pageNumber,
    });

    images.push({
      detail: "high",
      image_url: createDataUrl(rendered.buffer, rendered.mimeType),
      type: "input_image",
    });
  }

  return images;
}

function createVisualStructuringPrompt(input: {
  documentType: DocumentType;
  expectedColumns: string[];
  fileName: string;
  profile?: ClientProfile;
  rawTextContent: string;
}) {
  const expectedColumns =
    input.expectedColumns.length > 0
      ? `Usa exactamente estas columnas y este orden: ${input.expectedColumns.join(", ")}.`
      : `Detecta los encabezados reales. Si no existen, usa nombres descriptivos como Empresa, CUIT, NombreApellido, DNI, Provincia, Localidad, Fecha, Producto, Cantidad, Origen, Destino u Observaciones. Usa Campo1, Campo2 o Campo3 solo como ultimo recurso.`;
  const profileHint = input.profile?.promptHint
    ? `Reglas adicionales del perfil:\n${input.profile.promptHint}`
    : "";
  const rawText = input.rawTextContent.slice(
    0,
    readPositiveInteger(process.env.OCR_MULTIMODAL_MAX_OCR_TEXT_CHARS, 30000),
  );

  return `Sos un motor de extraccion documental visual para ADALO Consulting Group.

Analiza conjuntamente las imagenes del documento y el texto OCR recuperado por Google Document AI. Reconstrui datos en una tabla ordenada sin inventar informacion.

Archivo: ${sanitizePromptValue(input.fileName)}
Tipo documental detectado: ${input.documentType}
Perfil interno: ${getClientProfileCode(input.profile)}

${expectedColumns}

Reglas estrictas:
- Respeta solamente informacion visible en el documento o presente en el OCR.
- Si un dato no se ve o no puede inferirse con claridad, usa null o una cadena vacia.
- No completes nombres, DNI, CUIL, CUIT, localidades, codigos o importes por suposicion.
- No mezcles filas.
- En cada fila podes agregar confidence entre 0 y 1 y warnings como lista; estos campos son metadata y no forman parte del CSV.
- Detecta encabezados, columnas, filas, patrones repetidos y orientacion visual.
- Ignora marcas de agua, CamScanner, sellos, folios, sombras, bordes y numeros de pagina.
- Para listados de personal por empresa o localidad, prioriza Empresa, CUIT, NombreApellido, DNI, Provincia y Localidad.
- Para nominas, prioriza Numero, NombreApellido, CUIL, LugarTrabajo, Localidad y Provincia.
- Si una fila es dudosa, conserva vacios y reduce confidence.
- Si la imagen esta rotada o es poco clara, informalo en orientationDetected o warnings.
- Si no podes estructurar con confianza, devuelve success=false y explica el motivo en failureReason.
- Devuelve exclusivamente JSON valido con success, documentType, detectedTitle, columns, rows, confidence, warnings, missingFields, assumptions, orientationDetected y failureReason.

${profileHint}

Texto OCR de apoyo, potencialmente desalineado:
<ocr_text>
${rawText}
</ocr_text>`;
}

function createVisualResponseFormat(expectedColumns: string[]) {
  const rowSchema =
    expectedColumns.length > 0
      ? {
          type: "object",
          properties: Object.fromEntries(
            [
              ...expectedColumns.map((column) => [
                column,
                {
                  type: ["string", "null"],
                },
              ]),
              ["confidence", { type: "number", minimum: 0, maximum: 1 }],
              ["warnings", { type: "array", items: { type: "string" } }],
            ],
          ),
          required: [...expectedColumns, "confidence", "warnings"],
          additionalProperties: false,
        }
      : {
          type: "object",
          additionalProperties: {
            type: ["string", "number", "boolean", "null"],
          },
        };

  return {
    type: "json_schema" as const,
    name: "adalo_visual_document_extraction",
    strict: expectedColumns.length > 0,
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        documentType: { type: "string" },
        detectedTitle: { type: "string" },
        columns: {
          type: "array",
          items: { type: "string" },
        },
        rows: {
          type: "array",
          items: rowSchema,
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
        warnings: {
          type: "array",
          items: { type: "string" },
        },
        missingFields: {
          type: "array",
          items: { type: "string" },
        },
        assumptions: {
          type: "array",
          items: { type: "string" },
        },
        orientationDetected: { type: "string" },
        failureReason: { type: "string" },
      },
      required: [
        "success",
        "documentType",
        "detectedTitle",
        "columns",
        "rows",
        "confidence",
        "warnings",
        "missingFields",
        "assumptions",
        "orientationDetected",
        "failureReason",
      ],
      additionalProperties: false,
    },
  };
}

function getExpectedColumns(profile?: ClientProfile) {
  if (profile?.expectedColumns?.length) {
    return [...profile.expectedColumns];
  }

  if (isPersonnelRosterProfile(profile)) {
    return [
      "Numero",
      "NombreApellido",
      "CUIL",
      "LugarTrabajo",
      "Localidad",
      "Provincia",
    ];
  }

  if (profile?.defaultExtractionProfile === "commercial-operations") {
    return [...COMMERCIAL_OPERATIONS_COLUMNS];
  }

  if (profile?.defaultExtractionProfile === "technical-admin") {
    return [...TECHNICAL_ADMIN_COLUMNS];
  }

  return [];
}

function normalizeVisualRow(row: unknown, columns: string[]) {
  const normalized: Record<string, string> = Object.fromEntries(
    columns.map((column) => [column, ""]),
  );

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return normalized;
  }

  const source = row as Record<string, unknown>;
  const sourceKeys = Object.keys(source);

  for (const column of columns) {
    const normalizedColumn = normalizeColumnKey(column);
    const sourceKey = sourceKeys.find(
      (key) => normalizeColumnKey(key) === normalizedColumn,
    );

    normalized[column] = normalizeText(sourceKey ? source[sourceKey] : "");
  }

  return normalized;
}

function normalizeVisualJsonRow(
  row: unknown,
  columns: string[],
): Record<string, string> {
  const normalized = normalizeVisualRow(row, columns);

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return {
      ...normalized,
      confidence: "",
      warnings: "",
    };
  }

  const source = row as Record<string, unknown>;

  return {
    ...normalized,
    confidence: String(normalizeConfidence(source.confidence)),
    warnings: normalizeStringArray(source.warnings).join("; "),
  };
}

function normalizeColumns(values: unknown[]) {
  const seen = new Set<string>();
  const columns: string[] = [];

  for (const value of values) {
    const column = normalizeText(value);
    const key = normalizeColumnKey(column);

    if (!column || !key || seen.has(key) || isVisualMetadataColumn(key)) continue;

    seen.add(key);
    columns.push(column);
  }

  return columns;
}

function isVisualMetadataColumn(value: string) {
  return [
    "confidence",
    "warning",
    "warnings",
    "rowconfidence",
    "orientation",
  ].includes(value);
}

function normalizeColumnKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeText).filter(Boolean).slice(0, 20);
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";

  return [...String(value)]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeConfidence(value: unknown) {
  const parsed = Number(String(value ?? "").replace(",", "."));

  if (!Number.isFinite(parsed)) return 0;

  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
}

function createDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function sanitizePromptValue(value: string) {
  return value.replace(/[\r\n<>]+/g, " ").trim().slice(0, 180);
}

function safeErrorName(error: unknown) {
  if (error instanceof Error) return error.name;
  return typeof error;
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().replace(/^['"]|['"]$/g, "").toLowerCase();

  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function readEnv(name: string) {
  return process.env[name]?.trim().replace(/^['"]|['"]$/g, "") || "";
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
