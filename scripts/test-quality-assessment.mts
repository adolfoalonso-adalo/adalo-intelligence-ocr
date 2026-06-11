import assert from "node:assert/strict";
import { getClientProfileById } from "../lib/client-profiles.ts";
import { assessOCRQuality } from "../lib/ocr-quality.ts";
import { assessExtractionQuality } from "../lib/structured-output.ts";

const commercialColumns = [
  "TipoDocumento",
  "Organismo",
  "NumeroDocumento",
  "CUVE",
  "CADTV",
  "FechaEmision",
  "FechaCarga",
  "FechaVencimiento",
  "Motivo",
  "Emisor",
  "CUITEmisor",
  "Receptor",
  "CUITReceptor",
  "DomicilioOrigen",
  "LocalidadOrigen",
  "ProvinciaOrigen",
  "DomicilioDestino",
  "LocalidadDestino",
  "ProvinciaDestino",
  "Producto",
  "Variedad",
  "Acondicionamiento",
  "Cantidad",
  "Peso",
  "Unidad",
  "Total",
  "Importe",
  "FormaPago",
  "Transportista",
  "CUITTransportista",
  "PatenteChasis",
  "PatenteAcoplado",
];
const commercialHigh = assessExtractionQuality(
  commercialColumns,
  [
    Object.fromEntries(
      commercialColumns.map((column, index) => [column, index % 2 === 0 ? `Valor ${index}` : ""]),
    ),
  ],
  {
    clientProfileId: "mateo",
    documentType: "invoice",
    extractionProfile: "commercial-operations",
  },
);

assert.equal(commercialHigh.quality, "high");

const commercialMediumColumns = [
  "TipoDocumento",
  "Organismo",
  "Numero Documento",
  "Fecha",
  "CUIT Emisor",
  "CUIT Receptor",
  "Producto/Uso",
  "Peso total",
  "Patente",
];
const commercialMedium = assessExtractionQuality(
  commercialMediumColumns,
  [Object.fromEntries(commercialMediumColumns.map((column) => [column, "Dato"]))],
  {
    documentType: "invoice",
  },
);

assert.equal(commercialMedium.quality, "medium");

const low = assessExtractionQuality(
  ["Pagina", "Linea", "Texto"],
  Array.from({ length: 100 }, (_, index) => ({
    Pagina: "1",
    Linea: String(index + 1),
    Texto: `Contenido extraido ${index + 1}`,
  })),
);

assert.equal(low.quality, "low");

const tableHigh = assessExtractionQuality(
  ["N Anexo", "Nombre Anexo", "Romano", "N Punto", "Frecuencia", "Tipo de Plazo", "Cant Dias"],
  Array.from({ length: 24 }, (_, index) => ({
    "N Anexo": String(index + 1),
    "Nombre Anexo": "Obligaciones Formales",
    Romano: "I",
    "N Punto": "1",
    Frecuencia: "Permanente",
    "Tipo de Plazo": "Permanente",
    "Cant Dias": "",
  })),
  {
    documentType: "table",
  },
);

assert.equal(tableHigh.quality, "high");

const logisticsMovementColumns = [
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
const logisticsMovementHigh = assessExtractionQuality(
  logisticsMovementColumns,
  [
    {
      FechaSalida: "01/06/2026",
      CantidadCamion: "1",
      Unidad: "Camion",
      Tons: "28",
      Proveedor: "Proveedor SA",
      Producto: "Cal",
      Origen: "Origen",
      RutaCaminosPuna: "Ruta Caminos Puna",
      Destino: "Destino",
      FechaArribo: "02/06/2026",
      CantidadEscoltas: "No",
    },
  ],
  {
    clientProfileId: "movimiento",
    documentType: "table",
    extractionProfile: "vision-table",
  },
);

assert.equal(logisticsMovementHigh.quality, "high");

const movimientoProfile = getClientProfileById("movimiento");
const movementCsv = [
  logisticsMovementColumns.map((column) => `"${column}"`).join(","),
  logisticsMovementColumns
    .map((column) =>
      `"${{
        FechaSalida: "01/06/2026",
        CantidadCamion: "1",
        Unidad: "Camion",
        Tons: "28",
        Proveedor: "Proveedor SA",
        Producto: "Cal",
        Origen: "Origen",
        RutaCaminosPuna: "Ruta Caminos Puna",
        Destino: "Destino",
        FechaArribo: "02/06/2026",
        CantidadEscoltas: "No",
      }[column] ?? ""}"`,
    )
    .join(","),
].join("\n");
const movementGate = assessOCRQuality(
  {
    csvContent: movementCsv,
    extractedRows: 1,
    fileName: "ADALO_OCR_MOVIMIENTO.csv",
    modelUsed: "test",
    resultQuality: "ai",
  },
  movimientoProfile,
);

assert.equal(movementGate.acceptable, true);
assert.equal(movementGate.qualityStatus, "completed");

const genericGate = assessOCRQuality(
  {
    csvContent: '"Pagina","Linea","Texto"\n"1","1","Escaneado con CamScanner https://v3.camscanner.com"',
    extractedRows: 1,
    fileName: "ADALO_OCR_MOVIMIENTO.csv",
    modelUsed: "test",
    resultQuality: "local-fallback",
  },
  movimientoProfile,
);

assert.equal(genericGate.acceptable, false);
assert.equal(genericGate.shouldFallback, true);

const structuredDocument = assessExtractionQuality(
  [
    "Seccion",
    "Categoria",
    "Dato",
    "Valor",
    "Detalle",
    "Fecha",
    "Expediente/Resolucion",
    "Empresa/Proyecto",
    "Ubicacion",
    "Observacion",
  ],
  Array.from({ length: 20 }, (_, index) => ({
    Seccion: "Datos generales",
    Categoria: "Dato",
    Dato: `Campo ${index + 1}`,
    Valor: `Valor ${index + 1}`,
    Detalle: "",
    Fecha: "",
    "Expediente/Resolucion": "",
    "Empresa/Proyecto": "ERAMINE",
    Ubicacion: "",
    Observacion: "",
  })),
  {
    documentType: "report",
  },
);

assert.equal(structuredDocument.quality, "high");

const personnelProfile = getClientProfileById("internal-nomina-personal");
const personnelGate = assessOCRQuality(
  {
    csvContent: [
      '"Numero","NombreApellido","CUIL","LugarTrabajo","Localidad","Provincia"',
      '"1","Ana Perez","27-12345678-5","Planta","Campo Quijano","Salta"',
    ].join("\n"),
    extractedRows: 1,
    fileName: "ADALO_OCR_LISTADO.csv",
    modelUsed: "test",
    resultQuality: "ai",
  },
  personnelProfile,
);

assert.equal(personnelGate.acceptable, true);
assert.equal(personnelGate.reason, "Personnel roster quality gate passed");

const personnelGenericGate = assessOCRQuality(
  {
    csvContent: '"Pagina","Linea","Texto"\n"1","1","27-12345678-5 Ana Perez"',
    extractedRows: 1,
    fileName: "generic.csv",
    modelUsed: "test",
    resultQuality: "local-fallback",
  },
  personnelProfile,
);

assert.equal(personnelGenericGate.acceptable, false);
assert.equal(personnelGenericGate.shouldFallback, true);

const companyPersonnelProfile = getClientProfileById(
  "internal-personal-empresa-localidad",
);
const companyPersonnelRows = Array.from({ length: 10 }, (_, index) => ({
  Empresa: "AGV FALCON DRILLING S.R.L",
  CUIT: "30-71235052-7",
  NombreApellido: [
    "FLORES CLAUDIO",
    "PEREZ MARIA",
    "GOMEZ JUAN",
    "RODRIGUEZ ANA",
    "DIAZ PEDRO",
    "SUAREZ LAURA",
    "MAMANI OSCAR",
    "LOPEZ CARLA",
    "FERNANDEZ DIEGO",
    "SOSA JULIETA",
  ][index],
  DNI: String(20000000 + index),
  Provincia: "Salta",
  Localidad: "Chicoana",
}));
const companyPersonnelCsv = [
  '"Empresa","CUIT","NombreApellido","DNI","Provincia","Localidad"',
  ...companyPersonnelRows.map((row) =>
    [
      row.Empresa,
      row.CUIT,
      row.NombreApellido,
      row.DNI,
      row.Provincia,
      row.Localidad,
    ]
      .map((value) => `"${value}"`)
      .join(","),
  ),
].join("\n");
const companyPersonnelGate = assessOCRQuality(
  {
    csvContent: companyPersonnelCsv,
    extractedRows: companyPersonnelRows.length,
    fileName: "ADALO_OCR_PERSONAL_EMPRESA.csv",
    modelUsed: "openai visual fallback",
    providerConfidence: 0.41,
    resultQuality: "ai",
  },
  companyPersonnelProfile,
);

assert.equal(companyPersonnelGate.acceptable, true);
assert.equal(
  companyPersonnelGate.reason,
  "Company personnel pattern quality gate passed",
);
assert.ok(companyPersonnelGate.confidence >= 0.6);

const recoveredSupplierColumns = [
  "Nombre empresa",
  "Proveedor",
  "CUIT",
  "Servicio/Área",
  "Provincia",
  "Zona de radicación",
  "Fecha/Periodo de contratación",
  "Modalidad de contratación",
];
const recoveredSupplierRows = Array.from({ length: 5 }, (_, index) => [
  `Empresa ${index + 1}`,
  `Proveedor ${index + 1}`,
  `20-3803622${index}-${index}`,
  "Transporte",
  "Salta",
  "Salar de Pocitos",
  "01.12.25",
  "Periodica",
]);
const recoveredSupplierGate = assessOCRQuality({
  csvContent: [
    recoveredSupplierColumns.map((value) => `"${value}"`).join(","),
    ...recoveredSupplierRows.map((row) =>
      row.map((value) => `"${value}"`).join(","),
    ),
  ].join("\n"),
  extractedRows: recoveredSupplierRows.length,
  fileName: "ADALO_OCR_PROVEEDORES.csv",
  modelUsed: "google-document-ai + openai",
  providerConfidence: 0.65,
  qualityStatus: "accepted_with_warnings",
  resultQuality: "partial",
  warnings: ["Tabla reconstruida desde texto/layout."],
});

assert.equal(recoveredSupplierGate.acceptable, true);
assert.equal(
  recoveredSupplierGate.qualityStatus,
  "accepted_with_warnings",
);
assert.equal(recoveredSupplierGate.confidence, 0.65);

console.log("quality-assessment tests passed");
