import assert from "node:assert/strict";
import { getClientProfileById } from "../lib/client-profiles.ts";
import { assessOCRQuality } from "../lib/ocr-quality.ts";
import { recordsToCsv } from "../lib/structured-output.ts";

const profile = getClientProfileById("movimiento");
const columns = [
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
const validCsv = recordsToCsv(columns, [
  {
    FechaSalida: "01/06/2026",
    CantidadCamion: "1",
    Unidad: "Camion",
    Tons: "28",
    Proveedor: "Proveedor SA",
    Producto: "Litio",
    Origen: "Origen",
    RutaCaminosPuna: "Ruta",
    Destino: "Destino",
    FechaArribo: "02/06/2026",
    CantidadEscoltas: "No",
  },
]);

const valid = assessOCRQuality(
  {
    csvContent: validCsv,
    extractedRows: 1,
    fileName: "ADALO_OCR_MOVIMIENTO.csv",
    modelUsed: "test",
    resultQuality: "ai",
  },
  profile,
);

assert.equal(valid.acceptable, true);
assert.equal(valid.qualityStatus, "completed");

const generic = assessOCRQuality(
  {
    csvContent: recordsToCsv(["Pagina", "Linea", "Texto"], [{ Pagina: "1", Linea: "1", Texto: "fila" }]),
    extractedRows: 1,
    fileName: "generic.csv",
    modelUsed: "test",
    resultQuality: "local-fallback",
  },
  profile,
);

assert.equal(generic.acceptable, false);
assert.equal(generic.shouldFallback, true);

const camscanner = assessOCRQuality(
  {
    csvContent: recordsToCsv(columns, [
      {
        FechaSalida: "01/06/2026",
        CantidadCamion: "1",
        Unidad: "Camion",
        Tons: "28",
        Proveedor: "https://v3.camscanner.com",
        Producto: "Litio",
        Origen: "Origen",
        RutaCaminosPuna: "Ruta",
        Destino: "Destino",
        FechaArribo: "02/06/2026",
        CantidadEscoltas: "No",
      },
    ]),
    extractedRows: 1,
    fileName: "camscanner.csv",
    modelUsed: "test",
    resultQuality: "ai",
  },
  profile,
);

assert.equal(camscanner.acceptable, false);
assert.equal(camscanner.shouldFallback, true);

const incomplete = assessOCRQuality(
  {
    csvContent: recordsToCsv(columns.slice(0, -2), [
      {
        FechaSalida: "01/06/2026",
        CantidadCamion: "1",
        Unidad: "Camion",
        Tons: "28",
        Proveedor: "Proveedor SA",
        Producto: "Litio",
        Origen: "Origen",
        RutaCaminosPuna: "Ruta",
        Destino: "Destino",
      },
    ]),
    extractedRows: 1,
    fileName: "incomplete.csv",
    modelUsed: "test",
    resultQuality: "ai",
  },
  profile,
);

assert.equal(incomplete.acceptable, false);
assert.equal(incomplete.shouldFallback, true);

console.log("movimiento-quality-gate tests passed");
