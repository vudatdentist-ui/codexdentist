CREATE TABLE "ImagingStudy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'orthanc',
    "externalStudyId" TEXT NOT NULL,
    "externalPatientId" TEXT,
    "studyInstanceUid" TEXT,
    "accessionNumber" TEXT,
    "modalities" TEXT[] NOT NULL,
    "studyDate" TIMESTAMP(3),
    "description" TEXT,
    "availability" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagingStudy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImagingStudy_org_connection_external_key"
    ON "ImagingStudy" ("organizationId", "connectionId", "externalStudyId");
CREATE INDEX "ImagingStudy_org_clinic_patient_date_idx"
    ON "ImagingStudy" ("organizationId", "clinicId", "patientId", "studyDate");
CREATE INDEX "ImagingStudy_patient_created_idx"
    ON "ImagingStudy" ("patientId", "createdAt");
CREATE INDEX "ImagingStudy_connection_external_patient_idx"
    ON "ImagingStudy" ("connectionId", "externalPatientId");

ALTER TABLE "ImagingStudy"
    ADD CONSTRAINT "ImagingStudy_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ImagingStudy_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ImagingStudy_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ImagingStudy_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
