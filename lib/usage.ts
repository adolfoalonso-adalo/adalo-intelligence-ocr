import type { AccessSessionPayload } from "@/lib/access-session";
import { getPrismaClient } from "@/lib/db";
import type { DocumentType } from "@/lib/document-type";

export type OcrPlanContext = {
  accessCodeId: string;
  clientId: string;
  clientProfileId: string;
  planId: string;
  plan: {
    allowJsonExport: boolean;
    dailyLimit: number;
    maxImageSizeMb: number;
    maxPdfSizeMb: number;
    monthlyLimit: number;
    name: string;
  };
};

export type UsageCheckResult =
  | { allowed: true; context: OcrPlanContext | null }
  | { allowed: false; message: string; status: number; context: OcrPlanContext | null };

export async function getOcrUsageContext(payload: AccessSessionPayload | null): Promise<UsageCheckResult> {
  if (!payload?.accessCodeId) {
    return { allowed: true, context: null };
  }

  const prisma = getPrismaClient();
  if (!prisma) {
    return { allowed: true, context: null };
  }

  const accessCode = await prisma.accessCode.findUnique({
    where: { id: payload.accessCodeId },
    include: { client: true, plan: true },
  });

  if (!accessCode || accessCode.status !== "active") {
    return {
      allowed: false,
      status: 403,
      message: "Acceso no habilitado. El codigo esta inactivo o fue revocado.",
      context: null,
    };
  }

  if (accessCode.expiresAt && accessCode.expiresAt.getTime() <= Date.now()) {
    return {
      allowed: false,
      status: 403,
      message: "Acceso no habilitado. El codigo de acceso esta vencido.",
      context: null,
    };
  }

  if (accessCode.client.status !== "active" || !accessCode.plan.isActive) {
    return {
      allowed: false,
      status: 403,
      message: "Acceso no habilitado. Contacta a ADALO Consulting Group para revisar tu acceso.",
      context: null,
    };
  }

  const context: OcrPlanContext = {
    accessCodeId: accessCode.id,
    clientId: accessCode.clientId,
    clientProfileId: accessCode.client.profileId || payload.clientProfileId || "general",
    planId: accessCode.planId,
    plan: {
      allowJsonExport: accessCode.plan.allowJsonExport,
      dailyLimit: accessCode.plan.dailyLimit,
      maxImageSizeMb: accessCode.plan.maxImageSizeMb,
      maxPdfSizeMb: accessCode.plan.maxPdfSizeMb,
      monthlyLimit: accessCode.plan.monthlyLimit,
      name: accessCode.plan.name,
    },
  };

  const [dailyUsage, monthlyUsage] = await Promise.all([
    prisma.usageEvent.count({
      where: {
        accessCodeId: accessCode.id,
        status: "success",
        createdAt: { gte: startOfDay() },
      },
    }),
    prisma.usageEvent.count({
      where: {
        accessCodeId: accessCode.id,
        status: "success",
        createdAt: { gte: startOfMonth() },
      },
    }),
  ]);

  if (dailyUsage >= accessCode.plan.dailyLimit || monthlyUsage >= accessCode.plan.monthlyLimit) {
    return {
      allowed: false,
      status: 429,
      message:
        "Limite de uso alcanzado. Alcanzaste el limite disponible para tu plan. Contacta a ADALO Consulting Group para ampliar tu acceso.",
      context,
    };
  }

  return { allowed: true, context };
}

export async function recordUsageEvent(input: {
  context: OcrPlanContext | null;
  durationMs?: number;
  errorType?: string;
  estimatedDocumentType?: DocumentType;
  extractionKind?: string;
  fields?: number;
  fileMimeType?: string;
  fileSizeBytes?: number;
  originalFileName?: string;
  outputCsvFileName?: string;
  outputJsonFileName?: string;
  records?: number;
  status: "success" | "error";
}) {
  const prisma = getPrismaClient();
  if (!prisma || !input.context) return;

  await prisma.usageEvent
    .create({
      data: {
        accessCodeId: input.context.accessCodeId,
        clientId: input.context.clientId,
        durationMs: input.durationMs,
        errorType: input.errorType,
        estimatedDocumentType: input.estimatedDocumentType,
        extractionKind: input.extractionKind,
        fields: input.fields,
        fileMimeType: input.fileMimeType,
        fileSizeBytes: input.fileSizeBytes,
        modelLabel: "Motor ADALO",
        originalFileName: input.originalFileName,
        outputCsvFileName: input.outputCsvFileName,
        outputJsonFileName: input.outputJsonFileName,
        records: input.records,
        status: input.status,
      },
    })
    .catch((error) => {
      console.warn("[OCR] usage event registration failed", {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error ?? ""),
      });
    });
}

export function getPlanAwareMaxSizeMb(mimeType: string, context: OcrPlanContext | null, globalLimitMb: number) {
  if (!context) return globalLimitMb;
  if (mimeType === "application/pdf") return Math.min(globalLimitMb, context.plan.maxPdfSizeMb);
  if (mimeType === "image/jpeg" || mimeType === "image/png") {
    return Math.min(globalLimitMb, context.plan.maxImageSizeMb);
  }
  return globalLimitMb;
}

function startOfDay() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfMonth() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}
