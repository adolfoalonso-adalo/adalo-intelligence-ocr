export type ExtractionMetadataInput = {
  accessMode?: "client" | "legacy" | "master";
  clientProfileId?: string;
  confidence?: number;
  documentType?: string;
  durationMs?: number;
  extractionKind: string;
  extractionMode?: string;
  fallbackProvider?: string;
  fields: number;
  isInternalTest?: boolean;
  originalFileName: string;
  outputFileName: string;
  outputJsonFileName?: string;
  pagesProcessed?: number;
  processedAt?: Date;
  primaryProvider?: string;
  profileCode?: string;
  profileName?: string;
  providerUsed?: string;
  qualityStatus?: string;
  records: number;
  rowsExtracted?: number;
  warnings?: string[];
};

export type ExtractionMetadata = {
  accessMode?: "client" | "legacy" | "master";
  clientProfileId?: string;
  confidence?: number;
  documentType?: string;
  durationMs?: number;
  extractionKind: string;
  extractionMode?: string;
  fallbackProvider?: string;
  fields: number;
  isInternalTest?: boolean;
  originalFileName: string;
  outputFileName: string;
  outputJsonFileName?: string;
  pagesProcessed?: number;
  processedAt: string;
  primaryProvider?: string;
  profileCode?: string;
  profileName?: string;
  providerUsed?: string;
  qualityStatus?: string;
  records: number;
  rowsExtracted?: number;
  warnings: string[];
};

export function createExtractionMetadata({
  accessMode,
  clientProfileId,
  confidence,
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
  pagesProcessed,
  processedAt = new Date(),
  primaryProvider,
  profileCode,
  profileName,
  providerUsed,
  qualityStatus,
  records,
  rowsExtracted,
  warnings = [],
}: ExtractionMetadataInput): ExtractionMetadata {
  return {
    accessMode,
    clientProfileId,
    confidence,
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
    pagesProcessed,
    processedAt: processedAt.toISOString(),
    primaryProvider,
    profileCode,
    profileName,
    providerUsed,
    qualityStatus,
    records,
    rowsExtracted,
    warnings,
  };
}
