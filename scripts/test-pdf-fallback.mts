import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractPdfTextByPages } from "../lib/pdf-text.ts";
import { pdfTextPagesToCsvFallback } from "../lib/structured-output.ts";

const filePath = resolve("test-files/test.pdf");

if (!existsSync(filePath)) {
  console.warn("test-files/test.pdf no existe. Se omite test:pdf-fallback.");
  process.exit(0);
}

const buffer = readFileSync(filePath);
const extraction = await extractPdfTextByPages(buffer);
const fallback = pdfTextPagesToCsvFallback(extraction.pages);

assert.ok(extraction.pages.length > 0, "Debe detectar al menos una página.");
assert.ok(extraction.totalTextLength > 0, "Debe extraer texto del PDF.");
assert.ok(fallback.rows.length > 0, "Debe generar filas de fallback.");
assert.deepEqual(fallback.columns, ["Página", "Línea", "Texto"]);
assert.ok(fallback.csvContent.length > 0, "Debe generar CSV no vacío.");
assert.ok(fallback.csvContent.startsWith('"Página","Línea","Texto"'));

console.log(
  JSON.stringify({
    columns: fallback.columns,
    parserUsed: extraction.parserUsed,
    extractedRows: fallback.rows.length,
    pages: extraction.pages.length,
    totalTextLength: extraction.totalTextLength,
  }),
);
