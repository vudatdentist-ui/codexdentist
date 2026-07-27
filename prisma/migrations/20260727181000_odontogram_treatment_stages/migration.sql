CREATE TYPE "OdontogramStage" AS ENUM ('INITIAL', 'EXPECTED', 'CURRENT');

ALTER TABLE "PatientOdontogram"
RENAME COLUMN "snapshot" TO "currentSnapshot";

ALTER TABLE "PatientOdontogram"
RENAME COLUMN "revision" TO "currentRevision";

ALTER TABLE "PatientOdontogram"
ADD COLUMN "initialSnapshot" JSONB,
ADD COLUMN "expectedSnapshot" JSONB,
ADD COLUMN "initialRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "expectedRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "initialUpdatedAt" TIMESTAMP(3),
ADD COLUMN "expectedUpdatedAt" TIMESTAMP(3),
ADD COLUMN "currentUpdatedAt" TIMESTAMP(3);

UPDATE "PatientOdontogram"
SET
  "initialSnapshot" = "currentSnapshot",
  "initialUpdatedAt" = "updatedAt",
  "currentUpdatedAt" = "updatedAt";

ALTER TABLE "PatientOdontogram"
ALTER COLUMN "initialSnapshot" SET NOT NULL,
ALTER COLUMN "initialUpdatedAt" SET NOT NULL,
ALTER COLUMN "initialUpdatedAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "currentUpdatedAt" SET NOT NULL,
ALTER COLUMN "currentUpdatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PatientOdontogramRevision"
ADD COLUMN "stage" "OdontogramStage" NOT NULL DEFAULT 'CURRENT';

DROP INDEX "PatientOdontogramRevision_odontogramId_revision_key";

CREATE UNIQUE INDEX "PatientOdontogramRevision_odontogramId_stage_revision_key"
ON "PatientOdontogramRevision"("odontogramId", "stage", "revision");

INSERT INTO "PatientOdontogramRevision" (
  "id",
  "organizationId",
  "clinicId",
  "patientId",
  "odontogramId",
  "stage",
  "revision",
  "snapshot",
  "createdById",
  "createdAt"
)
SELECT
  'migrated_initial_' || odontogram.id,
  odontogram."organizationId",
  odontogram."clinicId",
  odontogram."patientId",
  odontogram.id,
  'INITIAL',
  odontogram."initialRevision",
  odontogram."initialSnapshot",
  odontogram."updatedById",
  odontogram."initialUpdatedAt"
FROM "PatientOdontogram" odontogram
ON CONFLICT ("odontogramId", "stage", "revision") DO NOTHING;

ALTER TABLE "PatientOdontogram"
ADD CONSTRAINT "PatientOdontogram_revision_ranges_check"
CHECK (
  "initialRevision" >= 1
  AND "expectedRevision" >= 0
  AND "currentRevision" >= 1
  AND (
    ("expectedSnapshot" IS NULL AND "expectedRevision" = 0)
    OR ("expectedSnapshot" IS NOT NULL AND "expectedRevision" >= 1)
  )
);
