import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAccessCookieName, verifyAccessCookie } from "@/lib/access-code";
import {
  getAccessSessionCookieName,
  verifyAccessSessionCookie,
} from "@/lib/access-session";
import { auth } from "@/lib/auth";
import {
  getOcrBlobMaxSizeBytes,
  getOcrBlobUploadPrefix,
  isAllowedOcrBlobContentType,
  isOwnedOcrBlobPathname,
  normalizeOcrBlobContentType,
  OCR_BLOB_ALLOWED_CONTENT_TYPES,
} from "@/lib/ocr-blob";
import { getMaxSizeMbForMimeType } from "@/lib/validations";
import {
  getOcrUsageContext,
  getPlanAwareMaxSizeMb,
} from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadClientPayload = {
  mimeType?: string;
  originalFileName?: string;
  size?: number;
};

export async function POST(request: Request) {
  console.info("UPLOAD_ROUTE_REACHED", {
    method: request.method,
    pathname: new URL(request.url).pathname,
  });

  try {
    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await auth();

        if (!session?.user?.email) {
          throw new Error("UPLOAD_UNAUTHORIZED");
        }

        const cookieStore = await cookies();
        const hasAccess = verifyAccessCookie(
          cookieStore.get(getAccessCookieName())?.value,
        );
        const accessSession = verifyAccessSessionCookie(
          cookieStore.get(getAccessSessionCookieName())?.value,
        );

        if (!hasAccess) {
          throw new Error("UPLOAD_ACCESS_NOT_ENABLED");
        }

        const expectedPrefix = getOcrBlobUploadPrefix(
          session.user.email,
          accessSession,
        );

        if (!isOwnedOcrBlobPathname(pathname, expectedPrefix)) {
          throw new Error("UPLOAD_PATH_NOT_ALLOWED");
        }

        const payload = parseUploadClientPayload(clientPayload);
        const mimeType = normalizeOcrBlobContentType(payload.mimeType ?? "");

        if (!isAllowedOcrBlobContentType(mimeType)) {
          throw new Error("UPLOAD_CONTENT_TYPE_NOT_ALLOWED");
        }

        const usageCheck = await getOcrUsageContext(accessSession);

        if (!usageCheck.allowed) {
          throw new Error("UPLOAD_PLAN_NOT_ALLOWED");
        }

        const globalLimitMb = getMaxSizeMbForMimeType(mimeType);
        const planLimitMb = getPlanAwareMaxSizeMb(
          mimeType,
          usageCheck.context,
          globalLimitMb,
        );
        const maximumSizeInBytes = Math.min(
          getOcrBlobMaxSizeBytes(),
          planLimitMb * 1024 * 1024,
        );

        if (
          typeof payload.size !== "number" ||
          payload.size <= 0 ||
          payload.size > maximumSizeInBytes
        ) {
          throw new Error("UPLOAD_FILE_TOO_LARGE");
        }

        return {
          allowedContentTypes: [...OCR_BLOB_ALLOWED_CONTENT_TYPES],
          maximumSizeInBytes,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            ownerPrefix: expectedPrefix,
            mimeType,
            size: payload.size,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parseTokenPayload(tokenPayload);

        console.info("UPLOAD_COMPLETED", {
          pathname: blob.pathname,
          contentType: blob.contentType,
          ownerPrefixMatched:
            typeof payload.ownerPrefix === "string" &&
            blob.pathname.startsWith(payload.ownerPrefix),
        });
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    console.warn("[OCR Upload] failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      errorCode: getUploadErrorCode(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: getUploadUserMessage(error),
        technicalDetail: getUploadErrorCode(error),
      },
      { status: getUploadStatus(error) },
    );
  }
}

function parseUploadClientPayload(value: string | null): UploadClientPayload {
  if (!value) return {};

  try {
    return JSON.parse(value) as UploadClientPayload;
  } catch {
    throw new Error("UPLOAD_CLIENT_PAYLOAD_INVALID");
  }
}

function parseTokenPayload(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>;

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function getUploadErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const knownCode = message.match(/UPLOAD_[A-Z_]+/)?.[0];

  if (knownCode) return knownCode;
  if (message.toLowerCase().includes("too large")) return "UPLOAD_FILE_TOO_LARGE";
  if (message.toLowerCase().includes("content type")) {
    return "UPLOAD_CONTENT_TYPE_NOT_ALLOWED";
  }

  return "BLOB_CLIENT_UPLOAD_FAILED";
}

function getUploadUserMessage(error: unknown) {
  const code = getUploadErrorCode(error);

  if (code === "UPLOAD_FILE_TOO_LARGE") {
    return "El archivo supera el tamaño máximo permitido de 50 MB.";
  }

  if (code === "UPLOAD_CONTENT_TYPE_NOT_ALLOWED") {
    return "Subí un archivo PDF, JPG o PNG para continuar.";
  }

  if (code === "UPLOAD_UNAUTHORIZED" || code === "UPLOAD_ACCESS_NOT_ENABLED") {
    return "No autorizado para subir archivos.";
  }

  if (code === "UPLOAD_PLAN_NOT_ALLOWED") {
    return "Alcanzaste el límite disponible para tu plan.";
  }

  return "No pudimos subir el archivo";
}

function getUploadStatus(error: unknown) {
  const code = getUploadErrorCode(error);

  if (code === "UPLOAD_UNAUTHORIZED") return 401;
  if (code === "UPLOAD_ACCESS_NOT_ENABLED" || code === "UPLOAD_PLAN_NOT_ALLOWED") {
    return 403;
  }
  if (
    code === "UPLOAD_FILE_TOO_LARGE" ||
    code === "UPLOAD_CONTENT_TYPE_NOT_ALLOWED" ||
    code === "UPLOAD_CLIENT_PAYLOAD_INVALID" ||
    code === "UPLOAD_PATH_NOT_ALLOWED"
  ) {
    return 400;
  }

  return 500;
}
