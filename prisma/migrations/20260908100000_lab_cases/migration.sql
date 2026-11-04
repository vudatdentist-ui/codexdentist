CREATE TABLE "LabCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "treatmentServiceId" TEXT,
    "caseNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "laboratoryName" TEXT,
    "workType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dueAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LabCase_org_case_no_key"
    ON "LabCase" ("organizationId", "caseNo");
CREATE INDEX "LabCase_org_clinic_status_due_idx"
    ON "LabCase" ("organizationId", "clinicId", "status", "dueAt");
CREATE INDEX "LabCase_patient_created_idx"
    ON "LabCase" ("patientId", "createdAt");
CREATE INDEX "LabCase_treatment_service_idx"
    ON "LabCase" ("treatmentServiceId");

ALTER TABLE "LabCase"
    ADD CONSTRAINT "LabCase_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "LabCase_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "LabCase_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "LabCase_treatmentServiceId_fkey"
    FOREIGN KEY ("treatmentServiceId") REFERENCES "TreatmentService"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "LabCase_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
