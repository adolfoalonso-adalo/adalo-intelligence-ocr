import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLocalPdfTextFallbackFromBuffer } from "../lib/pdf-local-fallback.ts";

const filePath = resolve("test-files/test.pdf");

if (!existsSync(filePath)) {
  console.warn("test-files/test.pdf no existe. Se omite test:ocr-api-fallback.");
  process.exit(0);
}

const fallback = await createLocalPdfTextFallbackFromBuffer(readFileSync(filePath), "test.pdf");

assert.ok(fallback, "El fallback del endpoint debe devolver un resultado.");
assert.ok(
  ["local pdf text fallback", "pdf table fallback", "pdf structured sections fallback"].includes(
    fallback.modelUsed,
  ),
);
assert.ok(fallback.extractedRows > 0, "Debe generar filas desde texto local.");
assert.ok(fallback.csvContent.split(/\r?\n/).length > 1);
assert.ok(fallback.fileName.endsWith(".csv"));

const responseLike = {
  success: true,
  csvContent: fallback.csvContent,
  fileName: fallback.fileName,
  extractedRows: fallback.extractedRows,
  modelUsed: fallback.modelUsed,
};

assert.equal(responseLike.success, true);
assert.ok(
  ["local pdf text fallback", "pdf table fallback", "pdf structured sections fallback"].includes(
    responseLike.modelUsed,
  ),
);
assert.ok(responseLike.extractedRows > 0);

console.log(
  JSON.stringify({
    success: responseLike.success,
    extractedRows: responseLike.extractedRows,
    modelUsed: responseLike.modelUsed,
  }),
);
