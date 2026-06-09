import { getPrismaClient } from "@/lib/db";

export type ProfileCorrectionExampleInput = {
  correctedCsv?: string;
  correctedJson?: unknown;
  notes?: string;
  originalCsv?: string;
  originalJson?: unknown;
  profileCode: string;
};

export type ProfileCorrectionExample = ProfileCorrectionExampleInput & {
  createdAt: Date;
  id: string;
};

export async function saveProfileCorrectionExample(input: ProfileCorrectionExampleInput) {
  const prisma = getPrismaClient();

  if (!prisma) return null;

  return getProfileCorrectionModel(prisma).create({
    data: {
      correctedCsv: input.correctedCsv,
      correctedJson: toJsonValue(input.correctedJson),
      notes: input.notes,
      originalCsv: input.originalCsv,
      originalJson: toJsonValue(input.originalJson),
      profileCode: input.profileCode,
    },
  });
}

export async function getProfileCorrectionExamples(profileCode: string, limit = 3) {
  const prisma = getPrismaClient();

  if (!prisma) return [];

  return getProfileCorrectionModel(prisma).findMany({
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 5)),
    where: { profileCode },
  });
}

function getProfileCorrectionModel(prisma: NonNullable<ReturnType<typeof getPrismaClient>>) {
  return (prisma as unknown as {
    profileCorrectionExample: {
      create(input: { data: Record<string, unknown> }): Promise<ProfileCorrectionExample>;
      findMany(input: {
        orderBy: { createdAt: "desc" };
        take: number;
        where: { profileCode: string };
      }): Promise<
        Array<{
          correctedCsv?: string | null;
          notes?: string | null;
          originalCsv?: string | null;
        }>
      >;
    };
  }).profileCorrectionExample;
}

export function formatCorrectionExamplesForPrompt(
  examples: Array<{
    correctedCsv?: string | null;
    notes?: string | null;
    originalCsv?: string | null;
  }>,
) {
  return examples
    .filter((example) => example.correctedCsv || example.originalCsv || example.notes)
    .map((example, index) => {
      const parts = [
        `Ejemplo corregido ${index + 1}:`,
        example.notes ? `Notas: ${truncatePromptExample(example.notes, 700)}` : "",
        example.originalCsv ? `Salida original resumida:\n${truncatePromptExample(example.originalCsv, 2000)}` : "",
        example.correctedCsv ? `Salida corregida esperada:\n${truncatePromptExample(example.correctedCsv, 3000)}` : "",
      ].filter(Boolean);

      return parts.join("\n");
    })
    .join("\n\n");
}

function toJsonValue(value: unknown) {
  if (value === undefined) return undefined;
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function truncatePromptExample(value: string, maxLength: number) {
  const compact = value.replace(/\0/g, "").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}
