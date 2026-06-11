import assert from "node:assert/strict";
import {
  assertVisibleHeadersTakePriority,
  assessAgenticTableResult,
  containsMovementColumns,
  findUnsupportedLegacyColumns,
  parseAgenticExtractorResponse,
  parseAgenticReviewerResponse,
  UNIVERSAL_EXTRACTION_MODE,
} from "@/lib/agentic-table-extraction";
import { createXlsxBase64 } from "@/lib/xlsx-export";

const supplierHeaders = [
  "Nombre empresa",
  "Proveedor",
  "CUIT",
  "Servicio/Área",
  "Provincia",
  "Zona de radicación",
  "Fecha/Periodo de contratación",
  "Modalidad de contratación",
];

const movementHeaders = [
  "FechaSalida",
  "CantidadCamion",
  "Unidad",
  "Tons",
  "Proveedor",
  "Producto",
  "Origen",
  "RutaCaminosPuna",
  "Destino",
  "FechaArribo",
  "CantidadEscoltas",
];

const extractor = parseAgenticExtractorResponse(
  JSON.stringify({
    documentTitle: "Listado de proveedores",
    documentType: "Listado de proveedores y contrataciones",
    detectedHeaders: supplierHeaders,
    rows: [
      {
        "Nombre empresa": "Empresa Minera Argentina",
        Proveedor: "Proveedor Norte",
        CUIT: "30-71234567-8",
        "Servicio/Área": "Transporte",
        Provincia: "Salta",
        "Zona de radicación": "Puna",
        "Fecha/Periodo de contratación": "2026",
        "Modalidad de contratación": "Directa",
      },
    ],
    confidence: 0.91,
    warnings: [],
  }),
);

assert.deepEqual(extractor.detectedHeaders, supplierHeaders);
assert.equal(containsMovementColumns(extractor.detectedHeaders), false);

const reviewed = parseAgenticReviewerResponse(
  JSON.stringify({
    finalDocumentType: "Listado de proveedores y contrataciones",
    finalHeaders: supplierHeaders,
    finalRows: extractor.rows,
    correctionsApplied: ["Se preservaron los encabezados visibles."],
    confidence: 0.94,
    warnings: [],
  }),
);

assert.deepEqual(reviewed.finalHeaders, supplierHeaders);
assert.equal(containsMovementColumns(reviewed.finalHeaders), false);
assert.equal(assessAgenticTableResult(reviewed).acceptable, true);
assert.equal(UNIVERSAL_EXTRACTION_MODE, "document_ai_gpt_optimized");
assert.deepEqual(
  findUnsupportedLegacyColumns(movementHeaders, supplierHeaders.join(" ")),
  [
    "FechaSalida",
    "CantidadCamion",
    "Unidad",
    "Tons",
    "RutaCaminosPuna",
    "CantidadEscoltas",
  ],
);
assert.deepEqual(
  findUnsupportedLegacyColumns(movementHeaders, movementHeaders.join(" ")),
  [],
);

assert.deepEqual(
  assertVisibleHeadersTakePriority({
    detectedHeaders: supplierHeaders,
    forcedProfile: false,
    profileColumns: movementHeaders,
  }),
  supplierHeaders,
);
assert.deepEqual(
  assertVisibleHeadersTakePriority({
    detectedHeaders: supplierHeaders,
    forcedProfile: true,
    profileColumns: movementHeaders,
  }),
  movementHeaders,
);

const xlsxBase64 = await createXlsxBase64({
  columns: reviewed.finalHeaders,
  rows: reviewed.finalRows,
  sheetName: reviewed.finalDocumentType,
});
assert.equal(Buffer.from(xlsxBase64, "base64").subarray(0, 2).toString(), "PK");

console.info("Agentic table regression passed", {
  headers: reviewed.finalHeaders.length,
  rows: reviewed.finalRows.length,
  movementColumnsRejected: true,
  xlsxGenerated: true,
});
