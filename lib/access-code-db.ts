import { hashAccessCode, isReservedProfileAccessCode } from "@/lib/access-code";
import { resolveClientProfileForAccessCode } from "@/lib/client-profiles";
import { getPrismaClient } from "@/lib/db";

export type DbAccessCodeValidation =
  | {
      source: "db";
      valid: true;
      accessCodeId: string;
      clientId: string;
      clientProfileId: string;
      planId: string;
    }
  | {
      source: "db";
      valid: false;
      error: string;
    }
  | {
      source: "not-configured" | "not-found";
      valid: false;
    };

export async function validateAccessCodeFromDatabase(code: string): Promise<DbAccessCodeValidation> {
  if (isReservedProfileAccessCode(code)) {
    return { source: "not-found", valid: false };
  }

  const prisma = getPrismaClient();
  if (!prisma) return { source: "not-configured", valid: false };

  const codeHash = hashAccessCode(code);
  const accessCode = await prisma.accessCode
    .findUnique({
      where: { codeHash },
      include: { client: true, plan: true },
    })
    .catch((error: unknown) => {
      console.warn("[Access] Database validation unavailable", {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error ?? ""),
      });
      return null;
    });

  if (!accessCode) return { source: "not-found", valid: false };

  if (accessCode.status !== "active") {
    return { source: "db", valid: false, error: "El codigo de acceso no esta activo." };
  }

  if (accessCode.expiresAt && accessCode.expiresAt.getTime() <= Date.now()) {
    return { source: "db", valid: false, error: "El codigo de acceso esta vencido." };
  }

  if (accessCode.client.status !== "active") {
    return { source: "db", valid: false, error: "El cliente no esta activo." };
  }

  if (!accessCode.plan.isActive) {
    return { source: "db", valid: false, error: "El plan no esta activo." };
  }

  await prisma.accessCode.update({
    where: { id: accessCode.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    source: "db",
    valid: true,
    accessCodeId: accessCode.id,
    clientId: accessCode.clientId,
    clientProfileId: resolveDbClientProfileId({
      code,
      codeAlias: accessCode.codeAlias,
      displayCodePrefix: accessCode.displayCodePrefix,
      profileId: accessCode.client.profileId,
    }),
    planId: accessCode.planId,
  };
}

function resolveDbClientProfileId({
  code,
  codeAlias,
  displayCodePrefix,
  profileId,
}: {
  code: string;
  codeAlias?: string | null;
  displayCodePrefix?: string | null;
  profileId?: string | null;
}) {
  const aliasProfile =
    resolveClientProfileForAccessCode(code).id !== "general"
      ? resolveClientProfileForAccessCode(code)
      : resolveClientProfileForAccessCode(codeAlias || displayCodePrefix || "");

  if (aliasProfile.id !== "general") return aliasProfile.id;
  return profileId || "general";
}
