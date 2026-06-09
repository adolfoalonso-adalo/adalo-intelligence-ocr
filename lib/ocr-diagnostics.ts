export type OCRTextOnlyDiagnostic = {
  canDownloadRawText: true;
  extractionMode: "ocr_text_only";
  fallbackUsed: boolean;
  pagesProcessed: number;
  profileUsed: string;
  providerUsed: string;
  qualityScore: number;
  qualityStatus: "failed_quality_gate" | "manual_review_required";
  rawTextContent: string;
  reason: string;
  textLength: number;
  warnings: string[];
};

export class OCRTextOnlyError extends Error {
  readonly diagnostic: OCRTextOnlyDiagnostic;

  constructor(diagnostic: OCRTextOnlyDiagnostic) {
    super("OCR text was extracted but could not be structured reliably");
    this.name = "OCRTextOnlyError";
    this.diagnostic = diagnostic;
  }
}

export function withOCRTextOnlyContext(
  error: OCRTextOnlyError,
  context: Partial<
    Pick<
      OCRTextOnlyDiagnostic,
      "fallbackUsed" | "profileUsed" | "providerUsed" | "qualityScore" | "qualityStatus" | "reason"
    >
  >,
) {
  return new OCRTextOnlyError({
    ...error.diagnostic,
    ...context,
  });
}

export function sanitizeRawOcrText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      [...line]
        .filter((character) => {
          const code = character.charCodeAt(0);
          return code === 9 || (code >= 32 && code !== 127);
        })
        .join("")
        .trimEnd(),
    )
    .join("\n")
    .trim();
}
