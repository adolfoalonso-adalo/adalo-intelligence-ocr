import assert from "node:assert/strict";
import { containsMovementColumns } from "@/lib/agentic-table-extraction";
import {
  SUPPLIER_TABLE_COLUMNS,
  countValidCuits,
  normalizeDocumentTableFromTextLayout,
} from "@/lib/document-table-recovery";

const header =
  "Nombre empresa | Proveedor | CUIT | SERVICIO/AREA | PROVINCIA | ZONA DE RADICACIÓN | FECHA/PERIODO DE CONTRATACIÓN | MODALIDAL CONTRATACIÓN";
const rows = Array.from({ length: 24 }, (_, index) => {
  const body = String(38036220 + index).padStart(8, "0");
  return [
    index === 0 ? "Panaderia Don Fabián" : `Empresa ${index + 1}`,
    index === 0 ? "Alex Fabian" : `Proveedor ${index + 1}`,
    `20-${body}-${index % 10}`,
    index === 0 ? "Panadería" : "Servicios de Gestión Social",
    "Salta",
    index % 2 === 0
      ? "Estación Salar de Pocitos"
      : "Alquiler de Vehículos",
    index % 2 === 0 ? "01.12.25" : "22.03.26 al 23.03.26",
    index % 2 === 0 ? "Periodica" : "Durante campaña",
  ].join(" | ");
});
const rawText = [
  "CamScanner 11-06-2026 08.38",
  header,
  ...rows,
].join("\n");

const recovery = normalizeDocumentTableFromTextLayout({
  extractedHeaders: [...SUPPLIER_TABLE_COLUMNS],
  extractedRows: [],
  rawTextContent: rawText,
  reviewerConfidence: 0.41,
  reviewedHeaders: [...SUPPLIER_TABLE_COLUMNS],
  reviewedRows: [],
});

assert.ok(recovery, "Expected a recoverable supplier table");
assert.deepEqual(recovery.detectedHeaders, [...SUPPLIER_TABLE_COLUMNS]);
assert.ok(recovery.rows.length >= 20);
assert.ok(countValidCuits(recovery.rows) >= 20);
assert.equal(containsMovementColumns(recovery.detectedHeaders), false);
assert.equal(recovery.confidence, 0.65);
assert.ok(recovery.warnings.length >= 2);

console.info("Agentic table recovery tests passed", {
  confidence: recovery.confidence,
  headers: recovery.detectedHeaders.length,
  qualityStatus: "accepted_with_warnings",
  rows: recovery.rows.length,
  source: recovery.source,
});
