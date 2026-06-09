import { createHmac, timingSafeEqual } from "node:crypto";
import type { DocumentType } from "@/lib/document-type";

export type ExtractionProfile =
  | "commercial-operations"
  | "general"
  | "table-list"
  | "technical-admin"
  | "vision-table";

export type ExtractionMode =
  | "auto"
  | "direct_file"
  | "text_chunks"
  | "vision_table";

export type ClientProfile = {
  id: string;
  code?: string;
  label: string;
  accessCodeAlias?: string;
  documentType?: string;
  extractionMode?: ExtractionMode;
  expectedColumns?: readonly string[];
  ignoreText?: readonly string[];
  preferredDocumentTypes: string[];
  defaultExtractionProfile: ExtractionProfile;
  validationRules?: {
    allowEmptyCells?: boolean;
    rejectGenericLineCsv?: boolean;
    requireTableStructure?: boolean;
    requiredColumns?: readonly string[];
  };
  csvTemplate?: string;
  promptHint?: string;
  userFacingExtractionType?: string;
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
    id: "technical-admin",
    label: "Documento tecnico-administrativo",
    defaultExtractionProfile: "technical-admin",
    extractionMode: "text_chunks",
    preferredDocumentTypes: [
      "informes",
      "resumenes",
      "expedientes",
      "fichas de proyecto",
      "documentacion administrativa",
    ],
    userFacingExtractionType: "Documento tecnico / administrativo",
    promptHint: `Actua como un sistema OCR especializado en documentos tecnico-administrativos, informes, resumenes ejecutivos, expedientes, fichas de proyecto, antecedentes y resoluciones.

Extrae datos por secciones, fechas, expedientes, resoluciones, empresas, ubicaciones, indicadores y observaciones. No devuelvas Pagina/Linea/Texto salvo como ultimo fallback local.`,
  },
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
  {
    id: "movimiento",
    code: "ADALO-2026-MOVIMIENTO",
    label: "Tabla de movimientos logisticos",
    accessCodeAlias: process.env.ACCESS_PROFILE_MOVIMIENTO_CODE_ALIAS || "ADALO-2026-MOVIMIENTO",
    documentType: "scanned_logistics_table",
    extractionMode: "vision_table",
    defaultExtractionProfile: "vision-table",
    preferredDocumentTypes: [
      "movimientos logisticos",
      "camiones",
      "logistica minera",
      "tablas escaneadas",
      "CamScanner",
      "rutas",
      "escoltas",
    ],
    expectedColumns: [
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
    ],
    ignoreText: [
      "Escaneado con CamScanner",
      "CamScanner",
      "https://v3.camscanner.com",
      "Secretaría",
      "Secretaria",
      "Folio",
      "Sello",
    ],
    validationRules: {
      allowEmptyCells: true,
      rejectGenericLineCsv: true,
      requireTableStructure: true,
      requiredColumns: [
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
      ],
    },
    csvTemplate: "logistics-movement-table",
    userFacingExtractionType: "OCR visual tabular",
    promptHint: `Actua como un sistema OCR visual tabular especializado en tablas escaneadas de movimientos logisticos de camiones y logistica minera.

Perfil: ADALO-2026-MOVIMIENTO.
Documento esperado: tabla logistica escaneada, incluso si viene de CamScanner, esta inclinada, tiene sombras, sellos, bordes, marcas de agua, paginas rotadas o encabezados repetidos/incompletos.

Tu tarea es reconstruir la tabla completa por filas. Ignora marcas de agua, sellos, folios, bordes, sombras, URLs externas y textos como "Escaneado con CamScanner", "CamScanner" o "https://v3.camscanner.com".

Usa exactamente estas columnas y este orden:
FechaSalida, CantidadCamion, Unidad, Tons, Proveedor, Producto, Origen, RutaCaminosPuna, Destino, FechaArribo, CantidadEscoltas.

Reglas:
- Una fila por cada movimiento logistico visible.
- No mezcles filas.
- No inventes datos.
- Si una celda esta ilegible, parcialmente tapada o dudosa, dejala vacia.
- Normaliza fechas a DD/MM/YYYY cuando sea posible.
- Normaliza CantidadEscoltas como "1", "No" o vacio si no puede determinarse.
- Mantene proveedor, producto, ruta, origen y destino tal como aparecen; corregi solo errores evidentes de OCR si hay alta confianza.
- Manten continuidad entre paginas aunque los encabezados no aparezcan en todas.
- No devuelvas columnas Pagina, Linea, Texto.
- El CSV final debe ser una tabla de movimientos, no una transcripcion linea por linea.
- Responde JSON valido con columns y rows.
- En cada row incluye tambien pageNumber, rowNumber, confidence y warnings para el JSON; esas columnas auxiliares no deben reemplazar las columnas principales.`,
  },
];

export function getClientProfileById(profileId?: string | null): ClientProfile {
  return CLIENT_PROFILES.find((profile) => profile.id === profileId) ?? GENERAL_PROFILE;
}

export function resolveClientProfileForAccessCode(code: string): ClientProfile {
  const normalizedCode = normalizeAccessCodeAlias(code);

  if (isReservedInternalProfileCode(normalizedCode)) {
    return GENERAL_PROFILE;
  }

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

  if (profile.defaultExtractionProfile === "vision-table") {
    return "table";
  }

  return "auto";
}

export function isVisionTableProfile(profile?: ClientProfile | null) {
  return profile?.extractionMode === "vision_table" || profile?.defaultExtractionProfile === "vision-table";
}

export function getClientProfileCode(profile?: ClientProfile | null) {
  return profile?.code || profile?.accessCodeAlias || profile?.id || "general";
}

function normalizeAccessCodeAlias(code: string) {
  return code.trim().toUpperCase();
}

function isReservedInternalProfileCode(code: string) {
  return code === "ADALO-2026-MATEO" || code === "ADALO-2026-MOVIMIENTO";
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
