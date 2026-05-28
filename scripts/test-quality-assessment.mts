import assert from "node:assert/strict";
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

console.log("quality-assessment tests passed");
