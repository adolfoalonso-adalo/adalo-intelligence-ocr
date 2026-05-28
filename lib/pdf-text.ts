import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type PdfTextPage = {
  pageNumber: number;
  text: string;
};

export type PdfTextExtractionResult = {
  pages: PdfTextPage[];
  totalTextLength: number;
  parserUsed?: "pdf-parse" | "pdfjs-dist" | "basic-scan";
};

type PdfParseModule = {
  PDFParse?: unknown;
  default?: unknown;
};

type PdfParseConstructor = new (options: { data: Uint8Array }) => {
  getText: () => Promise<{
    pages?: Array<{
      num?: number;
      text?: string;
    }>;
  }>;
  destroy?: () => Promise<void> | void;
};

type LegacyPdfParseFunction = (buffer: Buffer) => Promise<{
  text?: string;
  numpages?: number;
}>;

type PdfjsTextItem = {
  str?: string;
  hasEOL?: boolean;
  transform?: unknown[];
};

type PdfjsPage = {
  getTextContent: () => Promise<{
    items?: unknown[];
  }>;
};

type PdfjsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfjsPage>;
  destroy?: () => Promise<void> | void;
};

type PdfjsModule = {
  getDocument: (options: {
    data: Uint8Array;
    useWorkerFetch?: boolean;
    isEvalSupported?: boolean;
  disableFontFace?: boolean;
  disableWorker?: boolean;
  }) => {
    promise: Promise<PdfjsDocument>;
  };
  GlobalWorkerOptions?: {
    workerSrc?: string;
  };
};

export class PdfTextExtractionError extends Error {
  readonly technicalDetail: string;
  readonly code?: string;

  constructor(
    message: string,
    technicalDetail: string,
    code?: string,
  ) {
    super(message);
    this.name = "PdfTextExtractionError";
    this.technicalDetail = technicalDetail;
    this.code = code;
  }
}

export async function extractPdfTextByPages(
  fileBuffer: Buffer,
): Promise<PdfTextExtractionResult> {
  const failures: Array<{ parser: string; error: unknown }> = [];

  try {
    const result = normalizeExtractionResult(
      await extractWithPdfParse(fileBuffer),
      "pdf-parse",
    );
    ensureExtractionHasText(result, "pdf-parse");
    logPdfTextExtractionResult(result);
    return result;
  } catch (error) {
    failures.push({ parser: "pdf-parse", error });
    logPdfTextExtractionFailure("pdf-parse", fileBuffer, error, "pdf-parse");
  }

  try {
    const result = normalizeExtractionResult(
      await extractWithPdfjsDist(fileBuffer),
      "pdfjs-dist",
    );
    ensureExtractionHasText(result, "pdfjs-dist");
    logPdfTextExtractionResult(result);
    return result;
  } catch (error) {
    failures.push({ parser: "pdfjs-dist", error });
    logPdfTextExtractionFailure("pdfjs-dist", fileBuffer, error, "pdfjs-dist");
  }

  try {
    const result = normalizeExtractionResult(
      extractWithBasicPdfTextScan(fileBuffer),
      "basic-scan",
    );
    ensureExtractionHasText(result, "basic-scan");
    logPdfTextExtractionResult(result);
    return result;
  } catch (error) {
    failures.push({ parser: "basic-scan", error });
    logPdfTextExtractionFailure("basic-scan", fileBuffer, error, "basic-scan");
  }

  throw new PdfTextExtractionError(
    "No se pudo extraer texto del PDF.",
    summarizeExtractionFailures(failures),
    "PDF_TEXT_EXTRACTION_FAILED",
  );
}

async function extractWithPdfParse(fileBuffer: Buffer): Promise<{ pages: PdfTextPage[] }> {
  const pdfParseModule = (await import("pdf-parse")) as PdfParseModule;
  const pdfParseClass = findPdfParseClass(pdfParseModule);

  if (pdfParseClass) {
    return extractWithPdfParseClass(pdfParseClass, fileBuffer);
  }

  const legacyParser = findLegacyPdfParseFunction(pdfParseModule);

  if (legacyParser) {
    return extractWithLegacyPdfParse(legacyParser, fileBuffer);
  }

  throw new PdfTextExtractionError(
    "No se pudo extraer texto del PDF.",
    "pdf-parse module did not expose a supported parser",
    "PDF_PARSE_MODULE_INVALID",
  );
}

async function extractWithPdfParseClass(
  PDFParse: PdfParseConstructor,
  fileBuffer: Buffer,
) {
  const parser = new PDFParse({
    data: new Uint8Array(fileBuffer),
  });

  try {
    const result = await parser.getText();
    const pages = (result.pages ?? []).map((page, index) => ({
      pageNumber: typeof page.num === "number" ? page.num : index + 1,
      text: page.text ?? "",
    }));

    return { pages };
  } finally {
    await parser.destroy?.();
  }
}

async function extractWithLegacyPdfParse(
  pdfParse: LegacyPdfParseFunction,
  fileBuffer: Buffer,
) {
  const result = await pdfParse(fileBuffer);

  return {
    pages: [
      {
        pageNumber: 1,
        text: result.text ?? "",
      },
    ],
  };
}

async function extractWithPdfjsDist(fileBuffer: Buffer): Promise<{ pages: PdfTextPage[] }> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfjsModule;

  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfjsWorkerSrc();
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    disableWorker: true,
  });
  const document = await loadingTask.promise;

  try {
    const pages: PdfTextPage[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();

      pages.push({
        pageNumber,
        text: textItemsToText(textContent.items ?? []),
      });
    }

    return { pages };
  } finally {
    await document.destroy?.();
  }
}

function extractWithBasicPdfTextScan(fileBuffer: Buffer): { pages: PdfTextPage[] } {
  const raw = fileBuffer.toString("latin1");
  const textSegments = [
    ...extractLiteralPdfStrings(raw),
    ...extractHexPdfStrings(raw),
  ]
    .map(cleanScannedPdfText)
    .filter(isUsefulScannedText);

  const uniqueSegments = Array.from(new Set(textSegments));

  if (uniqueSegments.length === 0) {
    throw new PdfTextExtractionError(
      "No se pudo extraer texto del PDF.",
      "basic PDF text scan did not find useful text segments",
      "PDF_BASIC_SCAN_EMPTY",
    );
  }

  return {
    pages: [
      {
        pageNumber: 1,
        text: uniqueSegments.join("\n"),
      },
    ],
  };
}

function findPdfParseClass(pdfParseModule: PdfParseModule): PdfParseConstructor | null {
  if (typeof pdfParseModule.PDFParse === "function") {
    return pdfParseModule.PDFParse as PdfParseConstructor;
  }

  if (isRecord(pdfParseModule.default) && typeof pdfParseModule.default.PDFParse === "function") {
    return pdfParseModule.default.PDFParse as PdfParseConstructor;
  }

  return null;
}

function findLegacyPdfParseFunction(
  pdfParseModule: PdfParseModule,
): LegacyPdfParseFunction | null {
  if (typeof pdfParseModule.default === "function") {
    return pdfParseModule.default as LegacyPdfParseFunction;
  }

  return null;
}

function normalizeExtractionResult(
  extraction: { pages: PdfTextPage[] },
  parserUsed: PdfTextExtractionResult["parserUsed"],
): PdfTextExtractionResult {
  const pages = extraction.pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: normalizePageText(page.text),
  }));
  const totalTextLength = pages.reduce((total, page) => total + page.text.length, 0);

  return { pages, totalTextLength, parserUsed };
}

function ensureExtractionHasText(
  result: PdfTextExtractionResult,
  parser: NonNullable<PdfTextExtractionResult["parserUsed"]>,
) {
  if (result.totalTextLength > 0) return;

  throw new PdfTextExtractionError(
    "No se pudo extraer texto del PDF.",
    `${parser} returned no extractable text`,
    "PDF_TEXT_EMPTY",
  );
}

function textItemsToText(items: unknown[]) {
  const lines: string[] = [];
  let currentLine = "";

  for (const item of items) {
    if (!isPdfjsTextItem(item) || !item.str) continue;

    currentLine = `${currentLine} ${item.str}`.trim();

    if (item.hasEOL) {
      lines.push(currentLine);
      currentLine = "";
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.map(normalizeLine).filter(Boolean).join("\n");
}

function normalizePageText(value: string) {
  return value
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeLine(value: string) {
  return value.replace(/[ \t\f\v]+/g, " ").trim();
}

function resolvePdfjsWorkerSrc() {
  const workerPath = resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

  if (existsSync(workerPath)) {
    return pathToFileURL(workerPath).href;
  }

  return "";
}

function extractLiteralPdfStrings(raw: string) {
  const matches: string[] = [];
  const pattern = /\((?:\\.|[^\\()]){2,}\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    matches.push(decodePdfLiteralString(match[0].slice(1, -1)));
  }

  return matches;
}

function extractHexPdfStrings(raw: string) {
  const matches: string[] = [];
  const pattern = /<([0-9A-Fa-f]{8,})>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const decoded = decodePdfHexString(match[1]);

    if (decoded) {
      matches.push(decoded);
    }
  }

  return matches;
}

function decodePdfLiteralString(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\b/g, " ")
    .replace(/\\f/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) =>
      String.fromCharCode(parseInt(octal, 8)),
    );
}

function decodePdfHexString(value: string) {
  const normalized = value.length % 2 === 0 ? value : `${value}0`;
  const bytes: number[] = [];

  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(parseInt(normalized.slice(index, index + 2), 16));
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.slice(2));
  }

  return Buffer.from(bytes).toString("latin1");
}

function decodeUtf16Be(bytes: number[]) {
  let output = "";

  for (let index = 0; index + 1 < bytes.length; index += 2) {
    output += String.fromCharCode((bytes[index] << 8) + bytes[index + 1]);
  }

  return output;
}

function cleanScannedPdfText(value: string) {
  return stripControlCharacters(value)
    .replace(/\s+/g, " ")
    .trim();
}

function stripControlCharacters(value: string) {
  let output = "";

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isAllowedWhitespace = code === 9 || code === 10 || code === 13;
    const isControlCharacter = code < 32 || code === 127;

    output += isControlCharacter && !isAllowedWhitespace ? " " : value[index];
  }

  return output;
}

function isUsefulScannedText(value: string) {
  if (value.length < 3 || value.length > 1000) return false;

  const letters = value.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/g)?.length ?? 0;
  return letters / value.length >= 0.45;
}

function logPdfTextExtractionResult(result: PdfTextExtractionResult) {
  console.info("[OCR] PDF text extraction result", {
    parser: result.parserUsed,
    pages: result.pages.length,
    totalTextLength: result.totalTextLength,
  });
}

function logPdfTextExtractionFailure(
  parser: string,
  fileBuffer: Buffer,
  error: unknown,
  stage: string,
) {
  console.warn("[OCR] PDF text extraction failed", {
    parser,
    stage,
    bufferLength: fileBuffer.byteLength,
    ...getSafeErrorLog(error),
  });
}

function summarizeExtractionFailures(failures: Array<{ parser: string; error: unknown }>) {
  return failures
    .map(({ parser, error }) => `${parser}: ${getSafeErrorLog(error).errorMessage}`)
    .join(" | ")
    .slice(0, 360);
}

function getSafeErrorLog(error: unknown) {
  const errorName = error instanceof Error ? error.name : typeof error;
  const errorMessage =
    error instanceof Error
      ? error.message.replace(/\s+/g, " ").slice(0, 220)
      : String(error ?? "").replace(/\s+/g, " ").slice(0, 220);
  const errorCode =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";

  return { errorName, errorMessage, errorCode };
}

function isPdfjsTextItem(value: unknown): value is PdfjsTextItem {
  return isRecord(value) && typeof value.str === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
