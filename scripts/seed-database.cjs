const { createHash } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const PLANS = [
  {
    name: "Demo",
    description: "Prueba acotada para validaciones iniciales.",
    dailyLimit: 5,
    monthlyLimit: 10,
    maxPdfSizeMb: 20,
    maxImageSizeMb: 10,
    allowJsonExport: true,
    allowCustomProfile: false,
  },
  {
    name: "Piloto",
    description: "Piloto comercial con uso moderado.",
    dailyLimit: 20,
    monthlyLimit: 100,
    maxPdfSizeMb: 50,
    maxImageSizeMb: 20,
    allowJsonExport: true,
    allowCustomProfile: true,
  },
  {
    name: "Basico",
    description: "Operación básica para documentos frecuentes.",
    dailyLimit: 50,
    monthlyLimit: 500,
    maxPdfSizeMb: 50,
    maxImageSizeMb: 20,
    allowJsonExport: true,
    allowCustomProfile: true,
  },
  {
    name: "Profesional",
    description: "Uso profesional con mayor volumen mensual.",
    dailyLimit: 150,
    monthlyLimit: 2000,
    maxPdfSizeMb: 50,
    maxImageSizeMb: 20,
    allowJsonExport: true,
    allowCustomProfile: true,
  },
  {
    name: "Empresa",
    description: "Uso empresarial administrado manualmente.",
    dailyLimit: 9999,
    monthlyLimit: 99999,
    maxPdfSizeMb: 50,
    maxImageSizeMb: 20,
    allowJsonExport: true,
    allowCustomProfile: true,
  },
];

async function main() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: { ...plan, isActive: true },
      create: { ...plan, isActive: true },
    });
  }

  const adminEmails = parseList(process.env.ADMIN_EMAILS);

  for (const email of adminEmails) {
    await prisma.adminUser.upsert({
      where: { email },
      update: { isActive: true, role: "owner" },
      create: { email, role: "owner", isActive: true },
    });
  }

  if (isEnabled(process.env.SEED_MATEO_CLIENT)) {
    const piloto = await prisma.plan.findUnique({ where: { name: "Piloto" } });
    const client = await prisma.client.upsert({
      where: { id: "seed_mateo" },
      update: {
        name: "Mateo / Papas",
        status: "active",
        profileId: "mateo",
        planId: piloto?.id,
      },
      create: {
        id: "seed_mateo",
        name: "Mateo / Papas",
        status: "active",
        profileId: "mateo",
        planId: piloto?.id,
      },
    });

    const configuredCode = process.env.SEED_MATEO_ACCESS_CODE?.trim();
    if (configuredCode && piloto) {
      await prisma.accessCode.upsert({
        where: { codeHash: hashAccessCode(configuredCode) },
        update: {
          clientId: client.id,
          planId: piloto.id,
          status: "active",
          displayCodePrefix: displayPrefix(configuredCode),
        },
        create: {
          clientId: client.id,
          planId: piloto.id,
          codeHash: hashAccessCode(configuredCode),
          codeAlias: displayPrefix(configuredCode),
          displayCodePrefix: displayPrefix(configuredCode),
          status: "active",
        },
      });
      console.info("Seeded Mateo access code hash. The full code was not logged.");
    }
  }

  console.info("Database seed completed.");
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isEnabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function hashAccessCode(code) {
  return createHash("sha256").update(code.trim()).digest("hex");
}

function displayPrefix(code) {
  return code.trim().split("-").slice(0, 3).join("-").toUpperCase();
}

main()
  .catch((error) => {
    console.error("Database seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
