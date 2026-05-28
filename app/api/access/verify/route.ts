import { NextResponse } from "next/server";
import {
  createAccessCookie,
  getAccessCookieMaxAgeSeconds,
  getAccessCookieName,
  getAccessRateLimitConfig,
  verifyAccessCode,
} from "@/lib/access-code";
import { auth } from "@/lib/auth";
import {
  createClientProfileCookie,
  getClientProfileCookieName,
  resolveClientProfileForAccessCode,
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

    if (!code || !verifyAccessCode(code)) {
      return jsonResponse(
        { success: false, error: "El código ingresado no es válido." },
        401,
        rateLimit,
      );
    }

    const clientProfile = resolveClientProfileForAccessCode(code);
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
