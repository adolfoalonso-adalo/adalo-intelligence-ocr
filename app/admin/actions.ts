"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin";
import { getPrismaClient } from "@/lib/db";
import { normalizeProfileRestriction } from "@/lib/profile-restrictions";

export async function createClientAction(formData: FormData) {
  const isAdmin = await assertAdminAction();
  const prisma = getPrismaClient();

  if (!isAdmin || !prisma) return;

  const name = readFormValue(formData, "name");
  if (!name) return;

  await prisma.client.create({
    data: {
      contactName: readFormValue(formData, "contactName") || null,
      email: readFormValue(formData, "email") || null,
      legalName: readFormValue(formData, "legalName") || null,
      name,
      notes: readFormValue(formData, "notes") || null,
      phone: readFormValue(formData, "phone") || null,
      planId: readFormValue(formData, "planId") || null,
      profileId: "internal-general",
      status: readFormValue(formData, "status") || "active",
    },
  });

  revalidatePath("/admin");
}

export async function toggleClientStatusAction(formData: FormData) {
  const isAdmin = await assertAdminAction();
  const prisma = getPrismaClient();

  if (!isAdmin || !prisma) return;

  const clientId = readFormValue(formData, "clientId");
  const status = readFormValue(formData, "status");
  if (!clientId || !["active", "inactive", "suspended"].includes(status)) return;

  await prisma.client.update({
    where: { id: clientId },
    data: { status },
  });

  revalidatePath("/admin");
}

export async function updateClientAction(formData: FormData) {
  const isAdmin = await assertAdminAction();
  const prisma = getPrismaClient();

  if (!isAdmin || !prisma) return;

  const clientId = readFormValue(formData, "clientId");
  const name = readFormValue(formData, "name");
  if (!clientId || !name) return;

  await prisma.client.update({
    where: { id: clientId },
    data: {
      contactName: readFormValue(formData, "contactName") || null,
      email: readFormValue(formData, "email") || null,
      legalName: readFormValue(formData, "legalName") || null,
      name,
      notes: readFormValue(formData, "notes") || null,
      phone: readFormValue(formData, "phone") || null,
      planId: readFormValue(formData, "planId") || null,
      status: readFormValue(formData, "status") || "active",
    },
  });

  revalidatePath("/admin");
}

export async function updateAccessCodeRestrictionAction(formData: FormData) {
  const isAdmin = await assertAdminAction();
  const prisma = getPrismaClient();

  if (!isAdmin || !prisma) return;

  const accessCodeId = readFormValue(formData, "accessCodeId");
  if (!accessCodeId) return;

  const restriction = normalizeProfileRestriction({
    allowedProfiles: formData
      .getAll("allowedProfiles")
      .filter((profileId): profileId is string => typeof profileId === "string"),
    forcedProfile: readFormValue(formData, "forcedProfile"),
    mode: readFormValue(formData, "restrictionMode"),
  });

  await prisma.accessCode.update({
    where: { id: accessCodeId },
    data: {
      allowedProfiles: restriction.allowedProfiles,
      forcedProfile: restriction.forcedProfile ?? null,
      restrictionMode: restriction.mode,
    },
  });

  revalidatePath("/admin");
}

export async function revokeAccessCodeAction(formData: FormData) {
  const isAdmin = await assertAdminAction();
  const prisma = getPrismaClient();

  if (!isAdmin || !prisma) return;

  const accessCodeId = readFormValue(formData, "accessCodeId");
  if (!accessCodeId) return;

  await prisma.accessCode.update({
    where: { id: accessCodeId },
    data: { status: "revoked" },
  });

  revalidatePath("/admin");
}

function readFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function assertAdminAction() {
  const adminSession = await requireAdminSession();

  if (adminSession.status !== "authorized") {
    return false;
  }

  return true;
}
