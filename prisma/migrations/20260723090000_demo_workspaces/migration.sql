ALTER TABLE "Organization"
ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "demoExpiresAt" TIMESTAMP(3);

CREATE INDEX "Organization_isDemo_demoExpiresAt_idx"
ON "Organization"("isDemo", "demoExpiresAt");
