export type ExtractionMetadataInput = {
  clientProfileId?: string;
  durationMs?: number;
  extractionKind: string;
  fields: number;
  originalFileName: string;
  outputFileName: string;
  processedAt?: Date;
  records: number;
};

export type ExtractionMetadata = {
  clientProfileId?: string;
  durationMs?: number;
  extractionKind: string;
  fields: number;
  originalFileName: string;
  outputFileName: string;
  processedAt: string;
  records: number;
};

export function createExtractionMetadata({
  clientProfileId,
  durationMs,
  extractionKind,
  fields,
  originalFileName,
  outputFileName,
  processedAt = new Date(),
  records,
}: ExtractionMetadataInput): ExtractionMetadata {
  return {
    clientProfileId,
    durationMs,
    extractionKind,
    fields,
    originalFileName,
    outputFileName,
    processedAt: processedAt.toISOString(),
    records,
  };
}
