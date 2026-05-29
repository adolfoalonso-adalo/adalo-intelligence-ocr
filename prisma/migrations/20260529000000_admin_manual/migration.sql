CREATE TABLE IF NOT EXISTS "plans" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "dailyLimit" INTEGER NOT NULL,
  "monthlyLimit" INTEGER NOT NULL,
  "maxPdfSizeMb" INTEGER NOT NULL,
  "maxImageSizeMb" INTEGER NOT NULL,
  "allowJsonExport" BOOLEAN NOT NULL DEFAULT true,
  "allowCustomProfile" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "plans_name_key" ON "plans"("name");

CREATE TABLE IF NOT EXISTS "clients" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legalName" TEXT,
  "email" TEXT,
  "contactName" TEXT,
  "phone" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "profileId" TEXT NOT NULL DEFAULT 'general',
  "notes" TEXT,
  "planId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "plans"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "access_codes" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codeAlias" TEXT,
  "displayCodePrefix" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "access_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "access_codes_codeHash_key" ON "access_codes"("codeHash");
CREATE INDEX IF NOT EXISTS "access_codes_clientId_idx" ON "access_codes"("clientId");
CREATE INDEX IF NOT EXISTS "access_codes_planId_idx" ON "access_codes"("planId");

ALTER TABLE "access_codes"
  ADD CONSTRAINT "access_codes_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "access_codes"
  ADD CONSTRAINT "access_codes_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "plans"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" TEXT NOT NULL,
  "clientId" TEXT,
  "accessCodeId" TEXT,
  "status" TEXT NOT NULL,
  "errorType" TEXT,
  "originalFileName" TEXT,
  "outputCsvFileName" TEXT,
  "outputJsonFileName" TEXT,
  "fileMimeType" TEXT,
  "fileSizeBytes" INTEGER,
  "estimatedDocumentType" TEXT,
  "extractionKind" TEXT,
  "records" INTEGER,
  "fields" INTEGER,
  "durationMs" INTEGER,
  "modelLabel" TEXT NOT NULL DEFAULT 'Motor ADALO',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "usage_events_clientId_createdAt_idx" ON "usage_events"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "usage_events_accessCodeId_createdAt_idx" ON "usage_events"("accessCodeId", "createdAt");

ALTER TABLE "usage_events"
  ADD CONSTRAINT "usage_events_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "usage_events"
  ADD CONSTRAINT "usage_events_accessCodeId_fkey"
  FOREIGN KEY ("accessCodeId") REFERENCES "access_codes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "admin_users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_email_key" ON "admin_users"("email");
