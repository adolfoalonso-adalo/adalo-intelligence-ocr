import {
  getClientProfileCode,
  isCompanyPersonnelProfile,
  isPersonnelRosterProfile,
  resolveDocumentTypeForProfile,
  type ClientProfile,
} from "@/lib/client-profiles";
import {
  COMPANY_PERSONNEL_COLUMNS,
  calculateCompanyPersonnelMetrics,
  extractCompanyPersonnelByPattern,
  hasPotentialCompanyPersonnelSignals,
  isValidDni,
  scoreCompanyPersonnelText,
  type CompanyPersonnelPatternResult,
} from "@/lib/company-personnel-pattern";
import { createCsvFileName } from "@/lib/csv";
import type { DocumentPreprocessingResult } from "@/lib/document-preprocessing";
import type { DocumentType } from "@/lib/document-type";
import { parseCsvPreview } from "@/lib/csv-preview";
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
import { classifyInternalOCRProfile } from "@/lib/internal-profile-classifier";
import type { OCRProfileRestriction } from "@/lib/profile-restrictions";
import {
  calculatePersonnelRosterMetrics,
  extractPersonnelRosterByPattern,
  normalizePersonnelRosterValue,
  PERSONNEL_ROSTER_COLUMNS,
  type PersonnelRosterPatternResult,
} from "@/lib/personnel-roster-pattern";
import { recordsToCsv } from "@/lib/structured-output";

export type OCRProviderName = "google-ai" | "advanced-document" | "google-document-ai";

export type OCRProviderInput = {
  clientProfile?: ClientProfile;
  documentType: DocumentType;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  preprocessing?: DocumentPreprocessingResult;
  profileRestriction?: OCRProfileRestriction;
};

export type OCRProviderResult = CsvAnalysisResult & {
  documentAiDetectedTables?: boolean;
  internalProfile?: ClientProfile;
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
      ...normalizeProviderResultForProfile(result, clientProfile),
      internalProfile: clientProfile,
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
    const selectedDocument = await selectDocumentAiOrientation({
      client,
      fileBuffer: input.fileBuffer,
      mimeType: input.mimeType,
      name,
    });
    const document = selectedDocument.document;

    if (!document?.text?.trim()) {
      throw new CsvAnalysisError(
        "Google Document AI no devolvio texto util.",
        "GOOGLE_DOCUMENT_AI_EMPTY_TEXT",
      );
    }

    const rawTextContent = sanitizeRawOcrText(document.text);
    const tablesText = extractDocumentAiTablesText(document);
    const classification = classifyInternalOCRProfile({
      configuredProfile: input.clientProfile,
      fileName: input.fileName,
      hasTableSignals: Boolean(tablesText),
      restriction: input.profileRestriction,
      text: rawTextContent,
    });
    const clientProfile = await withCorrectionExamples(classification.profile);
    const documentType = resolveDocumentTypeForProfile(
      classification.confidence === "low" ? input.documentType : "auto",
      classification.profile,
    );
    console.info("[OCR] internal profile classified", {
      allowedProfiles: classification.allowedProfiles,
      confidence: classification.confidence,
      detectedProfileBeforeRestriction:
        classification.detectedProfileBeforeRestriction.id,
      finalProfileUsed: getClientProfileCode(classification.profile),
      forcedProfile: classification.forcedProfile,
      profileUsed: getClientProfileCode(classification.profile),
      reason: classification.reason,
      restrictionMode: classification.restrictionMode,
      restrictionReason: classification.restrictionReason,
      providerUsed: this.name,
    });
    const personnelPattern = isPersonnelRosterProfile(classification.profile)
      ? extractPersonnelRosterByPattern(rawTextContent)
      : null;
    const companyPersonnelPattern = isCompanyPersonnelProfile(
      classification.profile,
    )
      ? extractCompanyPersonnelByPattern(rawTextContent)
      : null;

    if (personnelPattern) {
      console.info("[OCR] personnel roster pattern assessment", {
        detectedCuils: personnelPattern.detectedCuils,
        profileUsed: getClientProfileCode(classification.profile),
        providerUsed: this.name,
        qualityScore: personnelPattern.qualityScore,
        recognizedProvinceRows: personnelPattern.recognizedProvinceRows,
        validRows: personnelPattern.validRows,
      });
    }

    if (personnelPattern?.acceptable) {
      return {
        ...createPersonnelPatternResult({
          fileName: input.fileName,
          hasExplicitTables: Boolean(tablesText),
          pageCount: document.pages?.length ?? 0,
          pattern: personnelPattern,
        }),
        internalProfile: classification.profile,
        providerUsed: this.name,
        rawTextContent,
        textLength: rawTextContent.length,
      };
    }

    if (companyPersonnelPattern) {
      console.info("[OCR] company personnel pattern assessment", {
        profileUsed: getClientProfileCode(classification.profile),
        providerUsed: this.name,
        qualityScore: companyPersonnelPattern.qualityScore,
        companiesDetected:
          companyPersonnelPattern.metrics.empresasDetectadas,
        cuitsDetected: companyPersonnelPattern.metrics.cuitsDetectados,
        dnisDetected: companyPersonnelPattern.metrics.dnisDetectados,
        rowsExtracted:
          companyPersonnelPattern.metrics.registrosEstructurados,
        orientationSelected: selectedDocument.orientationSelected,
      });
    }

    if (companyPersonnelPattern?.acceptable) {
      return {
        ...createCompanyPersonnelPatternResult({
          hasExplicitTables: Boolean(tablesText),
          orientationSelected: selectedDocument.orientationSelected,
          pageCount: document.pages?.length ?? 1,
          pattern: companyPersonnelPattern,
        }),
        internalProfile: classification.profile,
        providerUsed: this.name,
        rawTextContent,
        textLength: rawTextContent.length,
      };
    }

    let normalized: CsvAnalysisResult;

    try {
      normalized = await analyzeExtractedDocumentToCsv({
        clientProfile,
        documentType,
        extractedTablesText: tablesText,
        extractedText: rawTextContent,
        fileName: input.fileName,
        pageCount: document.pages?.length,
        providerLabel: "google-document-ai",
      });
    } catch (error) {
      throw new OCRTextOnlyError({
        canDownloadRawText: true,
        companyPersonnelQualityMetrics:
          companyPersonnelPattern?.metrics,
        documentAiDetectedTables: Boolean(tablesText),
        extractionMode: "ocr_text_only",
        fallbackUsed: false,
        pagesProcessed: document.pages?.length ?? 0,
        orientationSelected: selectedDocument.orientationSelected,
        profileUsed: getClientProfileCode(classification.profile),
        providerUsed: this.name,
        qualityScore:
          personnelPattern?.qualityScore ??
          companyPersonnelPattern?.qualityScore ??
          0.5,
        qualityStatus: "failed_quality_gate",
        rawTextContent,
        reason: personnelPattern
          ? `El patron deterministico no alcanzo el 65% de filas validas. ${getSafeNormalizationFailureReason(error)}`
          : companyPersonnelPattern
            ? `El patron empresa/personal no alcanzo el umbral propio. ${getSafeNormalizationFailureReason(error)}`
            : getSafeNormalizationFailureReason(error),
        textLength: rawTextContent.length,
        warnings: [
          ...(tablesText ? [] : ["Google Document AI no detecto tablas explicitas."]),
          ...(personnelPattern?.warnings ?? []),
          ...(companyPersonnelPattern?.warnings ?? []),
          "El texto OCR fue recuperado, pero no pudo normalizarse como una tabla confiable.",
        ],
      });
    }

    return {
      ...normalizeProviderResultForProfile(normalized, classification.profile),
      documentAiDetectedTables: Boolean(tablesText),
      internalProfile: classification.profile,
      providerUsed: this.name,
      rawTextContent,
      textLength: rawTextContent.length,
      orientationSelected: selectedDocument.orientationSelected,
      warnings: [
        ...(normalized.warnings ?? []),
        ...(tablesText ? [] : ["Google Document AI no detecto tablas explicitas; se normalizo desde texto OCR."]),
      ],
    };
  }
}

async function selectDocumentAiOrientation(input: {
  client: DocumentAiClient;
  fileBuffer: Buffer;
  mimeType: string;
  name: string;
}): Promise<{
  document: DocumentAiDocument;
  orientationSelected: 0 | 90 | 180 | 270;
}> {
  const initialDocument = await processDocumentAi(
    input.client,
    input.name,
    input.fileBuffer,
    input.mimeType,
  );
  const initialText = sanitizeRawOcrText(initialDocument.text ?? "");

  if (
    (input.mimeType !== "image/jpeg" &&
      input.mimeType !== "image/png") ||
    !hasPotentialCompanyPersonnelSignals(initialText)
  ) {
    return {
      document: initialDocument,
      orientationSelected: 0,
    };
  }

  let best = {
    document: initialDocument,
    orientation: 0 as 0 | 90 | 180 | 270,
    score: scoreCompanyPersonnelText(initialText),
  };

  for (const rotation of [90, 180, 270] as const) {
    try {
      const rotatedBuffer = await rotateImageForDocumentAi(
        input.fileBuffer,
        rotation,
      );
      const document = await processDocumentAi(
        input.client,
        input.name,
        rotatedBuffer,
        "image/jpeg",
      );
      const text = sanitizeRawOcrText(document.text ?? "");
      const score = scoreCompanyPersonnelText(text);
      const patternResult = extractCompanyPersonnelByPattern(text);

      console.info("[OCR] company personnel orientation assessment", {
        orientation: rotation,
        score: Math.round(score * 100) / 100,
        companiesDetected: patternResult.metrics.empresasDetectadas,
        cuitsDetected: patternResult.metrics.cuitsDetectados,
        dnisDetected: patternResult.metrics.dnisDetectados,
        textLength: text.length,
      });

      if (score > best.score) {
        best = {
          document,
          orientation: rotation,
          score,
        };
      }
    } catch (error) {
      console.warn("[OCR] company personnel orientation failed", {
        orientation: rotation,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  console.info("[OCR] company personnel orientation selected", {
    orientationSelected: best.orientation,
    score: Math.round(best.score * 100) / 100,
  });

  return {
    document: best.document,
    orientationSelected: best.orientation,
  };
}

async function processDocumentAi(
  client: DocumentAiClient,
  name: string,
  fileBuffer: Buffer,
  mimeType: string,
) {
  const [response] = await client.processDocument({
    name,
    rawDocument: {
      content: fileBuffer.toString("base64"),
      mimeType,
    },
  });

  if (!response.document) {
    throw new CsvAnalysisError(
      "Google Document AI no devolvio un documento.",
      "GOOGLE_DOCUMENT_AI_EMPTY_DOCUMENT",
    );
  }

  return response.document;
}

async function rotateImageForDocumentAi(
  fileBuffer: Buffer,
  rotation: 90 | 180 | 270,
) {
  const sharpModule = await import("sharp");
  return sharpModule.default(fileBuffer)
    .rotate(rotation)
    .jpeg({ mozjpeg: true, quality: 90 })
    .toBuffer();
}

function normalizeProviderResultForProfile(
  result: CsvAnalysisResult,
  profile?: ClientProfile,
): CsvAnalysisResult {
  if (isCompanyPersonnelProfile(profile)) {
    const columns = [...COMPANY_PERSONNEL_COLUMNS];
    const parsed = parseCsvPreview(result.csvContent);
    const parsedRows = parsed.rows.map((values) =>
      Object.fromEntries(
        parsed.columns.map((column, index) => [column, values[index] ?? ""]),
      ),
    );
    const normalizedRows = parsedRows.map((row) =>
      Object.fromEntries(
        columns.map((column) => [column, findRowValue(row, column)]),
      ),
    );
    const rowsWithDni = normalizedRows.filter((row) =>
      isValidDni(row.DNI),
    );
    const finalRows = rowsWithDni.length > 0 ? rowsWithDni : normalizedRows;

    return {
      ...result,
      companyPersonnelQualityMetrics:
        calculateCompanyPersonnelMetrics(finalRows),
      csvContent: recordsToCsv(columns, finalRows),
      extractedRows: finalRows.length,
      jsonColumns: columns,
      jsonRows: finalRows,
      rowsExtracted: finalRows.length,
    };
  }

  if (profile?.defaultExtractionProfile !== "personnel-roster") {
    return result;
  }

  const columns = [
    ...PERSONNEL_ROSTER_COLUMNS,
  ];
  const parsed = parseCsvPreview(result.csvContent);
  const parsedRows = parsed.rows.map((values) =>
    Object.fromEntries(parsed.columns.map((column, index) => [column, values[index] ?? ""])),
  );
  const normalizedRows = parsedRows
    .map((row) => {
      const normalized: Record<string, string> = {};

      for (const column of columns) {
        normalized[column] = normalizePersonnelRosterValue(
          column,
          findRowValue(row, column),
        );
      }

      return normalized;
    });
  const rowsWithCuil = normalizedRows.filter((row) => /^\d{10,11}$/.test(row.CUIL));
  const finalRows = rowsWithCuil.length > 0 ? rowsWithCuil : normalizedRows;

  return {
    ...result,
    csvContent: recordsToCsv(columns, finalRows),
    extractedRows: finalRows.length,
    jsonColumns: columns,
    jsonRows: finalRows,
    personnelQualityMetrics: calculatePersonnelRosterMetrics(finalRows),
    rowsExtracted: finalRows.length,
  };
}

function findRowValue(row: Record<string, string>, expectedColumn: string) {
  const expected = normalizeColumnName(expectedColumn);
  const sourceColumn = Object.keys(row).find(
    (column) => normalizeColumnName(column) === expected,
  );

  return sourceColumn ? row[sourceColumn] : "";
}

function normalizeColumnName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function createPersonnelPatternResult(input: {
  fileName: string;
  hasExplicitTables: boolean;
  pageCount: number;
  pattern: PersonnelRosterPatternResult;
}): CsvAnalysisResult {
  const columns = [...PERSONNEL_ROSTER_COLUMNS];
  const rows = input.pattern.rows.map((row) => ({ ...row }));

  console.info("[OCR] personnel roster pattern structured", {
    extractionMode: "pattern_structured",
    fileName: input.fileName,
    pagesProcessed: input.pageCount,
    qualityScore: input.pattern.qualityScore,
    rowsExtracted: rows.length,
  });

  return {
    csvContent: recordsToCsv(columns, rows),
    extractedRows: rows.length,
    extractionMode: "pattern_structured",
    fileName: createCsvFileName("NOMINA"),
    jsonColumns: columns,
    jsonRows: rows,
    modelUsed: "google-document-ai · pattern_structured",
    pagesProcessed: input.pageCount,
    personnelQualityMetrics: input.pattern.metrics,
    resultQuality: "ai",
    rowsExtracted: rows.length,
    warnings: [
      ...input.pattern.warnings,
      ...(input.hasExplicitTables
        ? []
        : ["La nomina se reconstruyo por patron de CUIL sin tabla explicita."]),
    ],
  };
}

function createCompanyPersonnelPatternResult(input: {
  hasExplicitTables: boolean;
  orientationSelected: 0 | 90 | 180 | 270;
  pageCount: number;
  pattern: CompanyPersonnelPatternResult;
}): CsvAnalysisResult {
  const columns = [...COMPANY_PERSONNEL_COLUMNS];
  const rows = input.pattern.rows.map((row) => ({ ...row }));

  console.info("[OCR] company personnel pattern structured", {
    extractionMode: "pattern_structured",
    orientationSelected: input.orientationSelected,
    pagesProcessed: input.pageCount,
    qualityScore: input.pattern.qualityScore,
    rowsExtracted: rows.length,
  });

  return {
    companyPersonnelQualityMetrics: input.pattern.metrics,
    csvContent: recordsToCsv(columns, rows),
    extractedRows: rows.length,
    extractionMode: "pattern_structured",
    fileName: createCsvFileName("PERSONAL_EMPRESA"),
    jsonColumns: columns,
    jsonRows: rows,
    modelUsed: "google-document-ai · company personnel pattern",
    orientationSelected: input.orientationSelected,
    pagesProcessed: input.pageCount,
    providerConfidence: input.pattern.qualityScore,
    resultQuality: "ai",
    rowsExtracted: rows.length,
    warnings: [
      ...input.pattern.warnings,
      ...(input.hasExplicitTables
        ? []
        : [
            "El listado se reconstruyo por patrones de Empresa, CUIT y DNI sin tabla explicita.",
          ]),
    ],
  };
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
