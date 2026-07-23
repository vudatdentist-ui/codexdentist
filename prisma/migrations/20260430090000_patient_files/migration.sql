CREATE TABLE "PatientFile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "uploadedById" TEXT,
  "category" TEXT NOT NULL DEFAULT 'CLINICAL_IMAGE',
  "title" TEXT NOT NULL,
  "fileName" TEXT,
  "mimeType" TEXT,
  "url" TEXT NOT NULL,
  "sizeBytes" INTEGER,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientFile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PatientFile" ADD CONSTRAINT "PatientFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientFile" ADD CONSTRAINT "PatientFile_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientFile" ADD CONSTRAINT "PatientFile_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientFile" ADD CONSTRAINT "PatientFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PatientFile_patientId_createdAt_idx" ON "PatientFile"("patientId", "createdAt");
CREATE INDEX "PatientFile_clinicId_createdAt_idx" ON "PatientFile"("clinicId", "createdAt");
CREATE INDEX "PatientFile_organizationId_category_idx" ON "PatientFile"("organizationId", "category");
