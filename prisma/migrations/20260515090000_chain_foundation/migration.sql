CREATE TABLE "Chain" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legalName" TEXT,
  "brandName" TEXT,
  "taxCode" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "website" TEXT,
  "specialty" TEXT NOT NULL DEFAULT 'DENTAL',
  "primaryColor" TEXT,
  "logoUrl" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Chain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Chain_organizationId_name_key" ON "Chain"("organizationId", "name");
CREATE INDEX "Chain_organizationId_active_idx" ON "Chain"("organizationId", "active");

ALTER TABLE "Chain"
  ADD CONSTRAINT "Chain_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Clinic" ADD COLUMN "chainId" TEXT;

INSERT INTO "Chain" ("id", "organizationId", "name", "brandName", "active", "createdAt", "updatedAt")
SELECT
  concat('chain_', substr(md5("id"), 1, 24)),
  "id",
  COALESCE(NULLIF("name", ''), 'Default Dental Chain'),
  COALESCE(NULLIF("name", ''), 'Default Dental Chain'),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization"
WHERE NOT EXISTS (
  SELECT 1
  FROM "Chain"
  WHERE "Chain"."organizationId" = "Organization"."id"
);

UPDATE "Clinic"
SET "chainId" = "Chain"."id"
FROM "Chain"
WHERE "Clinic"."organizationId" = "Chain"."organizationId"
  AND "Clinic"."chainId" IS NULL;

CREATE INDEX "Clinic_chainId_idx" ON "Clinic"("chainId");

ALTER TABLE "Clinic"
  ADD CONSTRAINT "Clinic_chainId_fkey"
  FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE SET NULL ON UPDATE CASCADE;
