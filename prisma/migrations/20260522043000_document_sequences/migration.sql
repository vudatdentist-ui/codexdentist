-- DocumentSequence provides atomic, tenant-scoped document number allocation.
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT 'organization',
    "type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentSequence_organizationId_scopeKey_type_year_key" ON "DocumentSequence"("organizationId", "scopeKey", "type", "year");
CREATE INDEX "DocumentSequence_clinicId_type_year_idx" ON "DocumentSequence"("clinicId", "type", "year");

ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
