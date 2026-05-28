import type { PdfTextPage } from "@/lib/pdf-text";

export type TextChunk = {
  chunkIndex: number;
  pageRange: string;
  pages: number[];
  text: string;
};

export type ChunkPdfPagesOptions = {
  maxChars: number;
  maxPages: number;
  overlapChars: number;
};

export class PdfChunkingError extends Error {
  readonly technicalDetail: string;

  constructor(
    message: string,
    technicalDetail: string,
  ) {
    super(message);
    this.name = "PdfChunkingError";
    this.technicalDetail = technicalDetail;
  }
}

export function getPdfChunkingConfig(): ChunkPdfPagesOptions {
  return {
    maxChars: readPositiveInteger(process.env.OCR_CHUNK_MAX_CHARS, 12000),
    maxPages: readPositiveInteger(process.env.OCR_MAX_PDF_PAGES, 30),
    overlapChars: readNonNegativeInteger(process.env.OCR_CHUNK_OVERLAP_CHARS, 500),
  };
}

export function chunkPdfPages(
  pages: PdfTextPage[],
  options: ChunkPdfPagesOptions = getPdfChunkingConfig(),
): TextChunk[] {
  if (pages.length > options.maxPages) {
    throw new PdfChunkingError(
      "El documento supera el límite de páginas permitido para esta versión.",
      `PDF has ${pages.length} pages. Limit is ${options.maxPages}.`,
    );
  }

  const chunks: Array<Omit<TextChunk, "chunkIndex">> = [];
  let currentPages: number[] = [];
  let currentText = "";

  for (const page of pages) {
    const normalizedText = page.text.trim();

    if (!normalizedText) continue;

    const pageText = `Página ${page.pageNumber}\n${normalizedText}`;
    const nextText = currentText ? `${currentText}\n\n${pageText}` : pageText;

    if (currentText && nextText.length > options.maxChars) {
      chunks.push(createChunk(currentText, currentPages));
      const overlap = getOverlapText(currentText, options.overlapChars);
      currentText = overlap ? `${overlap}\n\n${pageText}` : pageText;
      currentPages = [page.pageNumber];
      continue;
    }

    currentText = nextText;
    currentPages = [...currentPages, page.pageNumber];
  }

  if (currentText.trim()) {
    chunks.push(createChunk(currentText, currentPages));
  }

  return chunks.map((chunk, index) => ({
    ...chunk,
    chunkIndex: index + 1,
  }));
}

function createChunk(text: string, pages: number[]): Omit<TextChunk, "chunkIndex"> {
  return {
    pageRange: formatPageRange(pages),
    pages,
    text: text.trim(),
  };
}

function formatPageRange(pages: number[]) {
  if (pages.length === 0) return "";

  const first = pages[0];
  const last = pages[pages.length - 1];

  return first === last ? String(first) : `${first}-${last}`;
}

function getOverlapText(text: string, overlapChars: number) {
  if (overlapChars <= 0 || text.length <= overlapChars) return "";

  return trimAtSentenceBoundary(text.slice(-overlapChars), 0);
}

function trimAtSentenceBoundary(text: string, overlapChars: number) {
  const maxLength = Math.max(text.length - overlapChars, 0);

  if (maxLength === 0 || text.length <= maxLength + overlapChars) {
    return text.trim();
  }

  const slice = text.slice(0, maxLength + overlapChars);
  const boundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("; "),
    slice.lastIndexOf("\n"),
  );

  if (boundary > maxLength * 0.75) {
    return slice.slice(0, boundary + 1).trim();
  }

  return slice.trim();
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
