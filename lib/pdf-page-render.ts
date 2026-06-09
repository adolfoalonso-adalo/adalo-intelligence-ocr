export type PdfPageImage = {
  buffer: Buffer;
  height?: number;
  mimeType: "image/jpeg";
  pageNumber: number;
  rotation: 0 | 90 | 180 | 270;
  width?: number;
};

export type PdfPageRenderOptions = {
  maxPages?: number;
  maxWidth?: number;
  pageNumber: number;
  rotation?: 0 | 90 | 180 | 270;
};

type PdfjsDocument = {
  destroy?: () => Promise<void> | void;
  numPages: number;
};

type PdfjsModule = {
  getDocument: (options: {
    data: Uint8Array;
    disableFontFace?: boolean;
    disableWorker?: boolean;
    isEvalSupported?: boolean;
    useWorkerFetch?: boolean;
  }) => {
    promise: Promise<PdfjsDocument>;
  };
};

export class PdfPageRenderError extends Error {
  readonly technicalDetail: string;

  constructor(message: string, technicalDetail: string) {
    super(message);
    this.name = "PdfPageRenderError";
    this.technicalDetail = technicalDetail;
  }
}

export async function getPdfPageCount(fileBuffer: Buffer) {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfjsModule;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    disableFontFace: true,
    disableWorker: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  });
  const document = await loadingTask.promise;

  try {
    return document.numPages;
  } finally {
    await document.destroy?.();
  }
}

export async function renderPdfPageToImage(
  fileBuffer: Buffer,
  options: PdfPageRenderOptions,
): Promise<PdfPageImage> {
  const rotation = options.rotation ?? 0;
  const maxWidth = options.maxWidth ?? readPositiveInteger(process.env.OCR_PDF_RENDER_MAX_WIDTH, 2200);
  const density = readPositiveInteger(process.env.OCR_PDF_RENDER_DENSITY, 220);

  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const output = await sharp(fileBuffer, {
      density,
      page: Math.max(options.pageNumber - 1, 0),
      pages: 1,
    })
      .rotate(rotation)
      .resize({
        fit: "inside",
        width: maxWidth,
        withoutEnlargement: false,
      })
      .jpeg({
        mozjpeg: true,
        quality: readPositiveInteger(process.env.OCR_PDF_RENDER_JPEG_QUALITY, 90),
      })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: output.data,
      height: output.info.height,
      mimeType: "image/jpeg",
      pageNumber: options.pageNumber,
      rotation,
      width: output.info.width,
    };
  } catch (error) {
    throw new PdfPageRenderError(
      "No se pudo renderizar la pagina del PDF.",
      error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 220) : String(error ?? ""),
    );
  }
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
