import assert from "node:assert/strict";
import {
  assessAgenticTableResult,
  hasSupplierDocumentHeaders,
  prepareAgenticVisualContext,
} from "@/lib/agentic-table-extraction";

const supplierHeaders = [
  "Nombre empresa",
  "Proveedor",
  "CUIT",
  "Servicio/Area",
  "Provincia",
  "Zona de radicacion",
  "Fecha/Periodo de contratacion",
  "Modalidad de contratacion",
];

const visualPreparation = await prepareAgenticVisualContext(
  {
    documentType: "auto",
    fileBuffer: Buffer.from("%PDF-1.7 simulated"),
    fileName: "proveedores-camscanner.pdf",
    mimeType: "application/pdf",
    pagesProcessed: 3,
    rawTextContent: [
      supplierHeaders.join(" | "),
      "Empresa Uno | Proveedor Norte | 30-71234567-8 | Transporte | Salta | Puna | 2026 | Directa",
    ].join("\n"),
  },
  async () => {
    throw new ReferenceError("DOMMatrix is not defined");
  },
);

assert.equal(visualPreparation.attempted, true);
assert.equal(visualPreparation.succeeded, false);
assert.equal(visualPreparation.mode, "text_layout_only");
assert.equal(visualPreparation.images.length, 0);
assert.match(visualPreparation.error ?? "", /DOMMatrix is not defined/);
assert.equal(hasSupplierDocumentHeaders(supplierHeaders), true);

const rows = Array.from({ length: 5 }, (_, index) =>
  Object.fromEntries(
    supplierHeaders.map((header) => [
      header,
      header === "CUIT"
        ? `30-7123456${index}-${index}`
        : `Valor ${index + 1}`,
    ]),
  ),
);
const quality = assessAgenticTableResult(
  {
    confidence: 0.41,
    correctionsApplied: [],
    finalDocumentType: "Listado de proveedores",
    finalHeaders: supplierHeaders,
    finalRows: rows,
    warnings: ["Reconstruido desde texto y layout."],
  },
  { visualPagesRendered: false },
);

assert.equal(quality.acceptable, true);
assert.equal(
  quality.reason,
  "Supplier table reconstructed from Document AI text/layout",
);

console.info("PDF render fallback tests passed", {
  gptExtractorMode: visualPreparation.mode,
  rows: rows.length,
  visualPagesRendered: visualPreparation.succeeded,
  visualRenderError: visualPreparation.error,
});
