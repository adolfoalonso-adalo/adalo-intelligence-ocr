export type ExtractionMetadataInput = {
  clientProfileId?: string;
  durationMs?: number;
  extractionKind: string;
  fields: number;
  originalFileName: string;
  outputFileName: string;
  outputJsonFileName?: string;
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
  outputJsonFileName?: string;
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
  outputJsonFileName,
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
    outputJsonFileName,
    processedAt: processedAt.toISOString(),
    records,
  };
}
