import assert from "node:assert/strict";
import {
  COMPANY_PERSONNEL_COLUMNS,
  extractCompanyPersonnelByPattern,
} from "@/lib/company-personnel-pattern";

const people = [
  ["FLORES, CLAUDIO GONZALO", "28695666", "Salta", "CHICOANA"],
  ["PEREZ, MARIA ELENA", "30111222", "Salta", "CERRILLOS"],
  ["GOMEZ, JUAN CARLOS", "27888999", "Jujuy", "PALPALA"],
  ["RODRIGUEZ, ANA LUZ", "33444555", "Salta", "LA MERCED"],
  ["DIAZ, PEDRO ALBERTO", "25666777", "Catamarca", "ANDALGALA"],
  ["SUAREZ, LAURA BEATRIZ", "29888777", "Salta", "ROSARIO DE LERMA"],
  ["MAMANI, OSCAR RAUL", "31555666", "Jujuy", "PERICO"],
  ["LOPEZ, CARLA SOLEDAD", "32777888", "Salta", "GENERAL GUEMES"],
  ["FERNANDEZ, DIEGO MARTIN", "24444333", "Mendoza", "LAS HERAS"],
  ["SOSA, JULIETA ANDREA", "35666777", "Salta", "CHICOANA"],
  ["RAMOS, PABLO EZEQUIEL", "26777111", "Jujuy", "EL CARMEN"],
];
const rawText = [
  "LISTADO DE PERSONAL",
  "AGV FALCON DRILLING S.R.L",
  "30-71235052-7",
  ...people.flat(),
].join("\n");
const result = extractCompanyPersonnelByPattern(rawText);

assert.deepEqual([...COMPANY_PERSONNEL_COLUMNS], [
  "Empresa",
  "CUIT",
  "NombreApellido",
  "DNI",
  "Provincia",
  "Localidad",
]);
assert.equal(result.acceptable, true);
assert.equal(result.rows.length, 11);
assert.equal(result.rows[0]?.Empresa, "AGV FALCON DRILLING S.R.L");
assert.equal(result.rows[0]?.CUIT, "30-71235052-7");
assert.equal(result.rows[0]?.NombreApellido, "FLORES, CLAUDIO GONZALO");
assert.equal(result.rows[0]?.DNI, "28695666");
assert.equal(result.rows[0]?.Provincia, "Salta");
assert.equal(result.rows[0]?.Localidad, "Chicoana");
assert.equal(result.rows[10]?.Empresa, "AGV FALCON DRILLING S.R.L");
assert.equal(result.metrics.empresasDetectadas, 1);
assert.equal(result.metrics.cuitsDetectados, 1);
assert.equal(result.metrics.dnisDetectados, 11);
assert.equal(result.metrics.registrosEstructurados, 11);
assert.ok(result.metrics.porcentajeCompletitud >= 99);

const twoCompanies = extractCompanyPersonnelByPattern(`
EMPRESA UNO S.A.
30-70000000-1
PERSONA UNO
20111222
Salta
CHICOANA
EMPRESA DOS S.R.L.
30-71111111-2
PERSONA DOS
30222333
Jujuy
PERICO
`);

assert.equal(twoCompanies.rows[0]?.Empresa, "EMPRESA UNO S.A.");
assert.equal(twoCompanies.rows[0]?.CUIT, "30-70000000-1");
assert.equal(twoCompanies.rows[1]?.Empresa, "EMPRESA DOS S.R.L.");
assert.equal(twoCompanies.rows[1]?.CUIT, "30-71111111-2");

console.log("company-personnel-pattern tests passed");
