import { NextResponse } from "next/server";
import {
  createAccessCookie,
  getAccessCookieMaxAgeSeconds,
  getAccessCookieName,
  getAccessRateLimitConfig,
  verifyAccessCode,
  verifyMasterAccessCode,
} from "@/lib/access-code";
import { validateAccessCodeFromDatabase } from "@/lib/access-code-db";
import {
  createAccessSessionCookie,
  getAccessSessionCookieName,
} from "@/lib/access-session";
import { auth } from "@/lib/auth";
import {
  createClientProfileCookie,
  getClientProfileById,
  getClientProfileCookieName,
} from "@/lib/client-profiles";
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIp,
  type RateLimitResult,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await auth();
    const clientIp = getClientIp(request.headers);
    const rateLimitConfig = getAccessRateLimitConfig();
    const rateLimit = await checkRateLimit({
      namespace: "access-code",
      key: session?.user?.email ? `user:${session.user.email}` : `ip:${clientIp}`,
      ...rateLimitConfig,
    });

    if (!session?.user) {
      return jsonResponse(
        { success: false, error: "No autorizado. Iniciá sesión para validar el acceso." },
        401,
        rateLimit,
      );
    }

    if (!rateLimit.allowed) {
      return jsonResponse(
        {
          success: false,
          error: "Demasiados intentos. Esperá unos minutos e intentá nuevamente.",
        },
        429,
        rateLimit,
      );
    }

    const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code : "";
    const dbValidation = code ? await validateAccessCodeFromDatabase(code) : null;
    const isValidDbCode = dbValidation?.source === "db" && dbValidation.valid;
    const isInvalidKnownDbCode = dbValidation?.source === "db" && !dbValidation.valid;
    const isValidMasterCode =
      !isValidDbCode && !isInvalidKnownDbCode && Boolean(code && verifyMasterAccessCode(code));
    const isAllowedMasterUser =
      !isValidMasterCode || isMasterAccessEmailAllowed(session.user.email ?? "");
    const isValidLegacyCode =
      !isValidMasterCode && dbValidation?.source !== "db" && Boolean(code && verifyAccessCode(code));

    if (
      !code ||
      isInvalidKnownDbCode ||
      !isAllowedMasterUser ||
      (!isValidDbCode && !isValidMasterCode && !isValidLegacyCode)
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            isInvalidKnownDbCode && dbValidation && "error" in dbValidation
              ? dbValidation.error
              : "El código ingresado no es válido.",
        },
        401,
        rateLimit,
      );
    }

    const clientProfile = isValidDbCode
      ? getClientProfileById(dbValidation.clientProfileId)
      : isValidMasterCode
        ? getClientProfileById("internal-general")
        : getClientProfileById("internal-general");
    const response = jsonResponse({ success: true }, 200, rateLimit);
    response.cookies.set(getAccessCookieName(), createAccessCookie(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: getAccessCookieMaxAgeSeconds(),
      path: "/",
    });
    response.cookies.set(getClientProfileCookieName(), createClientProfileCookie(clientProfile.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: getAccessCookieMaxAgeSeconds(),
      path: "/",
    });
    response.cookies.set(
      getAccessSessionCookieName(),
      createAccessSessionCookie({
        accessCodeId: isValidDbCode ? dbValidation.accessCodeId : undefined,
        accessMode: isValidDbCode ? "client" : isValidMasterCode ? "master" : "legacy",
        allowedProfiles: isValidDbCode
          ? dbValidation.profileRestriction.allowedProfiles
          : [],
        allowProfileTesting: isValidMasterCode,
        clientId: isValidDbCode ? dbValidation.clientId : undefined,
        clientProfileId: clientProfile.id,
        forcedProfile: isValidDbCode
          ? dbValidation.profileRestriction.forcedProfile
          : undefined,
        isInternalTest: isValidMasterCode,
        planId: isValidDbCode ? dbValidation.planId : undefined,
        restrictionMode: isValidDbCode
          ? dbValidation.profileRestriction.mode
          : "automatic",
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: getAccessCookieMaxAgeSeconds(),
        path: "/",
      },
    );

    return response;
  } catch (error) {
    console.error("Access verification failed", error);

    return NextResponse.json(
      { success: false, error: "No se pudo validar el acceso. Intentá nuevamente." },
      { status: 500 },
    );
  }
}

const methodNotAllowed = () =>
  NextResponse.json(
    { success: false, error: "Método no permitido. Usá POST para validar el acceso." },
    { status: 405, headers: { Allow: "POST" } },
  );

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};

function jsonResponse(body: Record<string, unknown>, status: number, rateLimit: RateLimitResult) {
  return NextResponse.json(body, {
    status,
    headers: createRateLimitHeaders(rateLimit),
  });
}

function isMasterAccessEmailAllowed(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const masterEmail = normalizeEmail(process.env.MASTER_ACCESS_EMAIL || "");
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);

  if (masterEmail) return normalizedEmail === masterEmail;
  return adminEmails.includes(normalizedEmail);
}

function normalizeEmail(value: string) {
  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  return (emailMatch?.[0] || value)
    .replace(/^mailto:/i, "")
    .replace(/^\[|\]$/g, "")
    .trim()
    .toLowerCase();
}
