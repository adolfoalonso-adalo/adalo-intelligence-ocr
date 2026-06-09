import type { ClientProfile } from "@/lib/client-profiles";
import { getClientProfileCode } from "@/lib/client-profiles";
import type { DocumentPreprocessingResult } from "@/lib/document-preprocessing";
import type { DocumentType } from "@/lib/document-type";
import {
  analyzeExtractedDocumentToCsv,
  analyzeFileToCsv,
  CsvAnalysisError,
  type CsvAnalysisResult,
} from "@/lib/google-ai";
import {
  formatCorrectionExamplesForPrompt,
  getProfileCorrectionExamples,
} from "@/lib/profile-correction-examples";
import {
  OCRTextOnlyError,
  sanitizeRawOcrText,
} from "@/lib/ocr-diagnostics";

export type OCRProviderName = "google-ai" | "advanced-document" | "google-document-ai";

export type OCRProviderInput = {
  clientProfile?: ClientProfile;
  documentType: DocumentType;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  preprocessing?: DocumentPreprocessingResult;
};

export type OCRProviderResult = CsvAnalysisResult & {
  providerUsed: OCRProviderName;
  rawTextContent?: string;
  textLength?: number;
};

export interface OCRProvider {
  name: OCRProviderName;
  supportsScannedPdf: boolean;
  supportsTables: boolean;
  extract(input: OCRProviderInput): Promise<OCRProviderResult>;
}

export class GoogleAIOCRProvider implements OCRProvider {
  name: OCRProviderName = "google-ai";
  supportsScannedPdf = true;
  supportsTables = true;

  async extract(input: OCRProviderInput): Promise<OCRProviderResult> {
    const clientProfile = await withCorrectionExamples(input.clientProfile);
    const result = await analyzeFileToCsv(
      input.fileBuffer,
      input.fileName,
      input.mimeType,
      input.documentType,
      clientProfile,
    );

    return {
      ...result,
      providerUsed: this.name,
    };
  }
}

async function withCorrectionExamples(clientProfile?: ClientProfile): Promise<ClientProfile | undefined> {
  if (!clientProfile) return clientProfile;

  const examples = await getProfileCorrectionExamples(getClientProfileCode(clientProfile)).catch(() => []);
  const formattedExamples = formatCorrectionExamplesForPrompt(examples);

  if (!formattedExamples) return clientProfile;

  return {
    ...clientProfile,
    promptHint: [
      clientProfile.promptHint,
      "Ejemplos corregidos de referencia para este perfil:",
      formattedExamples,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export class AdvancedDocumentOCRProvider implements OCRProvider {
  name: OCRProviderName = "advanced-document";
  supportsScannedPdf = true;
  supportsTables = true;

  async extract(input: OCRProviderInput): Promise<OCRProviderResult> {
    void input;
    const endpoint = process.env.OCR_ADVANCED_PROVIDER_ENDPOINT?.trim();

    if (!endpoint) {
      throw new CsvAnalysisError(
        "El proveedor OCR avanzado no esta configurado.",
        "ADVANCED_OCR_PROVIDER_NOT_CONFIGURED",
      );
    }

    throw new CsvAnalysisError(
      "El proveedor OCR avanzado esta preparado pero todavia no tiene integracion activa.",
      "ADVANCED_OCR_PROVIDER_PLACEHOLDER",
    );
  }
}

type DocumentAiModule = {
  v1?: {
    DocumentProcessorServiceClient?: new (
      options?: GoogleDocumentAiClientOptions,
    ) => DocumentAiClient;
  };
};

type GoogleDocumentAiCredentials = {
  client_email: string;
  private_key: string;
};

export type GoogleDocumentAiClientOptions = {
  apiEndpoint: string;
  credentials?: GoogleDocumentAiCredentials;
  keyFilename?: string;
  projectId?: string;
};

export type GoogleDocumentAiAuthMode =
  | "application-default-credentials"
  | "credentials-json"
  | "service-account-env";

type DocumentAiClient = {
  processDocument: (request: {
    name: string;
    rawDocument: {
      content: string;
      mimeType: string;
    };
  }) => Promise<Array<{ document?: DocumentAiDocument }>>;
  processorPath?: (projectId: string, location: string, processorId: string) => string;
};

type DocumentAiDocument = {
  pages?: Array<{
    pageNumber?: number;
    tables?: DocumentAiTable[];
  }>;
  text?: string;
};

type DocumentAiTable = {
  bodyRows?: DocumentAiTableRow[];
  headerRows?: DocumentAiTableRow[];
};

type DocumentAiTableRow = {
  cells?: Array<{
    layout?: {
      textAnchor?: {
        textSegments?: Array<{
          endIndex?: number | string;
          startIndex?: number | string;
        }>;
      };
    };
  }>;
};

export class GoogleDocumentAIOCRProvider implements OCRProvider {
  name: OCRProviderName = "google-document-ai";
  supportsScannedPdf = true;
  supportsTables = true;

  async extract(input: OCRProviderInput): Promise<OCRProviderResult> {
    const config = getGoogleDocumentAiConfig();
    const auth = resolveGoogleDocumentAiClientOptions(config);
    const documentAi = (await import("@google-cloud/documentai")) as DocumentAiModule;
    const Client = documentAi.v1?.DocumentProcessorServiceClient;

    if (!Client) {
      throw new CsvAnalysisError(
        "Google Document AI no esta disponible en el runtime.",
        "GOOGLE_DOCUMENT_AI_CLIENT_UNAVAILABLE",
      );
    }

    console.info("[OCR] Google Document AI authentication configured", {
      authMode: auth.authMode,
      location: config.location,
      projectIdConfigured: Boolean(config.projectId),
    });

    const client = new Client(auth.clientOptions);
    const name =
      typeof client.processorPath === "function"
        ? client.processorPath(config.projectId, config.location, config.processorId)
        : `projects/${config.projectId}/locations/${config.location}/processors/${config.processorId}`;
    const [response] = await client.processDocument({
      name,
      rawDocument: {
        content: input.fileBuffer.toString("base64"),
        mimeType: input.mimeType,
      },
    });
    const document = response.document;

    if (!document?.text?.trim()) {
      throw new CsvAnalysisError(
        "Google Document AI no devolvio texto util.",
        "GOOGLE_DOCUMENT_AI_EMPTY_TEXT",
      );
    }

    const rawTextContent = sanitizeRawOcrText(document.text);
    const tablesText = extractDocumentAiTablesText(document);
    const clientProfile = await withCorrectionExamples(input.clientProfile);
    let normalized: CsvAnalysisResult;

    try {
      normalized = await analyzeExtractedDocumentToCsv({
        clientProfile,
        documentType: input.documentType,
        extractedTablesText: tablesText,
        extractedText: rawTextContent,
        fileName: input.fileName,
        pageCount: document.pages?.length,
        providerLabel: "google-document-ai",
      });
    } catch (error) {
      throw new OCRTextOnlyError({
        canDownloadRawText: true,
        extractionMode: "ocr_text_only",
        fallbackUsed: false,
        pagesProcessed: document.pages?.length ?? 0,
        profileUsed: getClientProfileCode(input.clientProfile),
        providerUsed: this.name,
        qualityScore: 0.5,
        qualityStatus: "failed_quality_gate",
        rawTextContent,
        reason: getSafeNormalizationFailureReason(error),
        textLength: rawTextContent.length,
        warnings: [
          ...(tablesText ? [] : ["Google Document AI no detecto tablas explicitas."]),
          "El texto OCR fue recuperado, pero no pudo normalizarse como una tabla confiable.",
        ],
      });
    }

    return {
      ...normalized,
      providerUsed: this.name,
      rawTextContent,
      textLength: rawTextContent.length,
      warnings: [
        ...(normalized.warnings ?? []),
        ...(tablesText ? [] : ["Google Document AI no detecto tablas explicitas; se normalizo desde texto OCR."]),
      ],
    };
  }
}

function getSafeNormalizationFailureReason(error: unknown) {
  if (error instanceof CsvAnalysisError) {
    return error.technicalDetail.replace(/\s+/g, " ").slice(0, 220);
  }

  if (error instanceof Error) {
    return error.name === "AiOutputQualityError"
      ? "La salida normalizada no alcanzo el umbral minimo de calidad."
      : "La respuesta de normalizacion no pudo convertirse en una estructura confiable.";
  }

  return "La salida OCR no pudo convertirse en una estructura confiable.";
}

export function createOCRProvider(name: string | undefined): OCRProvider {
  const normalizedName = normalizeProviderName(name);

  if (normalizedName === "advanced-document") {
    return new AdvancedDocumentOCRProvider();
  }

  if (normalizedName === "google-document-ai") {
    return new GoogleDocumentAIOCRProvider();
  }

  return new GoogleAIOCRProvider();
}

export function normalizeProviderName(name: string | undefined): OCRProviderName {
  const normalized = (name || "google-ai").trim().replace(/^['"]|['"]$/g, "").toLowerCase();

  if (normalized === "advanced-document") return "advanced-document";
  if (normalized === "google-document-ai") return "google-document-ai";
  return "google-ai";
}

function getGoogleDocumentAiConfig() {
  const projectId = readRequiredEnv("GOOGLE_CLOUD_PROJECT_ID");
  const location = readRequiredEnv("GOOGLE_DOCUMENT_AI_LOCATION");
  const processorId = readRequiredEnv("GOOGLE_DOCUMENT_AI_PROCESSOR_ID");

  return { location, processorId, projectId };
}

export function resolveGoogleDocumentAiClientOptions(config: {
  location: string;
  projectId: string;
}): {
  authMode: GoogleDocumentAiAuthMode;
  clientOptions: GoogleDocumentAiClientOptions;
} {
  const apiEndpoint = `${config.location}-documentai.googleapis.com`;
  const credentialsPath = readOptionalEnv("GOOGLE_APPLICATION_CREDENTIALS");

  if (credentialsPath) {
    return {
      authMode: "application-default-credentials",
      clientOptions: {
        apiEndpoint,
        keyFilename: credentialsPath,
        projectId: config.projectId,
      },
    };
  }

  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();

  if (credentialsJson) {
    const credentials = parseGoogleCredentialsJson(credentialsJson);

    return {
      authMode: "credentials-json",
      clientOptions: {
        apiEndpoint,
        credentials,
        projectId: config.projectId,
      },
    };
  }

  const clientEmail = readOptionalEnv("GOOGLE_CLIENT_EMAIL");
  const privateKey = readOptionalEnv("GOOGLE_PRIVATE_KEY");

  if (clientEmail && privateKey) {
    return {
      authMode: "service-account-env",
      clientOptions: {
        apiEndpoint,
        credentials: {
          client_email: clientEmail,
          private_key: normalizePrivateKey(privateKey),
        },
        projectId: config.projectId,
      },
    };
  }

  console.warn("[OCR] Google Document AI disabled", {
    reason: "No supported credentials were configured",
    hasCredentialsPath: false,
    hasCredentialsJson: false,
    hasClientEmail: Boolean(clientEmail),
    hasPrivateKey: Boolean(privateKey),
  });

  throw new CsvAnalysisError(
    "Google Document AI no tiene credenciales configuradas.",
    "GOOGLE_DOCUMENT_AI_CREDENTIALS_NOT_CONFIGURED",
  );
}

function parseGoogleCredentialsJson(value: string): GoogleDocumentAiCredentials {
  try {
    const parsed = JSON.parse(value) as {
      client_email?: unknown;
      private_key?: unknown;
    };
    const clientEmail =
      typeof parsed.client_email === "string" ? parsed.client_email.trim() : "";
    const privateKey =
      typeof parsed.private_key === "string" ? normalizePrivateKey(parsed.private_key) : "";

    if (!clientEmail || !privateKey) {
      throw new Error("Required service account fields are missing");
    }

    return {
      client_email: clientEmail,
      private_key: privateKey,
    };
  } catch {
    console.warn("[OCR] Google Document AI credentials JSON is invalid", {
      reason: "JSON parse failed or required fields are missing",
    });

    throw new CsvAnalysisError(
      "Las credenciales JSON de Google Document AI no son validas.",
      "GOOGLE_APPLICATION_CREDENTIALS_JSON_INVALID",
    );
  }
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, "\n");
}

function readRequiredEnv(name: string) {
  const value = readOptionalEnv(name);

  if (!value) {
    throw new CsvAnalysisError(
      "Google Document AI no esta configurado.",
      `${name}_REQUIRED`,
    );
  }

  return value;
}

function readOptionalEnv(name: string) {
  return process.env[name]?.trim().replace(/^['"]|['"]$/g, "") || "";
}

function extractDocumentAiTablesText(document: DocumentAiDocument) {
  const documentText = document.text ?? "";
  const lines: string[] = [];

  for (const page of document.pages ?? []) {
    for (const [tableIndex, table] of (page.tables ?? []).entries()) {
      lines.push(`Pagina ${page.pageNumber ?? "?"} Tabla ${tableIndex + 1}`);

      for (const row of [...(table.headerRows ?? []), ...(table.bodyRows ?? [])]) {
        const cells = (row.cells ?? []).map((cell) =>
          textAnchorToText(documentText, cell.layout?.textAnchor),
        );

        if (cells.some(Boolean)) {
          lines.push(cells.join(" | "));
        }
      }
    }
  }

  return lines.join("\n").trim();
}

function textAnchorToText(
  text: string,
  textAnchor?: {
    textSegments?: Array<{
      endIndex?: number | string;
      startIndex?: number | string;
    }>;
  },
) {
  return (textAnchor?.textSegments ?? [])
    .map((segment) => {
      const startIndex = Number(segment.startIndex ?? 0);
      const endIndex = Number(segment.endIndex ?? 0);

      return text.slice(startIndex, endIndex);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
