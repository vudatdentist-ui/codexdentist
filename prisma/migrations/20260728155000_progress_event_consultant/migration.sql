ALTER TABLE "TreatmentServiceProgressEvent"
ADD COLUMN "consultantId" TEXT;

CREATE INDEX "TreatmentServiceProgressEvent_consultantId_occurredAt_idx"
ON "TreatmentServiceProgressEvent"("consultantId", "occurredAt");

ALTER TABLE "TreatmentServiceProgressEvent"
ADD CONSTRAINT "TreatmentServiceProgressEvent_consultantId_fkey"
FOREIGN KEY ("consultantId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
