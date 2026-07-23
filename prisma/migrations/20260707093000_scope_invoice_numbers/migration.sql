ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

UPDATE "Invoice" AS invoice
SET "organizationId" = patient."organizationId"
FROM "Patient" AS patient
WHERE invoice."patientId" = patient."id"
  AND invoice."organizationId" IS NULL;

UPDATE "Invoice" AS invoice
SET "organizationId" = clinic."organizationId"
FROM "Clinic" AS clinic
WHERE invoice."clinicId" = clinic."id"
  AND invoice."organizationId" IS NULL;

ALTER TABLE "Invoice" ALTER COLUMN "organizationId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Invoice_organizationId_fkey'
  ) THEN
    ALTER TABLE "Invoice"
      ADD CONSTRAINT "Invoice_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS "Invoice_invoiceNo_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_organizationId_invoiceNo_key"
  ON "Invoice"("organizationId", "invoiceNo");

CREATE INDEX IF NOT EXISTS "Invoice_organizationId_clinicId_idx"
  ON "Invoice"("organizationId", "clinicId");
