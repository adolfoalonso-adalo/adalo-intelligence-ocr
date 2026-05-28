const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
] as const;

const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

export function getMaxPdfSizeMb() {
  const parsed = Number(process.env.MAX_PDF_SIZE_MB || process.env.MAX_FILE_SIZE_MB || "50");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

export function getMaxFileSizeMb() {
  const parsed = Number(process.env.MAX_FILE_SIZE_MB || process.env.MAX_PDF_SIZE_MB || "50");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

export function getMaxImageSizeMb() {
  const parsed = Number(process.env.MAX_IMAGE_SIZE_MB || "20");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

export function getMaxPdfSizeBytes() {
  return getMaxPdfSizeMb() * 1024 * 1024;
}

export function getMaxFileSizeBytes() {
  return getMaxFileSizeMb() * 1024 * 1024;
}

export function getMaxImageSizeBytes() {
  return getMaxImageSizeMb() * 1024 * 1024;
}

export function getMaxSizeMbForMimeType(mimeType: string) {
  if (mimeType === "application/pdf") return Math.min(getMaxFileSizeMb(), getMaxPdfSizeMb());
  if (mimeType === "image/jpeg" || mimeType === "image/png") {
    return Math.min(getMaxFileSizeMb(), getMaxImageSizeMb());
  }

  return getMaxFileSizeMb();
}

export function getMaxSizeBytesForMimeType(mimeType: string) {
  return getMaxSizeMbForMimeType(mimeType) * 1024 * 1024;
}

export function getFileSizeLimitMessage(mimeType: string) {
  if (mimeType === "application/pdf") {
    return `Los PDFs admiten hasta ${getMaxSizeMbForMimeType(mimeType)} MB. Proba dividir el documento en partes.`;
  }

  if (mimeType === "image/jpeg" || mimeType === "image/png") {
    return `Las imagenes admiten hasta ${getMaxSizeMbForMimeType(mimeType)} MB. Proba comprimirla o tomar una foto mas liviana.`;
  }

  return `El limite por documento es ${getMaxFileSizeMb()} MB. Proba comprimirlo o dividirlo en partes.`;
}

export function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isAllowedOcrFile(file: File) {
  return Boolean(getSupportedMimeType(file));
}

export function getSupportedMimeType(file: File) {
  const mimeType = normalizeMimeType(file.type);

  if (ALLOWED_FILE_TYPES.includes(mimeType as (typeof ALLOWED_FILE_TYPES)[number])) {
    return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  }

  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
  if (lowerName.endsWith(".png")) return "image/png";

  return "";
}

export function getDetectedFileLabel(file: File) {
  const mimeType = getSupportedMimeType(file);

  if (mimeType === "application/pdf") return "PDF detectado";
  if (mimeType === "image/jpeg" || mimeType === "image/png") return "Imagen detectada";

  return "Archivo detectado";
}

export function getAcceptedFileExtensionsLabel() {
  return "PDF, JPG, JPEG o PNG";
}

export function getAcceptedFileInputValue() {
  return [...ALLOWED_FILE_TYPES, ...ALLOWED_EXTENSIONS].join(",");
}

function normalizeMimeType(mimeType: string) {
  return mimeType.trim().toLowerCase();
}
