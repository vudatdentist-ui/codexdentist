CREATE TABLE "PayrollPolicy" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clinicId" TEXT,
  "scopeKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "includeBaseSalary" BOOLEAN NOT NULL DEFAULT true,
  "standardWorkdays" INTEGER NOT NULL DEFAULT 26,
  "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "insurancePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "otherDeductionAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PayrollPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollPolicy_organizationId_scopeKey_key" ON "PayrollPolicy"("organizationId", "scopeKey");
CREATE INDEX "PayrollPolicy_clinicId_idx" ON "PayrollPolicy"("clinicId");
CREATE INDEX "PayrollPolicy_organizationId_active_idx" ON "PayrollPolicy"("organizationId", "active");

ALTER TABLE "PayrollPolicy"
  ADD CONSTRAINT "PayrollPolicy_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayrollPolicy"
  ADD CONSTRAINT "PayrollPolicy_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
