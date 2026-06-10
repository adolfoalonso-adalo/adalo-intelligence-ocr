import assert from "node:assert/strict";
import {
  parseOpenAiVisualResponse,
  shouldAttemptOpenAiVisualFallback,
} from "../lib/openai-visual-structuring.ts";

process.env.OPENAI_API_KEY = "test-key";
process.env.OCR_FALLBACK_MULTIMODAL_PROVIDER = "openai";
process.env.OCR_ENABLE_MULTIMODAL_FALLBACK = "true";

const expectedColumns = [
  "Numero",
  "NombreApellido",
  "CUIL",
  "LugarTrabajo",
  "Localidad",
  "Provincia",
];
const parsed = parseOpenAiVisualResponse(
  JSON.stringify({
    success: true,
    documentType: "nomina",
    detectedTitle: "Nomina del personal",
    columns: expectedColumns,
    rows: [
      {
        Numero: "1",
        NombreApellido: "Ana Perez",
        CUIL: "27123456785",
        LugarTrabajo: "CAMPAMENTO MARIANA",
        Localidad: "Campo Quijano",
        Provincia: "Salta",
        confidence: 0.95,
        warnings: [],
      },
    ],
    confidence: 0.91,
    warnings: [],
    missingFields: [],
    assumptions: [],
    orientationDetected: "0",
    failureReason: "",
  }),
  expectedColumns,
);

assert.equal(parsed.success, true);
assert.equal(parsed.confidence, 0.91);
assert.deepEqual(parsed.columns, expectedColumns);
assert.equal(parsed.rows.length, 1);
assert.equal(parsed.rows[0].CUIL, "27123456785");
assert.equal(parsed.jsonRows[0].confidence, "0.95");

const eligible = shouldAttemptOpenAiVisualFallback({
  documentAiDetectedTables: false,
  mimeType: "application/pdf",
  preprocessing: {
    documentKind: "scanned_pdf",
    hasReliableDigitalText: false,
    hasTableSignals: true,
    ignoredTextDetected: [],
    pagesProcessed: 2,
    rotationDetected: false,
    scannedTextWarning: true,
    warnings: [],
  },
  qualityGateFailed: true,
  rawTextContent: "Texto OCR recuperado con columnas desalineadas.",
});

assert.equal(eligible, true);

const notEligibleWithoutText = shouldAttemptOpenAiVisualFallback({
  documentAiDetectedTables: false,
  mimeType: "application/pdf",
  rawTextContent: "",
});

assert.equal(notEligibleWithoutText, false);

console.log("openai visual structuring tests passed");
