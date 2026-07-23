CREATE TABLE "AccountingCategory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameEn" TEXT,
  "kind" TEXT NOT NULL,
  "targetPercent" DECIMAL(5,2),
  "warningPercent" DECIMAL(5,2),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clinicId" TEXT,
  "categoryId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "vendor" TEXT,
  "description" TEXT NOT NULL,
  "paymentMethod" TEXT,
  "reference" TEXT,
  "sourceType" TEXT NOT NULL DEFAULT 'manual',
  "sourceId" TEXT,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingBudgetTarget" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clinicId" TEXT,
  "categoryId" TEXT NOT NULL,
  "periodMonth" TEXT NOT NULL,
  "targetPercent" DECIMAL(5,2) NOT NULL,
  "warningPercent" DECIMAL(5,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingBudgetTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountingCategory_organizationId_code_key" ON "AccountingCategory"("organizationId", "code");
CREATE INDEX "AccountingCategory_organizationId_kind_active_idx" ON "AccountingCategory"("organizationId", "kind", "active");
CREATE INDEX "AccountingEntry_organizationId_occurredAt_idx" ON "AccountingEntry"("organizationId", "occurredAt");
CREATE INDEX "AccountingEntry_clinicId_occurredAt_idx" ON "AccountingEntry"("clinicId", "occurredAt");
CREATE INDEX "AccountingEntry_categoryId_occurredAt_idx" ON "AccountingEntry"("categoryId", "occurredAt");
CREATE INDEX "AccountingEntry_sourceType_sourceId_idx" ON "AccountingEntry"("sourceType", "sourceId");
CREATE UNIQUE INDEX "AccountingBudgetTarget_organizationId_clinicId_categoryId_periodMonth_key" ON "AccountingBudgetTarget"("organizationId", "clinicId", "categoryId", "periodMonth");
CREATE INDEX "AccountingBudgetTarget_organizationId_periodMonth_idx" ON "AccountingBudgetTarget"("organizationId", "periodMonth");

ALTER TABLE "AccountingCategory" ADD CONSTRAINT "AccountingCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AccountingCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountingBudgetTarget" ADD CONSTRAINT "AccountingBudgetTarget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingBudgetTarget" ADD CONSTRAINT "AccountingBudgetTarget_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountingBudgetTarget" ADD CONSTRAINT "AccountingBudgetTarget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AccountingCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
