import type { ClientProfile } from "@/lib/client-profiles";
import { extractPdfTextByPages } from "@/lib/pdf-text";

export type DocumentPreprocessingResult = {
  documentKind: "digital_pdf" | "scanned_pdf" | "image" | "unknown";
  hasReliableDigitalText: boolean;
  hasTableSignals: boolean;
  ignoredTextDetected: string[];
  pagesProcessed: number;
  rotationDetected: boolean;
  scannedTextWarning: boolean;
  warnings: string[];
};

export async function analyzeDocumentForOcr(input: {
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  profile?: ClientProfile;
}): Promise<DocumentPreprocessingResult> {
  if (input.mimeType === "image/jpeg" || input.mimeType === "image/png") {
    return {
      documentKind: "image",
      hasReliableDigitalText: false,
      hasTableSignals: true,
      ignoredTextDetected: [],
      pagesProcessed: 1,
      rotationDetected: false,
      scannedTextWarning: false,
      warnings: ["Imagen preparada para OCR visual; la orientación EXIF se corrige durante la optimización."],
    };
  }

  if (input.mimeType !== "application/pdf") {
    return {
      documentKind: "unknown",
      hasReliableDigitalText: false,
      hasTableSignals: false,
      ignoredTextDetected: [],
      pagesProcessed: 0,
      rotationDetected: false,
      scannedTextWarning: false,
      warnings: ["Tipo de archivo no reconocido para preprocesamiento documental."],
    };
  }

  try {
    const extraction = await extractPdfTextByPages(input.fileBuffer);
    const fullText = extraction.pages.map((page) => page.text).join("\n");
    const ignoredTextDetected = findIgnoredText(fullText, input.profile);
    const hasReliableDigitalText = isReliablePdfText(fullText, input.profile);
    const hasTableSignals = detectsTableSignals(fullText, input.profile);
    const scannedTextWarning = !hasReliableDigitalText || ignoredTextDetected.length > 0;

    return {
      documentKind: hasReliableDigitalText ? "digital_pdf" : "scanned_pdf",
      hasReliableDigitalText,
      hasTableSignals,
      ignoredTextDetected,
      pagesProcessed: extraction.pages.length,
      rotationDetected: false,
      scannedTextWarning,
      warnings: [
        ...(!hasReliableDigitalText
          ? ["El PDF no tiene texto digital confiable; se prioriza OCR visual cuando el perfil lo requiere."]
          : []),
        ...(ignoredTextDetected.length > 0
          ? [`Se detectaron marcas a ignorar: ${ignoredTextDetected.join(", ")}.`]
          : []),
        ...(!hasTableSignals && input.profile?.expectedColumns
          ? ["No se detectaron encabezados de tabla confiables en el texto local."]
          : []),
      ],
    };
  } catch (error) {
    console.warn("[OCR] document preprocessing failed", {
      fileName: input.fileName,
      mimeType: input.mimeType,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 180) : String(error ?? ""),
    });

    return {
      documentKind: "scanned_pdf",
      hasReliableDigitalText: false,
      hasTableSignals: false,
      ignoredTextDetected: [],
      pagesProcessed: 0,
      rotationDetected: false,
      scannedTextWarning: true,
      warnings: ["No se pudo leer texto local confiable del PDF; se trata como documento escaneado."],
    };
  }
}

function isReliablePdfText(text: string, profile?: ClientProfile) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 500) return false;
  if (findIgnoredText(normalized, profile).length > 0) return false;

  const lettersAndNumbers = normalized.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/g)?.length ?? 0;
  const corrupted = normalized.match(/[�ÂÃ]/g)?.length ?? 0;
  const semanticDensity = lettersAndNumbers / Math.max(normalized.length, 1);

  return semanticDensity >= 0.45 && corrupted / Math.max(normalized.length, 1) < 0.02;
}

function detectsTableSignals(text: string, profile?: ClientProfile) {
  const normalized = normalizeSearchText(text);
  const expectedMatches =
    profile?.expectedColumns?.filter((column) => normalized.includes(normalizeSearchText(column))).length ?? 0;

  if (expectedMatches >= 4) return true;

  const genericTableWords = ["fecha", "proveedor", "producto", "origen", "destino", "cantidad", "tons", "cuit"];
  return genericTableWords.filter((word) => normalized.includes(word)).length >= 4;
}

function findIgnoredText(text: string, profile?: ClientProfile) {
  const normalized = normalizeSearchText(text);
  return (profile?.ignoreText ?? []).filter((item) => normalized.includes(normalizeSearchText(item)));
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}
