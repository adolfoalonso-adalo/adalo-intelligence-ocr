export type ExtractionMetadataInput = {
  accessMode?: "client" | "legacy" | "master";
  clientProfileId?: string;
  confidence?: number;
  automaticReviewApplied?: boolean;
  correctionsApplied?: string[];
  detectedHeaders?: string[];
  documentType?: string;
  documentAiUsed?: boolean;
  durationMs?: number;
  extractionKind: string;
  extractionMode?: string;
  fallbackProvider?: string;
  fields: number;
  isInternalTest?: boolean;
  originalFileName: string;
  outputFileName: string;
  outputJsonFileName?: string;
  orientationSelected?: number;
  pagesProcessed?: number;
  processedAt?: Date;
  primaryProvider?: string;
  profileCode?: string;
  profileName?: string;
  providerUsed?: string;
  gptExtractorUsed?: boolean;
  gptExtractorMode?: "multimodal" | "text_layout_only";
  gptReviewerUsed?: boolean;
  gptReviewerMode?: "multimodal" | "text_layout_only";
  legacyProfilesBypassed?: boolean;
  pdfVisualRenderingAttempted?: boolean;
  pdfVisualRenderingSucceeded?: boolean;
  qualityStatus?: string;
  rejectedLegacyColumns?: string[];
  usedDocumentAiTextOnlyFallback?: boolean;
  visualPagesRendered?: boolean;
  visualRenderError?: string;
  records: number;
  rowsExtracted?: number;
  visualStructuringProvider?: string;
  warnings?: string[];
};

export type ExtractionMetadata = {
  accessMode?: "client" | "legacy" | "master";
  clientProfileId?: string;
  confidence?: number;
  automaticReviewApplied?: boolean;
  correctionsApplied?: string[];
  detectedHeaders?: string[];
  documentType?: string;
  documentAiUsed?: boolean;
  durationMs?: number;
  extractionKind: string;
  extractionMode?: string;
  fallbackProvider?: string;
  fields: number;
  isInternalTest?: boolean;
  originalFileName: string;
  outputFileName: string;
  outputJsonFileName?: string;
  orientationSelected?: number;
  pagesProcessed?: number;
  processedAt: string;
  primaryProvider?: string;
  profileCode?: string;
  profileName?: string;
  providerUsed?: string;
  gptExtractorUsed?: boolean;
  gptExtractorMode?: "multimodal" | "text_layout_only";
  gptReviewerUsed?: boolean;
  gptReviewerMode?: "multimodal" | "text_layout_only";
  legacyProfilesBypassed?: boolean;
  pdfVisualRenderingAttempted?: boolean;
  pdfVisualRenderingSucceeded?: boolean;
  qualityStatus?: string;
  rejectedLegacyColumns?: string[];
  usedDocumentAiTextOnlyFallback?: boolean;
  visualPagesRendered?: boolean;
  visualRenderError?: string;
  records: number;
  rowsExtracted?: number;
  visualStructuringProvider?: string;
  warnings: string[];
};

export function createExtractionMetadata({
  accessMode,
  automaticReviewApplied,
  clientProfileId,
  confidence,
  correctionsApplied,
  detectedHeaders,
  documentAiUsed,
  documentType,
  durationMs,
  extractionKind,
  extractionMode,
  fallbackProvider,
  fields,
  isInternalTest,
  originalFileName,
  outputFileName,
  outputJsonFileName,
  orientationSelected,
  pagesProcessed,
  processedAt = new Date(),
  primaryProvider,
  profileCode,
  profileName,
  providerUsed,
  gptExtractorUsed,
  gptExtractorMode,
  gptReviewerUsed,
  gptReviewerMode,
  legacyProfilesBypassed,
  pdfVisualRenderingAttempted,
  pdfVisualRenderingSucceeded,
  qualityStatus,
  rejectedLegacyColumns,
  usedDocumentAiTextOnlyFallback,
  visualPagesRendered,
  visualRenderError,
  records,
  rowsExtracted,
  visualStructuringProvider,
  warnings = [],
}: ExtractionMetadataInput): ExtractionMetadata {
  return {
    accessMode,
    automaticReviewApplied,
    clientProfileId,
    confidence,
    correctionsApplied,
    detectedHeaders,
    documentAiUsed,
    documentType,
    durationMs,
    extractionKind,
    extractionMode,
    fallbackProvider,
    fields,
    isInternalTest,
    originalFileName,
    outputFileName,
    outputJsonFileName,
    orientationSelected,
    pagesProcessed,
    processedAt: processedAt.toISOString(),
    primaryProvider,
    profileCode,
    profileName,
    providerUsed,
    gptExtractorUsed,
    gptExtractorMode,
    gptReviewerUsed,
    gptReviewerMode,
    legacyProfilesBypassed,
    pdfVisualRenderingAttempted,
    pdfVisualRenderingSucceeded,
    qualityStatus,
    rejectedLegacyColumns,
    usedDocumentAiTextOnlyFallback,
    visualPagesRendered,
    visualRenderError,
    records,
    rowsExtracted,
    visualStructuringProvider,
    warnings,
  };
}
