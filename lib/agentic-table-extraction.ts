import OpenAI from "openai";
import {
  createOpenAiVisualInputs,
  type OpenAiVisualStructuringInput,
  type VisualImageInput,
} from "@/lib/openai-visual-structuring";
import { recordsToCsv } from "@/lib/structured-output";
import type { CsvAnalysisResult } from "@/lib/google-ai";

const MOVEMENT_COLUMNS = new Set([
  "fechasalida",
  "cantidadcamion",
  "unidad",
  "tons",
  "rutacaminospuna",
  "cantidadescoltas",
]);

export type AgenticExtractorOutput = {
  confidence: number;
  detectedDocumentType: string;
  detectedHeaders: string[];
  documentTitle: string;
  needsReview: boolean;
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
  providerConfidence: number;
};

export function isAgenticTableModeEnabled() {
  return getAgenticConfig().enabled;
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

  const images = await createOpenAiVisualInputs(input);
  if (images.length === 0) {
    throw new Error("AGENTIC_TABLE_VISUAL_INPUT_UNAVAILABLE");
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
  });
  const extracted = await runExtractorAgent(client, images, input, config);
  const reviewed = await runReviewerAgent(
    client,
    images,
    input,
    extracted,
    config,
  );
  const quality = assessAgenticTableResult(reviewed);

  if (!quality.acceptable) {
    throw new Error(`AGENTIC_TABLE_QUALITY_FAILED: ${quality.reason}`);
  }

  return {
    automaticReviewApplied: true,
    correctionsApplied: reviewed.correctionsApplied,
    csvContent: recordsToCsv(reviewed.finalHeaders, reviewed.finalRows),
    detectedDocumentType: reviewed.finalDocumentType,
    detectedHeaders: reviewed.finalHeaders,
    documentTitle: extracted.documentTitle || undefined,
    extractedRows: reviewed.finalRows.length,
    extractionMode: "agentic_document_table",
    fileName: "ADALO_OCR_TABLA_DOCUMENTAL.csv",
    jsonColumns: reviewed.finalHeaders,
    jsonRows: reviewed.finalRows,
    modelUsed: `${config.model} - agentic document table`,
    pagesProcessed: images.length,
    providerConfidence: reviewed.confidence,
    resultQuality: reviewed.warnings.length > 0 ? "partial" : "ai",
    rowsExtracted: reviewed.finalRows.length,
    warnings: reviewed.warnings,
  };
}

async function runExtractorAgent(
  client: OpenAI,
  images: VisualImageInput[],
  input: OpenAiVisualStructuringInput & { profileHint?: string },
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
  input: OpenAiVisualStructuringInput,
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
      normalizeText(value.detectedDocumentType) || "Tabla documental",
    detectedHeaders: headers,
    documentTitle: normalizeText(value.documentTitle),
    needsReview: value.needsReview !== false,
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

export function assessAgenticTableResult(result: AgenticReviewerOutput) {
  const normalizedHeaders = result.finalHeaders.map(normalizeKey);
  const genericLineOutput = ["pagina", "linea", "texto"].every((header) =>
    normalizedHeaders.includes(header),
  );
  const populatedRows = result.finalRows.filter((row) =>
    result.finalHeaders.some((header) => normalizeText(row[header])),
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
  if (result.confidence < 0.65) {
    return { acceptable: false, reason: "Reviewer confidence below 0.65" };
  }

  return { acceptable: true, reason: "Reviewed document headers and rows" };
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

function createExtractorPrompt(
  input: OpenAiVisualStructuringInput & { profileHint?: string },
) {
  const rawText = input.rawTextContent.slice(0, 30000);
  const hint = input.profileHint
    ? `Contexto opcional, no vinculante: ${input.profileHint}. No impongas sus columnas si no coinciden con el documento.`
    : "No hay un perfil documental obligatorio.";

  return `Sos el agente extractor universal de ADALO OCR.

Analiza visualmente el documento y el texto OCR de apoyo. Detecta el tipo real, el titulo, los encabezados visibles y reconstruye cada fila respetando esos encabezados.

Reglas criticas:
- Los encabezados visibles tienen prioridad absoluta.
- No mapees datos a columnas predefinidas que no aparezcan en el documento.
- No inventes encabezados, filas ni valores.
- Corrige solo errores evidentes de OCR.
- Une filas partidas y conserva celdas vacias cuando algo no sea legible.
- Ignora CamScanner, sellos, folios, sombras, bordes y numeros de pagina.
- Si hay una tabla, detectedHeaders debe reproducir sus encabezados reales.
- Devuelve exclusivamente el JSON solicitado.

${hint}

Texto OCR de apoyo:
<ocr_text>
${rawText}
</ocr_text>`;
}

function createReviewerPrompt(
  input: OpenAiVisualStructuringInput,
  extracted: AgenticExtractorOutput,
) {
  return `Sos el agente revisor de ADALO OCR.

Compara la propuesta del extractor con las imagenes y el texto OCR. Corregi encabezados mal leidos, columnas desplazadas, valores cortados y filas partidas.

Reglas:
- Los encabezados visibles del documento tienen prioridad absoluta.
- Nunca reemplaces encabezados reales por columnas de un perfil interno.
- No inventes informacion.
- Si un valor no es legible, dejalo vacio.
- Conserva una fila por registro real.
- Elimina marcas CamScanner, sellos, folios y encabezados repetidos como filas.
- Devuelve exclusivamente JSON valido.

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
        detectedDocumentType: { type: "string" },
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
        needsReview: { type: "boolean" },
      },
      required: [
        "documentTitle",
        "detectedDocumentType",
        "detectedHeaders",
        "rows",
        "confidence",
        "warnings",
        "needsReview",
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
