import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const DEFAULT_ACCESS_COOKIE_TTL_SECONDS = 30 * 60;

export function hashAccessCode(code: string): string {
  return createHash("sha256").update(normalizeAccessCode(code)).digest("hex");
}

export function verifyAccessCode(code: string): boolean {
  if (isReservedProfileAccessCode(code)) return false;

  const hashes = getConfiguredHashes();
  const candidate = hashAccessCode(code);

  return hashes.some((hash) => safeCompare(candidate, hash));
}

export function verifyMasterAccessCode(code: string): boolean {
  if (isReservedProfileAccessCode(code)) return false;

  const masterHash = normalizeConfiguredHash(process.env.MASTER_ACCESS_CODE_HASH);
  if (!masterHash) return false;

  return safeCompare(hashAccessCode(code), masterHash);
}

export function createAccessCookie(): string {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + getAccessCookieMaxAgeSeconds() * 1000;
  const payload = `${issuedAt}.${expiresAt}`;
  const signature = signPayload(payload);

  return `${payload}.${signature}`;
}

export function verifyAccessCookie(cookieValue?: string): boolean {
  if (!cookieValue) return false;

  const parts = cookieValue.split(".");

  if (parts.length !== 3) return false;

  const [issuedAt, expiresAt, signature] = parts;
  const expiresAtNumber = Number(expiresAt);

  if (!issuedAt || !expiresAt || !signature || !Number.isFinite(expiresAtNumber)) {
    return false;
  }

  if (expiresAtNumber <= Date.now()) {
    return false;
  }

  return safeCompare(signature, signPayload(`${issuedAt}.${expiresAt}`));
}

export function getAccessCookieName() {
  return process.env.ACCESS_CODE_COOKIE_NAME || "adalo_ocr_access";
}

export function getAccessCookieMaxAgeSeconds() {
  return readPositiveInteger(process.env.ACCESS_CODE_TTL_SECONDS, DEFAULT_ACCESS_COOKIE_TTL_SECONDS);
}

export function getAccessRateLimitConfig() {
  return {
    limit: readPositiveInteger(process.env.ACCESS_CODE_MAX_ATTEMPTS, 5),
    windowSeconds: readPositiveInteger(process.env.ACCESS_CODE_WINDOW_SECONDS, 600),
  };
}

function getConfiguredHashes() {
  return (process.env.ACCESS_CODE_HASHES || "")
    .split(",")
    .map(normalizeConfiguredHash)
    .filter(Boolean);
}

function normalizeAccessCode(code: string) {
  return code.trim();
}

export function isReservedProfileAccessCode(code: string) {
  const normalized = normalizeAccessCode(code).toUpperCase();

  return normalized === "ADALO-2026-MATEO" || normalized === "ADALO-2026-MOVIMIENTO";
}

function normalizeConfiguredHash(value?: string) {
  return (value || "").trim().replace(/^['"]|['"]$/g, "").toLowerCase();
}

function signPayload(payload: string) {
  return createHmac("sha256", getCookieSecret()).update(payload).digest("hex");
}

function getCookieSecret() {
  const secret = process.env.ACCESS_COOKIE_SECRET || process.env.AUTH_SECRET;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "ACCESS_COOKIE_SECRET is not configured. Using a development-only fallback secret.",
    );
    return "adalo-intelligence-ocr-access-dev-secret";
  }

  throw new Error("ACCESS_COOKIE_SECRET or AUTH_SECRET must be configured in production.");
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
