import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLocalPdfTextFallbackResult } from "../lib/pdf-local-fallback.ts";
import { extractPdfTextByPages } from "../lib/pdf-text.ts";

process.env.FORCE_LOCAL_PDF_FALLBACK = "true";
process.env.GOOGLE_AI_API_KEY = "";

const filePath = resolve("test-files/test.pdf");

if (!existsSync(filePath)) {
  console.warn("test-files/test.pdf no existe. Se omite test:ocr-force-local.");
  process.exit(0);
}

const forceLocalPdfFallback =
  (process.env.FORCE_LOCAL_PDF_FALLBACK ?? "").trim().replace(/^['"]|['"]$/g, "").toLowerCase() ===
  "true";

assert.equal(forceLocalPdfFallback, true, "FORCE_LOCAL_PDF_FALLBACK debe estar activo.");

const extraction = await extractPdfTextByPages(readFileSync(filePath));
const fallback = createLocalPdfTextFallbackResult({
  pages: extraction.pages,
  originalFileName: "test.pdf",
});

assert.ok(extraction.pages.length > 0, "Debe extraer páginas del PDF.");
assert.ok(extraction.totalTextLength > 0, "Debe extraer texto del PDF.");
assert.ok(fallback, "Debe generar resultado local.");
assert.ok(
  ["local pdf text fallback", "pdf table fallback", "pdf structured sections fallback"].includes(
    fallback.modelUsed,
  ),
);
assert.ok(fallback.extractedRows > 0, "Debe generar filas desde texto local.");
assert.ok(fallback.csvContent.split(/\r?\n/).length > 1);

console.log(
  JSON.stringify({
    forceLocalPdfFallback,
    googleAiUsed: false,
    parserUsed: extraction.parserUsed,
    pages: extraction.pages.length,
    totalTextLength: extraction.totalTextLength,
    extractedRows: fallback.extractedRows,
    modelUsed: fallback.modelUsed,
  }),
);
