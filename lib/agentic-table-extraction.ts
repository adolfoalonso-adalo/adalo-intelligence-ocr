import OpenAI from "openai";
import {
  prepareOpenAiVisualInputs,
  type OpenAiVisualStructuringInput,
  type VisualInputPreparation,
  type VisualImageInput,
} from "@/lib/openai-visual-structuring";
import { recordsToCsv } from "@/lib/structured-output";
import type { CsvAnalysisResult } from "@/lib/google-ai";
import { normalizeDocumentTableFromTextLayout } from "@/lib/document-table-recovery";

const MOVEMENT_COLUMNS = new Set([
  "fechasalida",
  "cantidadcamion",
  "unidad",
  "tons",
  "rutacaminospuna",
  "cantidadescoltas",
]);

export const UNIVERSAL_EXTRACTION_MODE = "document_ai_gpt_optimized";

export type AgenticExtractorOutput = {
  confidence: number;
  detectedDocumentType: string;
  detectedHeaders: string[];
  documentTitle: string;
  rows: Record<string, string>[];
  warnings: string[];
};

export type AgenticReviewerOutput = {
  confidence: number;
  correctionsApplied: string[];
  finalDocumentType: string;
  finalHeaders: string[];
  finalRows: Record<string, string>[];
  warnings: string[];
};

export type AgenticDocumentTableResult = CsvAnalysisResult & {
  automaticReviewApplied: true;
  correctionsApplied: string[];
  detectedDocumentType: string;
  detectedHeaders: string[];
  documentTitle?: string;
  initialDetectedHeaders: string[];
  providerConfidence: number;
  rejectedLegacyColumns: string[];
  gptExtractorMode: "multimodal" | "text_layout_only";
  gptReviewerMode: "multimodal" | "text_layout_only";
  pdfVisualRenderingAttempted: boolean;
  pdfVisualRenderingSucceeded: boolean;
  usedDocumentAiTextOnlyFallback: boolean;
  visualPagesRendered: boolean;
  visualRenderError?: string;
};

export function isAgenticTableModeEnabled() {
  return readBoolean(process.env.OCR_AGENTIC_TABLE_MODE, false);
}

export async function runAgenticDocumentTableExtraction(
  input: OpenAiVisualStructuringInput & {
    profileHint?: string;
  },
): Promise<AgenticDocumentTableResult> {
  const config = getAgenticConfig();

  if (!config.enabled) {
    throw new Error(config.disabledReason);
  }

  const visualPreparation = await prepareAgenticVisualContext({
    ...input,
    maxVisualPages: config.maxPages,
  });
  console.info("[OCR] agentic visual preparation", {
    documentAiTextLength: input.rawTextContent.length,
    gptExtractorMode: visualPreparation.mode,
    gptReviewerMode: visualPreparation.mode,
    pdfVisualRenderingAttempted: visualPreparation.attempted,
    pdfVisualRenderingSucceeded: visualPreparation.succeeded,
    usedDocumentAiTextOnlyFallback: !visualPreparation.succeeded,
    visualPagesRendered: visualPreparation.images.length,
    visualRenderError: visualPreparation.error,
  });
  const images = visualPreparation.images;
  const agentInput = {
    ...input,
    agenticMode: visualPreparation.mode,
    visualRenderError: visualPreparation.error,
  };

  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
  });
  const extracted = await runExtractorAgent(client, images, agentInput, config);
  const reviewed = await runReviewerAgent(
    client,
    images,
    agentInput,
    extracted,
    config,
  );
  let finalReviewed = reviewed;
  let quality = assessAgenticTableResult(finalReviewed, {
    visualPagesRendered: visualPreparation.succeeded,
  });
  let recoveredWithWarnings = false;

  if (!quality.acceptable) {
    const recovery = normalizeDocumentTableFromTextLayout({
      extractedHeaders: extracted.detectedHeaders,
      extractedRows: extracted.rows,
      rawTextContent: input.rawTextContent,
      reviewerConfidence: reviewed.confidence,
      reviewedHeaders: reviewed.finalHeaders,
      reviewedRows: reviewed.finalRows,
    });

    if (recovery) {
      recoveredWithWarnings = true;
      finalReviewed = {
        confidence: recovery.confidence,
        correctionsApplied: [
          ...reviewed.correctionsApplied,
          `Recuperacion post-review aplicada desde ${recovery.source}.`,
        ],
        finalDocumentType: "Tabla de proveedores",
        finalHeaders: recovery.detectedHeaders,
        finalRows: recovery.rows,
        warnings: [...reviewed.warnings, ...recovery.warnings],
      };
      quality = {
        acceptable: true,
        reason: "Supplier table recovered from Document AI text/layout",
      };
      console.info("[OCR] agentic table recovered after review", {
        confidence: finalReviewed.confidence,
        headers: finalReviewed.finalHeaders.length,
        rows: finalReviewed.finalRows.length,
        source: recovery.source,
      });
    }
  }
  const rejectedLegacyColumns = findUnsupportedLegacyColumns(
    finalReviewed.finalHeaders,
    input.rawTextContent,
  );

  if (!quality.acceptable) {
    throw new Error(`AGENTIC_TABLE_QUALITY_FAILED: ${quality.reason}`);
  }
  if (rejectedLegacyColumns.length > 0) {
    throw new Error(
      `AGENTIC_TABLE_LEGACY_COLUMNS_REJECTED: ${rejectedLegacyColumns.join(", ")}`,
    );
  }

  return {
    automaticReviewApplied: true,
    correctionsApplied: finalReviewed.correctionsApplied,
    csvContent: recordsToCsv(finalReviewed.finalHeaders, finalReviewed.finalRows),
    detectedDocumentType: finalReviewed.finalDocumentType,
    detectedHeaders: finalReviewed.finalHeaders,
    documentTitle: extracted.documentTitle || undefined,
    extractedRows: finalReviewed.finalRows.length,
    extractionMode: UNIVERSAL_EXTRACTION_MODE,
    fileName: "ADALO_OCR_TABLA_DOCUMENTAL.csv",
    initialDetectedHeaders: extracted.detectedHeaders,
    jsonColumns: finalReviewed.finalHeaders,
    jsonRows: finalReviewed.finalRows,
    modelUsed: `${config.model} - agentic document table`,
    pagesProcessed: input.pagesProcessed ?? images.length,
    providerConfidence: finalReviewed.confidence,
    qualityStatus: recoveredWithWarnings
      ? "accepted_with_warnings"
      : undefined,
    rejectedLegacyColumns,
    gptExtractorMode: visualPreparation.mode,
    gptReviewerMode: visualPreparation.mode,
    pdfVisualRenderingAttempted: visualPreparation.attempted,
    pdfVisualRenderingSucceeded: visualPreparation.succeeded,
    resultQuality:
      finalReviewed.warnings.length > 0 ||
      recoveredWithWarnings ||
      !visualPreparation.succeeded
        ? "partial"
        : "ai",
    rowsExtracted: finalReviewed.finalRows.length,
    usedDocumentAiTextOnlyFallback: !visualPreparation.succeeded,
    visualPagesRendered: visualPreparation.succeeded,
    visualRenderError: visualPreparation.error,
    warnings: [
      ...finalReviewed.warnings,
      ...(visualPreparation.error
        ? [
            "La tabla se reconstruyo con texto y layout de Document AI porque no hubo paginas visuales disponibles.",
          ]
        : []),
    ],
  };
}

export async function prepareAgenticVisualContext(
  input: OpenAiVisualStructuringInput,
  createInputs?: (
    value: OpenAiVisualStructuringInput,
  ) => Promise<VisualImageInput[]>,
) {
  return prepareOpenAiVisualInputs(input, createInputs);
}

async function runExtractorAgent(
  client: OpenAI,
  images: VisualImageInput[],
  input: AgenticPromptInput,
  config: ReturnType<typeof getAgenticConfig> & { enabled: true },
) {
  const response = await client.responses.create({
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: createExtractorPrompt(input),
          },
          ...images,
        ],
      },
    ],
    max_output_tokens: config.maxOutputTokens,
    model: config.model,
    store: false,
    text: {
      format: createExtractorFormat(),
    },
  });

  return parseAgenticExtractorResponse(response.output_text);
}

async function runReviewerAgent(
  client: OpenAI,
  images: VisualImageInput[],
  input: AgenticPromptInput,
  extracted: AgenticExtractorOutput,
  config: ReturnType<typeof getAgenticConfig> & { enabled: true },
) {
  const response = await client.responses.create({
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: createReviewerPrompt(input, extracted),
          },
          ...images,
        ],
      },
    ],
    max_output_tokens: config.maxOutputTokens,
    model: config.reviewerModel,
    store: false,
    text: {
      format: createReviewerFormat(),
    },
  });

  return parseAgenticReviewerResponse(response.output_text);
}

export function parseAgenticExtractorResponse(
  rawText: string,
): AgenticExtractorOutput {
  const value = parseObject(rawText, "AGENTIC_EXTRACTOR_INVALID_JSON");
  const headers = normalizeHeaders(value.detectedHeaders);
  const rows = normalizeRows(value.rows, headers);

  return {
    confidence: normalizeConfidence(value.confidence),
    detectedDocumentType:
      normalizeText(value.documentType ?? value.detectedDocumentType) ||
      "Tabla documental",
    detectedHeaders: headers,
    documentTitle: normalizeText(value.documentTitle),
    rows,
    warnings: normalizeStringArray(value.warnings),
  };
}

export function parseAgenticReviewerResponse(
  rawText: string,
): AgenticReviewerOutput {
  const value = parseObject(rawText, "AGENTIC_REVIEWER_INVALID_JSON");
  const headers = normalizeHeaders(value.finalHeaders);

  return {
    confidence: normalizeConfidence(value.confidence),
    correctionsApplied: normalizeStringArray(value.correctionsApplied),
    finalDocumentType:
      normalizeText(value.finalDocumentType) || "Tabla documental",
    finalHeaders: headers,
    finalRows: normalizeRows(value.finalRows, headers),
    warnings: normalizeStringArray(value.warnings),
  };
}

export function assessAgenticTableResult(
  result: AgenticReviewerOutput,
  context: { visualPagesRendered?: boolean } = {},
) {
  const normalizedHeaders = result.finalHeaders.map(normalizeKey);
  const genericLineOutput = ["pagina", "linea", "texto"].every((header) =>
    normalizedHeaders.includes(header),
  );
  const populatedRows = result.finalRows.filter((row) =>
    result.finalHeaders.some((header) => normalizeText(row[header])),
  );
  const supplierHeadersDetected = hasSupplierDocumentHeaders(
    result.finalHeaders,
  );

  if (result.finalHeaders.length < 2) {
    return { acceptable: false, reason: "Fewer than two real headers" };
  }
  if (genericLineOutput) {
    return { acceptable: false, reason: "Generic page-line-text output" };
  }
  if (populatedRows.length === 0) {
    return { acceptable: false, reason: "No populated rows" };
  }
  if (
    !context.visualPagesRendered &&
    supplierHeadersDetected &&
    populatedRows.length >= 5
  ) {
    return {
      acceptable: true,
      reason: "Supplier table reconstructed from Document AI text/layout",
    };
  }
  if (result.confidence < 0.65) {
    return { acceptable: false, reason: "Reviewer confidence below 0.65" };
  }

  return { acceptable: true, reason: "Reviewed document headers and rows" };
}

export function hasSupplierDocumentHeaders(headers: string[]) {
  const expected = [
    "nombreempresa",
    "proveedor",
    "cuit",
    "servicioarea",
    "provincia",
    "zonaderadicacion",
    "fechaperiododecontratacion",
    "modalidaddecontratacion",
  ];
  const actual = new Set(headers.map(normalizeKey));
  return expected.every((header) => actual.has(header));
}

export function assertVisibleHeadersTakePriority(input: {
  detectedHeaders: string[];
  forcedProfile: boolean;
  profileColumns?: readonly string[];
}) {
  if (input.forcedProfile || input.detectedHeaders.length === 0) {
    return input.profileColumns ? [...input.profileColumns] : input.detectedHeaders;
  }

  return [...input.detectedHeaders];
}

export function containsMovementColumns(headers: string[]) {
  return headers.some((header) => MOVEMENT_COLUMNS.has(normalizeKey(header)));
}

export function findUnsupportedLegacyColumns(
  headers: string[],
  rawTextContent: string,
) {
  const visibleText = normalizeKey(rawTextContent);

  return headers.filter((header) => {
    const normalizedHeader = normalizeKey(header);
    return (
      MOVEMENT_COLUMNS.has(normalizedHeader) &&
      !visibleText.includes(normalizedHeader)
    );
  });
}

type AgenticPromptInput = OpenAiVisualStructuringInput & {
  agenticMode: VisualInputPreparation["mode"];
  profileHint?: string;
  visualRenderError?: string;
};

function createExtractorPrompt(input: AgenticPromptInput) {
  const rawText = input.rawTextContent.slice(0, 30000);
  const hint = input.profileHint
    ? `Contexto legacy opcional y no vinculante: ${input.profileHint}. Ignoralo si no coincide con los encabezados visibles.`
    : "No hay perfiles documentales ni columnas predefinidas.";
  const renderingGuidance =
    input.agenticMode === "text_layout_only"
      ? `No hay imagen renderizada disponible. Reconstrui la tabla usando exclusivamente el texto OCR, lineas, bloques y senales de layout de Document AI. Detecta encabezados reales del documento. No uses perfiles ni columnas predefinidas.`
      : "Usa las imagenes renderizadas y el texto/layout de Document AI en conjunto.";

  return `Sos el agente extractor universal de ADALO OCR.

Analiza visualmente el documento y el texto OCR de apoyo. Detecta el tipo real, el titulo, los encabezados visibles y reconstruye cada fila respetando esos encabezados.

Archivo: ${input.fileName}
Tipo MIME: ${input.mimeType}
Paginas preparadas: ${input.pagesProcessed ?? "desconocido"}
Modo del extractor: ${input.agenticMode}

Reglas criticas:
- Los encabezados visibles tienen prioridad absoluta.
- No uses perfiles internos ni columnas predefinidas; detecta los encabezados reales del documento.
- No mapees datos a columnas predefinidas que no aparezcan en el documento.
- No inventes encabezados, filas ni valores.
- Corrige solo errores evidentes de OCR.
- Une filas partidas y conserva celdas vacias cuando algo no sea legible.
- Ignora CamScanner, sellos, folios, sombras, bordes y numeros de pagina.
- Si hay una tabla, detectedHeaders debe reproducir sus encabezados reales.
- Devuelve exclusivamente el JSON solicitado.

${hint}
${renderingGuidance}

Texto OCR de apoyo:
<ocr_text>
${rawText}
</ocr_text>`;
}

function createReviewerPrompt(
  input: AgenticPromptInput,
  extracted: AgenticExtractorOutput,
) {
  return `Sos el agente revisor de ADALO OCR.

Compara la propuesta del extractor con las imagenes y el texto OCR. Corregi encabezados mal leidos, columnas desplazadas, valores cortados y filas partidas.

Reglas:
- Los encabezados visibles del documento tienen prioridad absoluta.
- Rechaza cualquier columna heredada de perfiles internos que no aparezca visible en el documento.
- Nunca reemplaces encabezados reales por columnas de Movimiento, Mateo u otro perfil legacy.
- No inventes informacion.
- Si un valor no es legible, dejalo vacio.
- Conserva una fila por registro real.
- Elimina marcas CamScanner, sellos, folios y encabezados repetidos como filas.
- Devuelve exclusivamente JSON valido.

Modo del revisor: ${input.agenticMode}.
${input.agenticMode === "text_layout_only" ? "No hay imagen disponible. Revisa usando la salida del extractor y las senales de texto/layout de Document AI." : "Compara tambien contra las imagenes renderizadas."}

Propuesta del extractor:
${JSON.stringify(extracted).slice(0, 50000)}

Texto OCR de apoyo:
${input.rawTextContent.slice(0, 30000)}`;
}

function createExtractorFormat() {
  return {
    type: "json_schema" as const,
    name: "adalo_agentic_table_extractor",
    strict: false,
    schema: {
      type: "object",
      properties: {
        documentTitle: { type: ["string", "null"] },
        documentType: { type: "string" },
        detectedHeaders: { type: "array", items: { type: "string" } },
        rows: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: {
              type: ["string", "number", "boolean", "null"],
            },
          },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        warnings: { type: "array", items: { type: "string" } },
      },
      required: [
        "documentTitle",
        "documentType",
        "detectedHeaders",
        "rows",
        "confidence",
        "warnings",
      ],
      additionalProperties: false,
    },
  };
}

function createReviewerFormat() {
  return {
    type: "json_schema" as const,
    name: "adalo_agentic_table_reviewer",
    strict: false,
    schema: {
      type: "object",
      properties: {
        finalDocumentType: { type: "string" },
        finalHeaders: { type: "array", items: { type: "string" } },
        finalRows: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: {
              type: ["string", "number", "boolean", "null"],
            },
          },
        },
        correctionsApplied: { type: "array", items: { type: "string" } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        warnings: { type: "array", items: { type: "string" } },
      },
      required: [
        "finalDocumentType",
        "finalHeaders",
        "finalRows",
        "correctionsApplied",
        "confidence",
        "warnings",
      ],
      additionalProperties: false,
    },
  };
}

function normalizeRows(value: unknown, headers: string[]) {
  if (!Array.isArray(value)) return [];

  return value
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return Object.fromEntries(headers.map((header) => [header, ""]));
      }

      const source = row as Record<string, unknown>;
      const sourceKeys = Object.keys(source);
      return Object.fromEntries(
        headers.map((header) => {
          const sourceKey = sourceKeys.find(
            (key) => normalizeKey(key) === normalizeKey(header),
          );
          return [header, normalizeText(sourceKey ? source[sourceKey] : "")];
        }),
      );
    })
    .filter((row) => headers.some((header) => row[header]));
}

function normalizeHeaders(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const headers: string[] = [];

  for (const item of value) {
    const header = normalizeText(item);
    const key = normalizeKey(header);
    if (!header || !key || seen.has(key)) continue;
    seen.add(key);
    headers.push(header);
  }

  return headers;
}

function parseObject(rawText: string, code: string): Record<string, unknown> {
  try {
    const value = JSON.parse(rawText) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Mapped to a controlled error below.
  }
  throw new Error(code);
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(normalizeText).filter(Boolean).slice(0, 30)
    : [];
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined || typeof value === "object") {
    return "";
  }
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

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function normalizeConfidence(value: unknown) {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function getAgenticConfig() {
  const enabled = readBoolean(process.env.OCR_AGENTIC_TABLE_MODE, false);
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";

  if (!enabled) {
    return {
      disabledReason: "OCR_AGENTIC_TABLE_MODE_DISABLED",
      enabled: false as const,
    };
  }
  if (!apiKey) {
    return {
      disabledReason: "OPENAI_API_KEY_NOT_CONFIGURED",
      enabled: false as const,
    };
  }

  return {
    apiKey,
    disabledReason: "",
    enabled: true as const,
    maxOutputTokens: readPositiveInteger(
      process.env.OPENAI_AGENTIC_MAX_OUTPUT_TOKENS,
      16000,
    ),
    maxPages: readPositiveInteger(process.env.OCR_AGENTIC_MAX_PAGES, 10),
    model:
      process.env.OPENAI_AGENTIC_EXTRACTOR_MODEL?.trim() ||
      process.env.OPENAI_VISUAL_MODEL?.trim() ||
      "gpt-5.4-mini",
    reviewerModel:
      process.env.OPENAI_AGENTIC_REVIEWER_MODEL?.trim() ||
      process.env.OPENAI_VISUAL_MODEL?.trim() ||
      "gpt-5.4-mini",
    timeoutMs:
      readPositiveInteger(process.env.OCR_AGENTIC_TIMEOUT_SECONDS, 90) * 1000,
  };
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value.trim().replace(/^['"]|['"]$/g, "").toLowerCase() === "true";
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
