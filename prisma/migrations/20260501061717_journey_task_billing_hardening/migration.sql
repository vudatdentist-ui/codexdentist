-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "createdById" TEXT,
    "planNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPlanInstallment" (
    "id" TEXT NOT NULL,
    "paymentPlanId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "paidAt" TIMESTAMP(3),
    "notificationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentPlanInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientJourneyState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "treatmentGoal" TEXT,
    "treatmentPlan" TEXT,
    "odontogramTeeth" TEXT[],
    "odontogramSnapshot" JSONB,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientJourneyState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "attachmentName" TEXT,
    "attachmentMime" TEXT,
    "patientFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneyComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "patientId" TEXT,
    "assignedToId" TEXT,
    "createdById" TEXT,
    "completedById" TEXT,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPlan_planNo_key" ON "PaymentPlan"("planNo");

-- CreateIndex
CREATE INDEX "PaymentPlan_clinicId_status_idx" ON "PaymentPlan"("clinicId", "status");

-- CreateIndex
CREATE INDEX "PaymentPlan_patientId_status_idx" ON "PaymentPlan"("patientId", "status");

-- CreateIndex
CREATE INDEX "PaymentPlanInstallment_dueAt_status_idx" ON "PaymentPlanInstallment"("dueAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPlanInstallment_paymentPlanId_sequence_key" ON "PaymentPlanInstallment"("paymentPlanId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PatientJourneyState_patientId_key" ON "PatientJourneyState"("patientId");

-- CreateIndex
CREATE INDEX "PatientJourneyState_clinicId_updatedAt_idx" ON "PatientJourneyState"("clinicId", "updatedAt");

-- CreateIndex
CREATE INDEX "PatientJourneyState_organizationId_updatedAt_idx" ON "PatientJourneyState"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "JourneyComment_patientId_createdAt_idx" ON "JourneyComment"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "JourneyComment_clinicId_createdAt_idx" ON "JourneyComment"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "JourneyComment_organizationId_createdAt_idx" ON "JourneyComment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkItem_organizationId_status_dueAt_idx" ON "WorkItem"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "WorkItem_clinicId_status_dueAt_idx" ON "WorkItem"("clinicId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "WorkItem_assignedToId_status_dueAt_idx" ON "WorkItem"("assignedToId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "WorkItem_patientId_createdAt_idx" ON "WorkItem"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkItem_sourceKind_sourceId_idx" ON "WorkItem"("sourceKind", "sourceId");

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlanInstallment" ADD CONSTRAINT "PaymentPlanInstallment_paymentPlanId_fkey" FOREIGN KEY ("paymentPlanId") REFERENCES "PaymentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientJourneyState" ADD CONSTRAINT "PatientJourneyState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientJourneyState" ADD CONSTRAINT "PatientJourneyState_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientJourneyState" ADD CONSTRAINT "PatientJourneyState_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientJourneyState" ADD CONSTRAINT "PatientJourneyState_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyComment" ADD CONSTRAINT "JourneyComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyComment" ADD CONSTRAINT "JourneyComment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyComment" ADD CONSTRAINT "JourneyComment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyComment" ADD CONSTRAINT "JourneyComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
