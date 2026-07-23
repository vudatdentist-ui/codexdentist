-- CreateEnum
CREATE TYPE "TreatmentServiceStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceCompensationPool" AS ENUM ('DOCTOR', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ServiceCompensationRole" AS ENUM ('CONSULTANT', 'OPERATOR', 'CLINICAL_SUPPORT', 'ASSISTANT_PRIMARY', 'ASSISTANT_SECONDARY');

-- CreateEnum
CREATE TYPE "CompensationAccrualStatus" AS ENUM ('EARNED', 'APPROVED', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "ServiceCompensationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCompensationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCompensationPoolRule" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "pool" "ServiceCompensationPool" NOT NULL,
    "percentOfService" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCompensationPoolRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCompensationShare" (
    "id" TEXT NOT NULL,
    "poolRuleId" TEXT NOT NULL,
    "role" "ServiceCompensationRole" NOT NULL,
    "sharePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "fallbackRole" "ServiceCompensationRole",
    "required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCompensationShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentService" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "treatmentPlanId" TEXT,
    "serviceCatalogItemId" TEXT,
    "createdById" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "targetSummary" TEXT,
    "teeth" TEXT[],
    "status" "TreatmentServiceStatus" NOT NULL DEFAULT 'PLANNED',
    "finalPrice" DECIMAL(12,2) NOT NULL,
    "currentProgressPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "currentStepSequence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentServiceProgressEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "treatmentServiceId" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "clinicalSupportId" TEXT,
    "assistantPrimaryId" TEXT,
    "assistantSecondaryId" TEXT,
    "fromProgressPercent" DECIMAL(5,2) NOT NULL,
    "toProgressPercent" DECIMAL(5,2) NOT NULL,
    "progressDeltaPercent" DECIMAL(5,2) NOT NULL,
    "fromStepSequence" INTEGER,
    "toStepSequence" INTEGER,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentServiceProgressEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompensationAccrual" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "treatmentServiceId" TEXT NOT NULL,
    "progressEventId" TEXT NOT NULL,
    "ruleId" TEXT,
    "payrollRunId" TEXT,
    "status" "CompensationAccrualStatus" NOT NULL DEFAULT 'EARNED',
    "serviceAmount" DECIMAL(12,2) NOT NULL,
    "earnedProgressPercent" DECIMAL(5,2) NOT NULL,
    "doctorPoolAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "assistantPoolAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompensationAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompensationAccrualLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "accrualId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payrollLineId" TEXT,
    "pool" "ServiceCompensationPool" NOT NULL,
    "role" "ServiceCompensationRole" NOT NULL,
    "sharePercent" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "resolvedFromFallback" BOOLEAN NOT NULL DEFAULT false,
    "sourceRole" "ServiceCompensationRole",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompensationAccrualLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceCompensationRule_organizationId_active_idx" ON "ServiceCompensationRule"("organizationId", "active");

-- CreateIndex
CREATE INDEX "ServiceCompensationRule_serviceId_active_idx" ON "ServiceCompensationRule"("serviceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCompensationRule_organizationId_code_version_key" ON "ServiceCompensationRule"("organizationId", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCompensationPoolRule_ruleId_pool_key" ON "ServiceCompensationPoolRule"("ruleId", "pool");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCompensationShare_poolRuleId_role_key" ON "ServiceCompensationShare"("poolRuleId", "role");

-- CreateIndex
CREATE INDEX "TreatmentService_clinicId_status_idx" ON "TreatmentService"("clinicId", "status");

-- CreateIndex
CREATE INDEX "TreatmentService_patientId_createdAt_idx" ON "TreatmentService"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "TreatmentService_serviceCatalogItemId_idx" ON "TreatmentService"("serviceCatalogItemId");

-- CreateIndex
CREATE INDEX "TreatmentService_createdById_idx" ON "TreatmentService"("createdById");

-- CreateIndex
CREATE INDEX "TreatmentServiceProgressEvent_clinicId_occurredAt_idx" ON "TreatmentServiceProgressEvent"("clinicId", "occurredAt");

-- CreateIndex
CREATE INDEX "TreatmentServiceProgressEvent_treatmentServiceId_occurredAt_idx" ON "TreatmentServiceProgressEvent"("treatmentServiceId", "occurredAt");

-- CreateIndex
CREATE INDEX "TreatmentServiceProgressEvent_performedById_occurredAt_idx" ON "TreatmentServiceProgressEvent"("performedById", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompensationAccrual_progressEventId_key" ON "CompensationAccrual"("progressEventId");

-- CreateIndex
CREATE INDEX "CompensationAccrual_clinicId_status_idx" ON "CompensationAccrual"("clinicId", "status");

-- CreateIndex
CREATE INDEX "CompensationAccrual_treatmentServiceId_idx" ON "CompensationAccrual"("treatmentServiceId");

-- CreateIndex
CREATE INDEX "CompensationAccrual_payrollRunId_idx" ON "CompensationAccrual"("payrollRunId");

-- CreateIndex
CREATE INDEX "CompensationAccrualLine_clinicId_createdAt_idx" ON "CompensationAccrualLine"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "CompensationAccrualLine_userId_createdAt_idx" ON "CompensationAccrualLine"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CompensationAccrualLine_payrollLineId_idx" ON "CompensationAccrualLine"("payrollLineId");

-- AddForeignKey
ALTER TABLE "ServiceCompensationRule" ADD CONSTRAINT "ServiceCompensationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCompensationRule" ADD CONSTRAINT "ServiceCompensationRule_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCompensationPoolRule" ADD CONSTRAINT "ServiceCompensationPoolRule_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ServiceCompensationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCompensationShare" ADD CONSTRAINT "ServiceCompensationShare_poolRuleId_fkey" FOREIGN KEY ("poolRuleId") REFERENCES "ServiceCompensationPoolRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentService" ADD CONSTRAINT "TreatmentService_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentService" ADD CONSTRAINT "TreatmentService_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentService" ADD CONSTRAINT "TreatmentService_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentService" ADD CONSTRAINT "TreatmentService_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "TreatmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentService" ADD CONSTRAINT "TreatmentService_serviceCatalogItemId_fkey" FOREIGN KEY ("serviceCatalogItemId") REFERENCES "ServiceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentService" ADD CONSTRAINT "TreatmentService_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentServiceProgressEvent" ADD CONSTRAINT "TreatmentServiceProgressEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentServiceProgressEvent" ADD CONSTRAINT "TreatmentServiceProgressEvent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentServiceProgressEvent" ADD CONSTRAINT "TreatmentServiceProgressEvent_treatmentServiceId_fkey" FOREIGN KEY ("treatmentServiceId") REFERENCES "TreatmentService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentServiceProgressEvent" ADD CONSTRAINT "TreatmentServiceProgressEvent_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentServiceProgressEvent" ADD CONSTRAINT "TreatmentServiceProgressEvent_clinicalSupportId_fkey" FOREIGN KEY ("clinicalSupportId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentServiceProgressEvent" ADD CONSTRAINT "TreatmentServiceProgressEvent_assistantPrimaryId_fkey" FOREIGN KEY ("assistantPrimaryId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentServiceProgressEvent" ADD CONSTRAINT "TreatmentServiceProgressEvent_assistantSecondaryId_fkey" FOREIGN KEY ("assistantSecondaryId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationAccrual" ADD CONSTRAINT "CompensationAccrual_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationAccrual" ADD CONSTRAINT "CompensationAccrual_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationAccrual" ADD CONSTRAINT "CompensationAccrual_treatmentServiceId_fkey" FOREIGN KEY ("treatmentServiceId") REFERENCES "TreatmentService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationAccrual" ADD CONSTRAINT "CompensationAccrual_progressEventId_fkey" FOREIGN KEY ("progressEventId") REFERENCES "TreatmentServiceProgressEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationAccrual" ADD CONSTRAINT "CompensationAccrual_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ServiceCompensationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationAccrual" ADD CONSTRAINT "CompensationAccrual_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationAccrualLine" ADD CONSTRAINT "CompensationAccrualLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationAccrualLine" ADD CONSTRAINT "CompensationAccrualLine_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationAccrualLine" ADD CONSTRAINT "CompensationAccrualLine_accrualId_fkey" FOREIGN KEY ("accrualId") REFERENCES "CompensationAccrual"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationAccrualLine" ADD CONSTRAINT "CompensationAccrualLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationAccrualLine" ADD CONSTRAINT "CompensationAccrualLine_payrollLineId_fkey" FOREIGN KEY ("payrollLineId") REFERENCES "PayrollLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
