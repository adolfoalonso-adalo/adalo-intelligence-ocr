import {
  getClientProfileById,
  type ClientProfile,
} from "@/lib/client-profiles";
import {
  applyProfileRestriction,
  type OCRProfileRestriction,
  type ProfileRestrictionMode,
} from "@/lib/profile-restrictions";

export type InternalProfileClassification = {
  allowedProfiles: string[];
  confidence: "low" | "medium" | "high";
  detectedProfileBeforeRestriction: ClientProfile;
  forcedProfile?: string;
  profile: ClientProfile;
  reason: string;
  restrictionMode: ProfileRestrictionMode;
  restrictionReason: string;
};

export function classifyInternalOCRProfile(input: {
  configuredProfile?: ClientProfile;
  fileName?: string;
  hasTableSignals?: boolean;
  restriction?: OCRProfileRestriction;
  text?: string;
}): InternalProfileClassification {
  const searchable = normalizeSearchText(`${input.fileName ?? ""}\n${input.text ?? ""}`);
  const configuredProfile = input.configuredProfile;
  const finish = (
    profileId: string,
    reason: string,
    confidence: InternalProfileClassification["confidence"],
  ) =>
    classification(profileId, reason, confidence, input.restriction);
  const companyMatches =
    searchable.match(
      /\b(?:s r l|s a|sociedad anonima|sociedad de responsabilidad limitada)\b/g,
    )?.length ?? 0;
  const cuitMatches =
    `${input.fileName ?? ""}\n${input.text ?? ""}`.match(
      /\b\d{2}-\d{8}-\d\b/g,
    )?.length ?? 0;
  const textWithoutCuits = `${input.fileName ?? ""}\n${input.text ?? ""}`.replace(
    /\b\d{2}-\d{8}-\d\b/g,
    " ",
  );
  const dniMatches = textWithoutCuits.match(/\b\d{7,8}\b/g)?.length ?? 0;
  const locationSignals = countSignals(searchable, [
    "provincia",
    "localidad",
    "salta",
    "jujuy",
    "catamarca",
    "mendoza",
    "chicoana",
  ]);

  if (
    companyMatches >= 1 &&
    cuitMatches >= 1 &&
    dniMatches >= 2 &&
    locationSignals >= 1
  ) {
    return finish(
      "internal-personal-empresa-localidad",
      "Coinciden empresas, CUIT, DNI y ubicaciones de un listado de personal.",
      dniMatches >= 10 ? "high" : "medium",
    );
  }

  const personnelSignals = countSignals(searchable, [
    "nomina del personal",
    "nombre y apellido",
    "cuil",
    "lugar de trabajo",
    "localidad",
    "provincia",
  ]);
  const detectedCuils = searchable.match(/\b\d{2}[- ]?\d{7,8}[- ]?\d\b/g)?.length ?? 0;

  if (personnelSignals >= 4 || (personnelSignals >= 2 && detectedCuils >= 5) || detectedCuils > 100) {
    return finish(
      "internal-nomina-personal",
      detectedCuils > 100 ? "Se detectaron mas de 100 CUIL." : "Coinciden encabezados de nomina de personal.",
      personnelSignals >= 5 || detectedCuils > 100 ? "high" : "medium",
    );
  }

  const movementSignals = countSignals(searchable, [
    "fechasalida",
    "cantidadcamion",
    "proveedor",
    "producto",
    "origen",
    "destino",
    "fechaarribo",
  ]);

  if (movementSignals >= 5) {
    return finish(
      "internal-movimiento-camiones",
      "Coinciden campos de movimiento logistico.",
      movementSignals >= 6 ? "high" : "medium",
    );
  }

  const dtveSignals = countSignals(searchable, [
    "dtv",
    "dtve",
    "senasa",
    "arca",
    "cuve",
    "cadtv",
    "patente",
    "transportista",
  ]);

  if (dtveSignals >= 3) {
    return finish(
      "internal-dtve-senasa-arca",
      "Coinciden campos de documentacion DTVe, SENASA o ARCA.",
      dtveSignals >= 5 ? "high" : "medium",
    );
  }

  const commercialSignals = countSignals(searchable, [
    "factura",
    "ticket",
    "recibo",
    "comprobante",
    "remito",
    "importe",
    "total",
    "forma de pago",
  ]);

  if (commercialSignals >= 2) {
    return finish(
      "internal-comprobante-generico",
      "Coinciden campos de un comprobante comercial.",
      commercialSignals >= 4 ? "high" : "medium",
    );
  }

  const technicalSignals = countSignals(searchable, [
    "informe",
    "resumen",
    "expediente",
    "resolucion",
    "proyecto",
    "antecedentes",
    "inspeccion",
    "documentacion administrativa",
  ]);

  if (technicalSignals >= 2) {
    return finish(
      "internal-documento-tecnico-administrativo",
      "Coinciden secciones de documentacion tecnico-administrativa.",
      technicalSignals >= 4 ? "high" : "medium",
    );
  }

  if (configuredProfile && configuredProfile.defaultExtractionProfile !== "general") {
    return finish(
      configuredProfile.id,
      "Se uso el perfil preferido heredado porque no hubo senales documentales concluyentes.",
      "medium",
    );
  }

  if (input.hasTableSignals || detectsGenericTable(searchable)) {
    return finish(
      "internal-tabla-administrativa",
      "Se detectaron encabezados o patrones tabulares.",
      "medium",
    );
  }

  return finish(
    "internal-general",
    "No se detecto un perfil documental especifico.",
    "low",
  );
}

function classification(
  profileId: string,
  reason: string,
  confidence: InternalProfileClassification["confidence"],
  restriction?: OCRProfileRestriction,
): InternalProfileClassification {
  const detectedProfile = getClientProfileById(profileId);
  const decision = applyProfileRestriction(detectedProfile, restriction);

  return {
    allowedProfiles: decision.allowedProfiles,
    confidence,
    detectedProfileBeforeRestriction: decision.detectedProfileBeforeRestriction,
    forcedProfile: decision.forcedProfile,
    profile: decision.finalProfile,
    reason,
    restrictionMode: decision.restrictionMode,
    restrictionReason: decision.restrictionReason,
  };
}

function countSignals(value: string, signals: string[]) {
  return signals.filter((signal) => value.includes(normalizeSearchText(signal))).length;
}

function detectsGenericTable(value: string) {
  const signals = [
    "nro",
    "numero",
    "nombre",
    "fecha",
    "cantidad",
    "descripcion",
    "localidad",
    "provincia",
    "cuit",
    "cuil",
  ];

  return countSignals(value, signals) >= 4;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}
