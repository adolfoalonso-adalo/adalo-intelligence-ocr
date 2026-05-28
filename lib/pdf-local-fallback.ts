import { createCsvFileName } from "@/lib/csv";
import { buildStructuredSectionsFromPdfText } from "@/lib/pdf-structured-sections";
import { buildKnownAnexoTableFromPdfText } from "@/lib/pdf-table-fallback";
import { extractPdfTextByPages, type PdfTextPage } from "@/lib/pdf-text";
import { pdfTextPagesToCsvFallback } from "@/lib/structured-output";

export type LocalPdfTextFallbackResult = {
  csvContent: string;
  fileName: string;
  extractedRows: number;
  modelUsed:
    | "local pdf text fallback"
    | "pdf structured sections fallback"
    | "pdf table fallback";
  resultQuality: "local-fallback" | "partial";
  pageCount: number;
  totalTextLength: number;
};

export function createLocalPdfTextFallbackResult({
  pages,
  totalTextLength,
}: {
  pages: PdfTextPage[];
  originalFileName?: string;
  totalTextLength?: number;
}): LocalPdfTextFallbackResult | null {
  const tableFallback = buildKnownAnexoTableFromPdfText(pages);

  if (tableFallback) {
    return {
      csvContent: tableFallback.csvContent,
      fileName: createCsvFileName(),
      extractedRows: tableFallback.rows.length,
      modelUsed: "pdf table fallback",
      resultQuality: "partial",
      pageCount: pages.length,
      totalTextLength:
        totalTextLength ?? pages.reduce((total, page) => total + page.text.length, 0),
    };
  }

  const structuredSectionsFallback = buildStructuredSectionsFromPdfText(pages);

  if (structuredSectionsFallback) {
    return {
      csvContent: structuredSectionsFallback.csvContent,
      fileName: createCsvFileName(),
      extractedRows: structuredSectionsFallback.rows.length,
      modelUsed: "pdf structured sections fallback",
      resultQuality: "partial",
      pageCount: pages.length,
      totalTextLength:
        totalTextLength ?? pages.reduce((total, page) => total + page.text.length, 0),
    };
  }

  const fallback = pdfTextPagesToCsvFallback(pages);

  if (fallback.rows.length === 0) {
    return null;
  }

  return {
    csvContent: fallback.csvContent,
    fileName: createCsvFileName(),
    extractedRows: fallback.rows.length,
    modelUsed: "local pdf text fallback",
    resultQuality: "local-fallback",
    pageCount: pages.length,
    totalTextLength:
      totalTextLength ?? pages.reduce((total, page) => total + page.text.length, 0),
  };
}

export async function createLocalPdfTextFallbackFromBuffer(
  fileBuffer: Buffer,
  originalFileName?: string,
) {
  const extraction = await extractPdfTextByPages(fileBuffer);

  if (extraction.totalTextLength <= 0) {
    return null;
  }

  return createLocalPdfTextFallbackResult({
    pages: extraction.pages,
    originalFileName,
    totalTextLength: extraction.totalTextLength,
  });
}
