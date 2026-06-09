export type ImageOptimizationResult = {
  buffer: Buffer;
  height?: number;
  mimeType: "image/jpeg";
  optimizedSize: number;
  originalSize: number;
  width?: number;
};

export async function prepareImageForOcr(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<ImageOptimizationResult | null> {
  if (!isImageOptimizationEnabled() || !isSupportedImageMimeType(mimeType)) {
    return null;
  }

  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const maxDimension = readPositiveInteger(process.env.OCR_IMAGE_MAX_DIMENSION, 1800);
    const quality = clamp(readPositiveInteger(process.env.OCR_IMAGE_JPEG_QUALITY, 85), 40, 95);
    const contrastNormalizationEnabled = isContrastNormalizationEnabled();
    const pipeline = contrastNormalizationEnabled
      ? sharp(fileBuffer).rotate().normalize()
      : sharp(fileBuffer).rotate();
    const metadata = await pipeline.metadata();
    const shouldResize =
      typeof metadata.width === "number" &&
      typeof metadata.height === "number" &&
      Math.max(metadata.width, metadata.height) > maxDimension;
    const processed = shouldResize
      ? pipeline.resize({
          height: maxDimension,
          fit: "inside",
          width: maxDimension,
          withoutEnlargement: true,
        })
      : pipeline;
    const output = await processed
      .jpeg({
        mozjpeg: true,
        quality,
      })
      .toBuffer({ resolveWithObject: true });

    if (output.data.byteLength >= fileBuffer.byteLength) {
      console.info("[OCR] image optimization", {
        originalSize: fileBuffer.byteLength,
        optimizedSize: output.data.byteLength,
        width: output.info.width,
        height: output.info.height,
        mimeType,
        optimizationSkipped: true,
        contrastNormalized: contrastNormalizationEnabled,
        reason: "optimized image was not smaller",
      });
      return null;
    }

    console.info("[OCR] image optimization", {
      originalSize: fileBuffer.byteLength,
      optimizedSize: output.data.byteLength,
      width: output.info.width,
      height: output.info.height,
      mimeType: "image/jpeg",
      optimizationSkipped: false,
      contrastNormalized: contrastNormalizationEnabled,
    });

    return {
      buffer: output.data,
      height: output.info.height,
      mimeType: "image/jpeg",
      optimizedSize: output.data.byteLength,
      originalSize: fileBuffer.byteLength,
      width: output.info.width,
    };
  } catch (error) {
    console.warn("[OCR] image optimization failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? sanitizeLogText(error.message) : "Unknown error",
      mimeType,
      originalSize: fileBuffer.byteLength,
    });
    return null;
  }
}

function isImageOptimizationEnabled() {
  const value = process.env.OCR_IMAGE_OPTIMIZATION_ENABLED ?? "true";
  return value.trim().replace(/^['"]|['"]$/g, "").toLowerCase() !== "false";
}

function isContrastNormalizationEnabled() {
  const value = process.env.OCR_IMAGE_CONTRAST_NORMALIZATION_ENABLED ?? "true";
  return value.trim().replace(/^['"]|['"]$/g, "").toLowerCase() !== "false";
}

function isSupportedImageMimeType(mimeType: string) {
  return mimeType === "image/jpeg" || mimeType === "image/jpg" || mimeType === "image/png";
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeLogText(value: string) {
  return value.replace(/\s+/g, " ").replace(/</g, "‹").replace(/>/g, "›").slice(0, 180);
}
