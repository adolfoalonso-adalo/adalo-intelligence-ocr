import type { DocumentType } from "@/lib/document-type";

export type DocumentDetectionResult = {
  confidence: "low" | "medium" | "high";
  detectedType: DocumentType;
  reason: string;
};

type DetectDocumentTypeInput = {
  fileName: string;
  mimeType: string;
};

const TABLE_KEYWORDS = [
  "contrataciones",
  "lista",
  "listado",
  "nomina",
  "nómina",
  "padron",
  "padrón",
  "planilla",
  "proveedores",
  "registro",
  "tabla",
];

const INVOICE_KEYWORDS = [
  "arca",
  "cadtv",
  "carga",
  "certificado",
  "comprobante",
  "declaracion",
  "declaración",
  "dtve",
  "factura",
  "guia",
  "guía",
  "jurada",
  "movimiento",
  "recibo",
  "remito",
  "senasa",
  "ticket",
  "transporte",
];

const REPORT_KEYWORDS = [
  "antecedentes",
  "descriptivo",
  "expediente",
  "ficha",
  "informe",
  "inspecciones",
  "proyecto",
  "respuesta",
  "resoluciones",
  "resumen",
  "tecnico",
  "técnico",
];

export function detectDocumentTypeFromFileMetadata({
  fileName,
  mimeType,
}: DetectDocumentTypeInput): DocumentDetectionResult {
  const normalizedName = normalizeText(fileName);
  const normalizedMimeType = mimeType.toLowerCase();

  if (hasKeyword(normalizedName, TABLE_KEYWORDS)) {
    return {
      confidence: "high",
      detectedType: "table",
      reason: "El nombre del archivo sugiere una tabla o listado.",
    };
  }

  if (hasKeyword(normalizedName, INVOICE_KEYWORDS)) {
    return {
      confidence: "high",
      detectedType: "invoice",
      reason: "El nombre del archivo sugiere un documento comercial u operativo.",
    };
  }

  if (hasKeyword(normalizedName, REPORT_KEYWORDS)) {
    return {
      confidence: "medium",
      detectedType: "report",
      reason: "El nombre del archivo sugiere un documento tecnico o administrativo.",
    };
  }

  return {
    confidence: normalizedMimeType.includes("image") ? "low" : "low",
    detectedType: "auto",
    reason: "No se detectaron señales claras en el nombre del archivo.",
  };
}

function hasKeyword(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(normalizeText(keyword)));
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
