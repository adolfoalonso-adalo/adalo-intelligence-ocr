import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildStructuredSectionsFromPdfText,
  detectStructuredSectionsPdf,
  STRUCTURED_SECTIONS_COLUMNS,
} from "../lib/pdf-structured-sections.ts";
import { extractPdfTextByPages } from "../lib/pdf-text.ts";

const filePath = path.join(
  process.cwd(),
  "test-files",
  "Resumen descriptivo ERAMINE SUDAMERICA S.pdf",
);

if (!fs.existsSync(filePath)) {
  console.log(
    "test-files/Resumen descriptivo ERAMINE SUDAMERICA S.pdf no existe; se omite test:pdf-structured-sections.",
  );
  process.exit(0);
}

const fileBuffer = fs.readFileSync(filePath);
const extraction = await extractPdfTextByPages(fileBuffer);
const text = extraction.pages.map((page) => page.text).join("\n");

assert.equal(detectStructuredSectionsPdf(text), true);

const fallback = buildStructuredSectionsFromPdfText(extraction.pages);

assert.ok(fallback);
assert.deepEqual(fallback.columns, STRUCTURED_SECTIONS_COLUMNS);
assert.ok(fallback.rows.length >= 20);
assert.notDeepEqual(fallback.columns, ["Página", "Línea", "Texto"]);

console.log(
  JSON.stringify({
    columns: fallback.columns,
    extractedRows: fallback.rows.length,
    parserUsed: extraction.parserUsed,
  }),
);
