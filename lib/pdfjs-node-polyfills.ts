type CanvasModule = {
  DOMMatrix?: unknown;
  ImageData?: unknown;
  Path2D?: unknown;
};

let polyfillsInstalled = false;

export async function installPdfjsNodePolyfills() {
  if (polyfillsInstalled) return;

  try {
    const canvas = (await import("@napi-rs/canvas")) as CanvasModule;
    const globals = globalThis as unknown as Record<string, unknown>;

    if (typeof globals.DOMMatrix === "undefined" && canvas.DOMMatrix) {
      globals.DOMMatrix = canvas.DOMMatrix;
    }
    if (typeof globals.ImageData === "undefined" && canvas.ImageData) {
      globals.ImageData = canvas.ImageData;
    }
    if (typeof globals.Path2D === "undefined" && canvas.Path2D) {
      globals.Path2D = canvas.Path2D;
    }

    polyfillsInstalled = true;
  } catch (error) {
    console.warn("[OCR] PDF canvas polyfills unavailable", {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage:
        error instanceof Error
          ? error.message.replace(/\s+/g, " ").slice(0, 180)
          : String(error ?? "").slice(0, 180),
    });
  }
}
