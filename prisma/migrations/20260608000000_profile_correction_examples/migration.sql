CREATE TABLE "profile_correction_examples" (
    "id" TEXT NOT NULL,
    "profileCode" TEXT NOT NULL,
    "originalCsv" TEXT,
    "originalJson" JSONB,
    "correctedCsv" TEXT,
    "correctedJson" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_correction_examples_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "profile_correction_examples_profileCode_createdAt_idx"
ON "profile_correction_examples"("profileCode", "createdAt");
