CREATE TABLE "PatientOdontogram" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientOdontogram_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PatientOdontogramRevision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "odontogramId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientOdontogramRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientOdontogram_patientId_key"
ON "PatientOdontogram"("patientId");

CREATE INDEX "PatientOdontogram_clinicId_updatedAt_idx"
ON "PatientOdontogram"("clinicId", "updatedAt");

CREATE INDEX "PatientOdontogram_organizationId_updatedAt_idx"
ON "PatientOdontogram"("organizationId", "updatedAt");

CREATE UNIQUE INDEX "PatientOdontogramRevision_odontogramId_revision_key"
ON "PatientOdontogramRevision"("odontogramId", "revision");

CREATE INDEX "PatientOdontogramRevision_patientId_createdAt_idx"
ON "PatientOdontogramRevision"("patientId", "createdAt");

CREATE INDEX "PatientOdontogramRevision_clinicId_createdAt_idx"
ON "PatientOdontogramRevision"("clinicId", "createdAt");

CREATE INDEX "PatientOdontogramRevision_organizationId_createdAt_idx"
ON "PatientOdontogramRevision"("organizationId", "createdAt");

ALTER TABLE "PatientOdontogram"
ADD CONSTRAINT "PatientOdontogram_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientOdontogram"
ADD CONSTRAINT "PatientOdontogram_clinicId_fkey"
FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientOdontogram"
ADD CONSTRAINT "PatientOdontogram_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientOdontogram"
ADD CONSTRAINT "PatientOdontogram_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PatientOdontogramRevision"
ADD CONSTRAINT "PatientOdontogramRevision_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientOdontogramRevision"
ADD CONSTRAINT "PatientOdontogramRevision_clinicId_fkey"
FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientOdontogramRevision"
ADD CONSTRAINT "PatientOdontogramRevision_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientOdontogramRevision"
ADD CONSTRAINT "PatientOdontogramRevision_odontogramId_fkey"
FOREIGN KEY ("odontogramId") REFERENCES "PatientOdontogram"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientOdontogramRevision"
ADD CONSTRAINT "PatientOdontogramRevision_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
