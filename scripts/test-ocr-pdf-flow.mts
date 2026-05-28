import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.FORCE_AI_FAILURE_FOR_TEST = "true";
process.env.GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || "test-api-key";
process.env.GOOGLE_AI_MODEL = process.env.GOOGLE_AI_MODEL || "gemini-2.5-flash";

const { analyzeFileToCsv } = await import("../lib/google-ai.ts");
const filePath = resolve("test-files/test.pdf");

if (!existsSync(filePath)) {
  console.warn("test-files/test.pdf no existe. Se omite test:ocr-pdf-flow.");
  process.exit(0);
}

const result = await analyzeFileToCsv(readFileSync(filePath), "test.pdf", "application/pdf");

assert.ok(
  ["local pdf text fallback", "pdf table fallback", "pdf structured sections fallback"].includes(
    result.modelUsed,
  ),
);
assert.ok(result.extractedRows > 0, "Debe generar filas desde texto local.");
assert.ok(
  result.csvContent.includes('"Página","Línea","Texto"') ||
    result.csvContent.includes('"N° Anexo","Nombre Anexo"') ||
    result.csvContent.includes('"Sección","Categoría","Dato"'),
);
assert.ok(result.fileName.endsWith(".csv"));

console.log(
  JSON.stringify({
    extractedRows: result.extractedRows,
    modelUsed: result.modelUsed,
  }),
);
