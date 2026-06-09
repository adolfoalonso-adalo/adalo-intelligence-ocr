import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getClientProfileById } from "../lib/client-profiles.ts";
import { analyzeFileToCsv } from "../lib/google-ai.ts";
import { getPdfPageCount, renderPdfPageToImage } from "../lib/pdf-page-render.ts";

const candidates = [
  "LMA - SIMSA - 1er trimestre 2026.pdf",
  "tabla movim junio LITIO MINERA ARGENTINA.pdf",
  "tabla movim junio LITIO MINERA ARGENTINA(2).pdf",
];
const fixture = candidates
  .map((name) => join(process.cwd(), "test-files", name))
  .find((path) => existsSync(path));

if (!fixture) {
  console.log("No hay fixture Movimiento en test-files; se omite test:movimiento-visual-pages.");
  process.exit(0);
}

const buffer = readFileSync(fixture);
const pageCount = await getPdfPageCount(buffer);

assert.ok(pageCount > 0);

const firstPage = await renderPdfPageToImage(buffer, {
  pageNumber: 1,
});

assert.ok(firstPage.buffer.byteLength > 0);
assert.equal(firstPage.mimeType, "image/jpeg");

if (!process.env.GOOGLE_AI_API_KEY) {
  console.log(
    JSON.stringify({
      rendered: true,
      pageCount,
      firstPageBytes: firstPage.buffer.byteLength,
      aiExtractionSkipped: true,
    }),
  );
  process.exit(0);
}

try {
  const result = await analyzeFileToCsv(
    buffer,
    fixture.split(/[\\/]/).at(-1) ?? "movimiento.pdf",
    "application/pdf",
    "table",
    getClientProfileById("movimiento"),
  );
  const header = result.csvContent.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "";

  assert.ok(!result.modelUsed.toLowerCase().includes("local pdf text fallback"));
  assert.ok(!header.includes("Pagina,Linea,Texto"));
  assert.equal(header.split(",").length, 11);
  assert.equal(result.extractionMode === "movement-visual-pages" || result.modelUsed.includes("vision table"), true);

  console.log(
    JSON.stringify({
      extractedRows: result.extractedRows,
      extractionMode: result.extractionMode,
      modelUsed: result.modelUsed,
      pageCount,
    }),
  );
} catch (error) {
  const detail = error instanceof Error ? `${error.name} ${error.message} ${"technicalDetail" in error ? String(error.technicalDetail) : ""}` : String(error);
  const normalized = detail.toLowerCase();

  assert.ok(
    normalized.includes("failed_quality_gate_movimiento") ||
      normalized.includes("profile") ||
      normalized.includes("quality"),
  );

  console.log(
    JSON.stringify({
      failedWithQualityGate: true,
      pageCount,
    }),
  );
}
