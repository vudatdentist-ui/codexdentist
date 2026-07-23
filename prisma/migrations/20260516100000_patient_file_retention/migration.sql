ALTER TABLE "PatientFile" ADD COLUMN "retentionUntil" TIMESTAMP(3);

CREATE INDEX "PatientFile_organizationId_retentionUntil_idx" ON "PatientFile"("organizationId", "retentionUntil");
