import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildKnownAnexoTableFromPdfText,
  KNOWN_ANEXO_TABLE_COLUMNS,
} from "../lib/pdf-table-fallback.ts";
import { extractPdfTextByPages } from "../lib/pdf-text.ts";

const filePath = path.join(process.cwd(), "test-files", "test.pdf");

if (!fs.existsSync(filePath)) {
  console.log("test-files/test.pdf no existe; se omite test:pdf-table-fallback.");
  process.exit(0);
}

const fileBuffer = fs.readFileSync(filePath);
const extraction = await extractPdfTextByPages(fileBuffer);
const fallback = buildKnownAnexoTableFromPdfText(extraction.pages);

assert.ok(fallback);
assert.deepEqual(fallback.columns, KNOWN_ANEXO_TABLE_COLUMNS);
assert.ok(fallback.rows.length > 0);
assert.notDeepEqual(fallback.columns, ["Página", "Línea", "Texto"]);

console.log(
  JSON.stringify({
    columns: fallback.columns,
    extractedRows: fallback.rows.length,
    parserUsed: extraction.parserUsed,
  }),
);
