import { createHash } from "node:crypto";

import type { AccessSessionPayload } from "@/lib/access-session";

const OCR_BLOB_PREFIX = "ocr-inputs";
const DEFAULT_MAX_BLOB_SIZE_MB = 50;

export const OCR_BLOB_ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export function getOcrBlobUploadPrefix(
  email: string,
  accessSession?: AccessSessionPayload | null,
) {
  const ownerIdentity = [
    email.trim().toLowerCase(),
    accessSession?.clientId ?? "",
    accessSession?.accessCodeId ?? "",
    accessSession?.accessMode ?? "legacy",
  ].join(":");
  const ownerKey = createHash("sha256").update(ownerIdentity).digest("hex").slice(0, 24);

  return `${OCR_BLOB_PREFIX}/${ownerKey}/`;
}

export function getOcrBlobMaxSizeBytes() {
  const configured = Number(
    process.env.OCR_BLOB_MAX_FILE_SIZE_MB ?? DEFAULT_MAX_BLOB_SIZE_MB,
  );
  const maxSizeMb =
    Number.isFinite(configured) && configured > 0
      ? Math.min(configured, DEFAULT_MAX_BLOB_SIZE_MB)
      : DEFAULT_MAX_BLOB_SIZE_MB;

  return maxSizeMb * 1024 * 1024;
}

export function isAllowedOcrBlobContentType(value: string) {
  return OCR_BLOB_ALLOWED_CONTENT_TYPES.includes(
    normalizeOcrBlobContentType(value) as (typeof OCR_BLOB_ALLOWED_CONTENT_TYPES)[number],
  );
}

export function normalizeOcrBlobContentType(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

export function isOwnedOcrBlobPathname(pathname: string, expectedPrefix: string) {
  return (
    pathname.startsWith(expectedPrefix) &&
    !pathname.includes("..") &&
    pathname.length > expectedPrefix.length
  );
}

