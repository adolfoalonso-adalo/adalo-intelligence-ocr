import {
  getClientProfileById,
  type ClientProfile,
} from "@/lib/client-profiles";

export type InternalProfileClassification = {
  confidence: "low" | "medium" | "high";
  profile: ClientProfile;
  reason: string;
};

export function classifyInternalOCRProfile(input: {
  configuredProfile?: ClientProfile;
  fileName?: string;
  hasTableSignals?: boolean;
  text?: string;
}): InternalProfileClassification {
  const searchable = normalizeSearchText(`${input.fileName ?? ""}\n${input.text ?? ""}`);
  const configuredProfile = input.configuredProfile;

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
    return classification(
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
    return classification(
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
    return classification(
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
    return classification(
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
    return classification(
      "internal-documento-tecnico-administrativo",
      "Coinciden secciones de documentacion tecnico-administrativa.",
      technicalSignals >= 4 ? "high" : "medium",
    );
  }

  if (configuredProfile && configuredProfile.defaultExtractionProfile !== "general") {
    return {
      confidence: "medium",
      profile: configuredProfile,
      reason: "Se aplico la restriccion documental configurada por el administrador.",
    };
  }

  if (input.hasTableSignals || detectsGenericTable(searchable)) {
    return classification(
      "internal-tabla-administrativa",
      "Se detectaron encabezados o patrones tabulares.",
      "medium",
    );
  }

  return classification(
    "internal-general",
    "No se detecto un perfil documental especifico.",
    "low",
  );
}

function classification(
  profileId: string,
  reason: string,
  confidence: InternalProfileClassification["confidence"],
): InternalProfileClassification {
  return {
    confidence,
    profile: getClientProfileById(profileId),
    reason,
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
