import { createHmac, timingSafeEqual } from "node:crypto";
import type { DocumentType } from "@/lib/document-type";

export type ExtractionProfile =
  | "commercial-operations"
  | "general"
  | "table-list"
  | "technical-admin";

export type ClientProfile = {
  id: string;
  label: string;
  accessCodeAlias?: string;
  preferredDocumentTypes: string[];
  defaultExtractionProfile: ExtractionProfile;
  csvTemplate?: string;
  promptHint?: string;
};

const PROFILE_COOKIE_NAME = "adalo_ocr_client_profile";

const GENERAL_PROFILE: ClientProfile = {
  id: "general",
  label: "General",
  preferredDocumentTypes: [],
  defaultExtractionProfile: "general",
};

const CLIENT_PROFILES: ClientProfile[] = [
  GENERAL_PROFILE,
  {
    id: "mateo",
    label: "Mateo / Papas",
    accessCodeAlias: process.env.ACCESS_PROFILE_MATEO_CODE_ALIAS || "ADALO-2026-MATEO",
    defaultExtractionProfile: "commercial-operations",
    preferredDocumentTypes: [
      "comprobantes",
      "facturas",
      "tickets",
      "remitos",
      "SENASA",
      "ARCA",
      "DTVe",
      "CADTV",
      "documentos de carga",
      "productos",
      "papa",
      "transporte",
    ],
    csvTemplate: "commercial-operations",
    promptHint: `Actua como un sistema OCR especializado en comprobantes comerciales, remitos, documentos SENASA/ARCA, formularios DTVe/CADTV y documentacion operativa de carga.

Extrae los datos en una estructura util para control comercial, trazabilidad de productos, cantidades, pesos, transporte y facturacion.

Usa preferentemente estas columnas cuando correspondan:
TipoDocumento, Organismo, NumeroDocumento, CUVE, CADTV, FechaEmision, FechaCarga, FechaVencimiento, Motivo, Emisor, CUITEmisor, Receptor, CUITReceptor, DomicilioOrigen, LocalidadOrigen, ProvinciaOrigen, DomicilioDestino, LocalidadDestino, ProvinciaDestino, Producto, Variedad, Acondicionamiento, Cantidad, Peso, Unidad, Total, Importe, FormaPago, Transportista, CUITTransportista, PatenteChasis, PatenteAcoplado, CodigoCierre, Observaciones.

Reglas:
- No inventar datos.
- Preservar CUIT, codigos, patentes y numeros de documento.
- Si hay tabla de detalle de carga, una fila por producto/carga.
- Si el documento corresponde a una unica operacion o comprobante, devolve una unica fila consolidada con todas las columnas disponibles.
- Si hay tabla de detalle de carga con multiples productos, devolve una fila por producto, repitiendo los datos generales del documento.
- No generes filas artificiales por cada campo si corresponde una unica operacion.
- Para tickets simples, una fila consolidada es aceptable.
- Para remitos, SENASA o ARCA, una fila por carga/producto es aceptable.
- Para listas de proveedores, una fila por proveedor.
- Si un dato no aparece, dejar vacio.
- Si hay datos generales y una unica carga, repetir los datos generales en la fila de carga.
- Responder JSON valido con columns y rows.`,
  },
];

export function getClientProfileById(profileId?: string | null): ClientProfile {
  return CLIENT_PROFILES.find((profile) => profile.id === profileId) ?? GENERAL_PROFILE;
}

export function resolveClientProfileForAccessCode(code: string): ClientProfile {
  const normalizedCode = normalizeAccessCodeAlias(code);

  return (
    CLIENT_PROFILES.find(
      (profile) =>
        profile.accessCodeAlias &&
        safeCompare(normalizedCode, normalizeAccessCodeAlias(profile.accessCodeAlias)),
    ) ?? GENERAL_PROFILE
  );
}

export function createClientProfileCookie(profileId: string): string {
  const safeProfileId = getClientProfileById(profileId).id;
  const signature = signProfileId(safeProfileId);

  return `${safeProfileId}.${signature}`;
}

export function verifyClientProfileCookie(cookieValue?: string): ClientProfile {
  if (!cookieValue) return GENERAL_PROFILE;

  const [profileId, signature] = cookieValue.split(".");

  if (!profileId || !signature) return GENERAL_PROFILE;

  if (!safeCompare(signature, signProfileId(profileId))) return GENERAL_PROFILE;

  return getClientProfileById(profileId);
}

export function getClientProfileCookieName() {
  return process.env.ACCESS_PROFILE_COOKIE_NAME || PROFILE_COOKIE_NAME;
}

export function resolveDocumentTypeForProfile(
  detectedDocumentType: DocumentType,
  profile: ClientProfile,
): DocumentType {
  if (detectedDocumentType !== "auto") {
    return detectedDocumentType;
  }

  if (profile.defaultExtractionProfile === "commercial-operations") {
    return "invoice";
  }

  if (profile.defaultExtractionProfile === "table-list") {
    return "table";
  }

  if (profile.defaultExtractionProfile === "technical-admin") {
    return "report";
  }

  return "auto";
}

function normalizeAccessCodeAlias(code: string) {
  return code.trim().toUpperCase();
}

function signProfileId(profileId: string) {
  return createHmac("sha256", getCookieSecret()).update(profileId).digest("hex");
}

function getCookieSecret() {
  const secret = process.env.ACCESS_COOKIE_SECRET || process.env.AUTH_SECRET;

  if (secret) return secret;

  if (process.env.NODE_ENV !== "production") {
    return "adalo-intelligence-ocr-profile-dev-secret";
  }

  throw new Error("ACCESS_COOKIE_SECRET or AUTH_SECRET must be configured in production.");
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
