import { createHmac, timingSafeEqual } from "node:crypto";

export type AccessSessionPayload = {
  accessCodeId?: string;
  accessMode?: "client" | "legacy" | "master";
  allowProfileTesting?: boolean;
  clientId?: string;
  clientProfileId: string;
  isInternalTest?: boolean;
  planId?: string;
};

const COOKIE_NAME = "adalo_ocr_access_session";

export function getAccessSessionCookieName() {
  return process.env.ACCESS_SESSION_COOKIE_NAME || COOKIE_NAME;
}

export function createAccessSessionCookie(payload: AccessSessionPayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signPayload(encoded);
  return `${encoded}.${signature}`;
}

export function verifyAccessSessionCookie(cookieValue?: string): AccessSessionPayload | null {
  if (!cookieValue) return null;

  const [encoded, signature] = cookieValue.split(".");
  if (!encoded || !signature) return null;
  if (!safeCompare(signature, signPayload(encoded))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<AccessSessionPayload>;
    return {
      accessCodeId: typeof parsed.accessCodeId === "string" ? parsed.accessCodeId : undefined,
      accessMode:
        parsed.accessMode === "master" || parsed.accessMode === "legacy" || parsed.accessMode === "client"
          ? parsed.accessMode
          : "legacy",
      allowProfileTesting: parsed.allowProfileTesting === true,
      clientId: typeof parsed.clientId === "string" ? parsed.clientId : undefined,
      clientProfileId:
        typeof parsed.clientProfileId === "string"
          ? parsed.clientProfileId
          : "internal-general",
      isInternalTest: parsed.isInternalTest === true,
      planId: typeof parsed.planId === "string" ? parsed.planId : undefined,
    };
  } catch {
    return null;
  }
}

function signPayload(payload: string) {
  return createHmac("sha256", getCookieSecret()).update(payload).digest("hex");
}

function getCookieSecret() {
  const secret = process.env.ACCESS_COOKIE_SECRET || process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "adalo-intelligence-ocr-access-session-dev-secret";
  throw new Error("ACCESS_COOKIE_SECRET or AUTH_SECRET must be configured in production.");
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}
