import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { hashAccessCode } from "@/lib/access-code";
import { requireAdminSession } from "@/lib/admin";
import { getPrismaClient } from "@/lib/db";
import { normalizeProfileRestriction } from "@/lib/profile-restrictions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const adminSession = await requireAdminSession();

  if (adminSession.status === "unauthenticated") {
    return NextResponse.json({ success: false, error: "No autorizado." }, { status: 401 });
  }

  if (adminSession.status !== "authorized") {
    return NextResponse.json({ success: false, error: "Acceso denegado." }, { status: 403 });
  }

  const prisma = getPrismaClient();

  if (!prisma) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL no esta configurada." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        allowedProfiles?: unknown;
        clientId?: unknown;
        expiresAt?: unknown;
        forcedProfile?: unknown;
        planId?: unknown;
        restrictionMode?: unknown;
      }
    | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  const requestedPlanId = typeof body?.planId === "string" ? body.planId : "";
  const profileRestriction = normalizeProfileRestriction({
    allowedProfiles: Array.isArray(body?.allowedProfiles)
      ? body.allowedProfiles.filter(
          (profileId): profileId is string => typeof profileId === "string",
        )
      : [],
    forcedProfile:
      typeof body?.forcedProfile === "string" ? body.forcedProfile : undefined,
    mode:
      typeof body?.restrictionMode === "string"
        ? body.restrictionMode
        : "automatic",
  });

  if (
    body?.restrictionMode === "allowed_profiles" &&
    profileRestriction.mode !== "allowed_profiles"
  ) {
    return NextResponse.json(
      { success: false, error: "Selecciona al menos un tipo documental permitido." },
      { status: 422 },
    );
  }

  if (
    body?.restrictionMode === "forced_profile" &&
    profileRestriction.mode !== "forced_profile"
  ) {
    return NextResponse.json(
      { success: false, error: "Selecciona el tipo documental obligatorio." },
      { status: 422 },
    );
  }

  const client = clientId
    ? await prisma.client.findUnique({ where: { id: clientId }, include: { plan: true } })
    : null;

  if (!client) {
    return NextResponse.json({ success: false, error: "Cliente no encontrado." }, { status: 404 });
  }

  const planId = requestedPlanId || client.planId || "";
  const plan = planId ? await prisma.plan.findUnique({ where: { id: planId } }) : null;

  if (!plan || !plan.isActive) {
    return NextResponse.json({ success: false, error: "Plan no disponible." }, { status: 422 });
  }

  const code = generateAccessCode(client.name);
  const prefix = code.split("-").slice(0, 3).join("-");
  const expiresAt =
    typeof body?.expiresAt === "string" && body.expiresAt
      ? new Date(`${body.expiresAt}T23:59:59.999Z`)
      : null;

  await prisma.accessCode.create({
    data: {
      clientId: client.id,
      codeAlias: prefix,
      codeHash: hashAccessCode(code),
      displayCodePrefix: prefix,
      expiresAt: expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : null,
      planId: plan.id,
      allowedProfiles: profileRestriction.allowedProfiles,
      forcedProfile: profileRestriction.forcedProfile ?? null,
      restrictionMode: profileRestriction.mode,
      status: "active",
    },
  });

  return NextResponse.json({
    success: true,
    code,
    displayCodePrefix: prefix,
  });
}

function generateAccessCode(clientName: string) {
  const year = new Date().getFullYear();
  const clientSlug = clientName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase()
    .slice(0, 14);
  const suffix = randomBytes(3).toString("hex").toUpperCase().slice(0, 4);

  return `ADALO-${year}-${clientSlug || "CLIENTE"}-${suffix}`;
}
