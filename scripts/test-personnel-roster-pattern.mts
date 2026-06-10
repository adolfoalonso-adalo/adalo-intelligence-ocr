import assert from "node:assert/strict";

import {
  assessPersonnelRosterRows,
  calculatePersonnelRosterMetrics,
  extractPersonnelRosterByPattern,
  PERSONNEL_ROSTER_COLUMNS,
} from "@/lib/personnel-roster-pattern";

const ocrFragment = `
NÓMINA DEL PERSONAL
NOMBRE Y APELLIDO
CUIL
LUGAR DE TRABAJO
LOCALIDAD
PROVINCIA
1
JUAN CARLOS PEREZ
20123456789
CAMPAMENTO MARIANA
OD Campo Quljano
Satta
Escaneado con CamScanner
2 MARIA ELENA GOMEZ 27123456780
OFICINA/PROYECTOS
00 General Mosconl
JWUY
3
PEDRO LUIS SUAREZ
23123456789
CAMPAMENTO MARIANA
D Comodoro Rivadavla
CHUBUT
`;

const result = extractPersonnelRosterByPattern(ocrFragment);

assert.deepEqual([...PERSONNEL_ROSTER_COLUMNS], [
  "Numero",
  "NombreApellido",
  "CUIL",
  "LugarTrabajo",
  "Localidad",
  "Provincia",
]);
assert.equal(result.acceptable, true);
assert.equal(result.detectedCuils, 3);
assert.equal(result.validRows, 3);
assert.equal(result.rows[0]?.Localidad, "Campo Quijano");
assert.equal(result.rows[0]?.Provincia, "Salta");
assert.equal(result.rows[1]?.Localidad, "General Mosconi");
assert.equal(result.rows[1]?.Provincia, "Jujuy");
assert.equal(result.rows[2]?.Localidad, "Comodoro Rivadavia");
assert.equal(result.rows[2]?.Provincia, "Chubut");
assert.equal(result.metrics.totalRegistros, 3);
assert.equal(result.metrics.filasConNombre, 3);
assert.equal(result.metrics.filasConCUIL, 3);
assert.equal(result.metrics.filasConLugarTrabajo, 3);
assert.equal(result.metrics.filasConLocalidad, 3);
assert.equal(result.metrics.filasConProvincia, 3);
assert.equal(result.metrics.porcentajeCompletitud, 100);

const displacedFragment = `
1
PERSONA ANTERIOR
20111111111
CAMPAMENTO MARIANA
Mendoza
Mendoza
2
LAURA BEATRIZ RODRIGUEZ
27222222222
OFICINA/PROYECTOS
San Juan
San Juan
3
CARLOS ALBERTO DIAZ
23333333333
CAMPAMENTO MARIANA
La Pampa
La Pampa
`;
const displacedResult = extractPersonnelRosterByPattern(displacedFragment);

assert.equal(displacedResult.rows[1]?.NombreApellido, "LAURA BEATRIZ RODRIGUEZ");
assert.equal(displacedResult.rows[1]?.Localidad, "San Juan");
assert.equal(displacedResult.rows[1]?.Provincia, "San Juan");
assert.equal(displacedResult.rows[2]?.NombreApellido, "CARLOS ALBERTO DIAZ");
assert.notEqual(displacedResult.rows[2]?.NombreApellido, "San Juan");

const largeRosterRows = Array.from({ length: 105 }, (_, index) => ({
  Numero: String(index + 1),
  NombreApellido: `Persona Apellido ${index + 1}`,
  CUIL: `20${String(10000000 + index).padStart(8, "0")}1`,
  LugarTrabajo: "CAMPAMENTO MARIANA",
  Localidad: index < 85 ? "Campo Quijano" : "",
  Provincia: index < 85 ? "Salta" : "",
}));
const largeRosterAssessment = assessPersonnelRosterRows(largeRosterRows, 105);

assert.equal(largeRosterAssessment.recognizedProvinceRows, 85);
assert.equal(largeRosterAssessment.acceptable, true);
assert.ok(largeRosterAssessment.qualityScore >= 0.65);

const incompleteMetrics = calculatePersonnelRosterMetrics([
  {
    Numero: "1",
    NombreApellido: "",
    CUIL: "20123456789",
    LugarTrabajo: "CAMPAMENTO MARIANA",
    Localidad: "",
    Provincia: "Salta",
  },
]);

assert.deepEqual(incompleteMetrics, {
  filasConCUIL: 1,
  filasConLocalidad: 0,
  filasConLugarTrabajo: 1,
  filasConNombre: 0,
  filasConProvincia: 1,
  porcentajeCompletitud: 66.7,
  totalRegistros: 1,
});

console.log("personnel-roster-pattern tests passed");
