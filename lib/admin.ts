import { auth } from "@/lib/auth";
import { getPrismaClient } from "@/lib/db";

export type AdminSessionResult =
  | {
      status: "authorized";
      user: {
        email: string;
        name: string;
      };
    }
  | {
      status: "unauthenticated";
    }
  | {
      status: "unauthorized";
      email?: string;
      reason: string;
    };

export function getConfiguredAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email?: string | null) {
  if (!email) return false;
  return getConfiguredAdminEmails().includes(email.trim().toLowerCase());
}

export async function requireAdminSession(): Promise<AdminSessionResult> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email) {
    logAdminAccessDenied("missing-session");
    return { status: "unauthenticated" };
  }

  if (!isAdminEmail(email)) {
    logAdminAccessDenied("email-not-allowed", email);
    return { status: "unauthorized", email, reason: "email-not-allowed" };
  }

  const prisma = getPrismaClient();
  if (prisma) {
    const admin = await prisma.adminUser.findUnique({ where: { email } }).catch(() => null);
    if (admin && (!admin.isActive || !["owner", "admin", "viewer"].includes(admin.role))) {
      logAdminAccessDenied("admin-user-inactive-or-invalid-role", email);
      return { status: "unauthorized", email, reason: "admin-user-inactive-or-invalid-role" };
    }
  }

  return {
    status: "authorized",
    user: {
      email,
      name: session?.user?.name ?? email,
    },
  };
}

export async function requireAdminUser() {
  const result = await requireAdminSession();
  return result.status === "authorized" ? result.user : null;
}

export function logAdminAccessDenied(reason: string, email?: string) {
  console.warn("[Admin] Access denied", {
    reason,
    email: email ? maskEmail(email) : undefined,
  });
}

function maskEmail(email: string) {
  const [localPart = "", domain = ""] = email.split("@");
  const safeLocal =
    localPart.length <= 2 ? `${localPart.slice(0, 1)}***` : `${localPart.slice(0, 2)}***`;

  return domain ? `${safeLocal}@${domain}` : safeLocal;
}
