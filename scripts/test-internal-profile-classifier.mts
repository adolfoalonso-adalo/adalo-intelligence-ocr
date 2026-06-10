import assert from "node:assert/strict";
import { getClientProfileById } from "../lib/client-profiles.ts";
import { classifyInternalOCRProfile } from "../lib/internal-profile-classifier.ts";
import { OCRProfileRestrictionError } from "../lib/profile-restrictions.ts";

const companyPersonnelText = `
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
`;

const personnel = classifyInternalOCRProfile({
  text: "NOMINA DEL PERSONAL NOMBRE Y APELLIDO CUIL LUGAR DE TRABAJO LOCALIDAD PROVINCIA",
});
assert.equal(personnel.profile.id, "internal-nomina-personal");

const companyPersonnel = classifyInternalOCRProfile({
  text: companyPersonnelText,
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

const automaticWithLegacyMovementPreference = classifyInternalOCRProfile({
  configuredProfile: getClientProfileById("movimiento"),
  restriction: {
    allowedProfiles: [],
    mode: "automatic",
  },
  text: companyPersonnelText,
});
assert.equal(
  automaticWithLegacyMovementPreference.profile.id,
  "internal-personal-empresa-localidad",
);
assert.equal(
  automaticWithLegacyMovementPreference.detectedProfileBeforeRestriction.id,
  "internal-personal-empresa-localidad",
);

const automaticWithoutLegacyPreference = classifyInternalOCRProfile({
  restriction: {
    allowedProfiles: [],
    mode: "automatic",
  },
  text: "",
});
assert.equal(automaticWithoutLegacyPreference.profile.id, "internal-general");

const allowedProfiles = classifyInternalOCRProfile({
  configuredProfile: getClientProfileById("movimiento"),
  restriction: {
    allowedProfiles: [
      "internal-personal-empresa-localidad",
      "internal-movimiento-camiones",
    ],
    mode: "allowed_profiles",
  },
  text: companyPersonnelText,
});
assert.equal(allowedProfiles.profile.id, "internal-personal-empresa-localidad");
assert.equal(allowedProfiles.restrictionMode, "allowed_profiles");

const forcedMovement = classifyInternalOCRProfile({
  restriction: {
    allowedProfiles: [],
    forcedProfile: "internal-movimiento-camiones",
    mode: "forced_profile",
  },
  text: companyPersonnelText,
});
assert.equal(
  forcedMovement.detectedProfileBeforeRestriction.id,
  "internal-personal-empresa-localidad",
);
assert.equal(forcedMovement.profile.id, "internal-movimiento-camiones");
assert.equal(forcedMovement.restrictionMode, "forced_profile");

assert.throws(
  () =>
    classifyInternalOCRProfile({
      restriction: {
        allowedProfiles: ["internal-movimiento-camiones"],
        mode: "allowed_profiles",
      },
      text: companyPersonnelText,
    }),
  OCRProfileRestrictionError,
);

const general = classifyInternalOCRProfile({ text: "Texto narrativo sin estructura detectable" });
assert.equal(general.profile.id, "internal-general");

console.log("internal profile classifier tests passed");
