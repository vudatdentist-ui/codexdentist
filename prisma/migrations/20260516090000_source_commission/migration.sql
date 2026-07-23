-- Source commission policy and accrual foundation
CREATE TABLE "SourceCommissionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerLabel" TEXT,
    "ratePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "fixedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monthlyBudget" DECIMAL(12,2),
    "trigger" TEXT NOT NULL DEFAULT 'COLLECTION_RECEIVED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SourceCommissionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceCommissionAccrual" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "baseAmount" DECIMAL(12,2) NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "fixedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EARNED',
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SourceCommissionAccrual_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceCommissionPolicy_organizationId_source_key" ON "SourceCommissionPolicy"("organizationId", "source");
CREATE INDEX "SourceCommissionPolicy_organizationId_active_idx" ON "SourceCommissionPolicy"("organizationId", "active");
CREATE UNIQUE INDEX "SourceCommissionAccrual_receiptId_policyId_key" ON "SourceCommissionAccrual"("receiptId", "policyId");
CREATE INDEX "SourceCommissionAccrual_organizationId_source_status_idx" ON "SourceCommissionAccrual"("organizationId", "source", "status");
CREATE INDEX "SourceCommissionAccrual_clinicId_earnedAt_idx" ON "SourceCommissionAccrual"("clinicId", "earnedAt");
CREATE INDEX "SourceCommissionAccrual_patientId_idx" ON "SourceCommissionAccrual"("patientId");

ALTER TABLE "SourceCommissionPolicy" ADD CONSTRAINT "SourceCommissionPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceCommissionAccrual" ADD CONSTRAINT "SourceCommissionAccrual_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceCommissionAccrual" ADD CONSTRAINT "SourceCommissionAccrual_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceCommissionAccrual" ADD CONSTRAINT "SourceCommissionAccrual_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceCommissionAccrual" ADD CONSTRAINT "SourceCommissionAccrual_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceCommissionAccrual" ADD CONSTRAINT "SourceCommissionAccrual_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SourceCommissionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
