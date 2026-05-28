export const DOCUMENT_TYPES = ["auto", "table", "invoice", "report"] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function normalizeDocumentType(value: FormDataEntryValue | null | undefined): DocumentType {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  return DOCUMENT_TYPES.includes(normalized as DocumentType)
    ? (normalized as DocumentType)
    : "auto";
}
