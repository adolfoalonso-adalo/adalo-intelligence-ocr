import assert from "node:assert/strict";
import { getClientProfileById } from "../lib/client-profiles.ts";
import { classifyInternalOCRProfile } from "../lib/internal-profile-classifier.ts";

const personnel = classifyInternalOCRProfile({
  text: "NOMINA DEL PERSONAL NOMBRE Y APELLIDO CUIL LUGAR DE TRABAJO LOCALIDAD PROVINCIA",
});
assert.equal(personnel.profile.id, "internal-nomina-personal");

const companyPersonnel = classifyInternalOCRProfile({
  text: `
AGV FALCON DRILLING S.R.L
30-71235052-7
FLORES, CLAUDIO GONZALO
28695666
Salta
CHICOANA
PEREZ, MARIA ELENA
30111222
Salta
CERRILLOS
`,
});
assert.equal(
  companyPersonnel.profile.id,
  "internal-personal-empresa-localidad",
);

const movement = classifyInternalOCRProfile({
  text: "FechaSalida CantidadCamion Proveedor Producto Origen Destino FechaArribo",
});
assert.equal(movement.profile.id, "internal-movimiento-camiones");

const dtve = classifyInternalOCRProfile({
  text: "DTVe SENASA CUVE CADTV Patente Transportista",
});
assert.equal(dtve.profile.id, "internal-dtve-senasa-arca");

const table = classifyInternalOCRProfile({
  hasTableSignals: true,
  text: "Numero Nombre Fecha Cantidad Descripcion",
});
assert.equal(table.profile.id, "internal-tabla-administrativa");

const restricted = classifyInternalOCRProfile({
  configuredProfile: getClientProfileById("mateo"),
  text: "Documento sin señales claras",
});
assert.equal(restricted.profile.id, "internal-dtve-senasa-arca");

const general = classifyInternalOCRProfile({ text: "Texto narrativo sin estructura detectable" });
assert.equal(general.profile.id, "internal-general");

console.log("internal profile classifier tests passed");
