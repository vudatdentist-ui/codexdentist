-- CreateEnum
CREATE TYPE "StaffShiftStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CONSULT_BOOKED', 'VISITED', 'CONVERTED', 'LOST', 'RECALL');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('CALL', 'ZALO', 'SMS', 'EMAIL', 'NOTE', 'TASK', 'VISIT', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'CONSUMPTION', 'ADJUSTMENT', 'WASTE', 'RETURN');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'RETIRED', 'LOST');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('DRAFT', 'SIGNED', 'DISPENSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FormTemplateType" AS ENUM ('CONSENT', 'INTAKE', 'MEDICAL_HISTORY', 'POST_OP', 'FINANCIAL_POLICY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PatientFormStatus" AS ENUM ('DRAFT', 'SENT', 'COMPLETED', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "LearningContentType" AS ENUM ('BOOK', 'ARTICLE', 'VIDEO', 'COURSE', 'CHECKLIST', 'POLICY');

-- CreateEnum
CREATE TYPE "LearningEnrollmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MobileAppType" AS ENUM ('PATIENT', 'STAFF');

-- CreateEnum
CREATE TYPE "MobilePlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'ZALO', 'PUSH', 'IN_APP', 'PHONE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "employeeCode" TEXT NOT NULL,
    "title" TEXT,
    "department" TEXT,
    "contractType" TEXT NOT NULL DEFAULT 'FULL_TIME',
    "baseSalary" DECIMAL(12,2),
    "commissionRate" DECIMAL(5,2),
    "hireDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffShift" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "status" "StaffShiftStatus" NOT NULL DEFAULT 'SCHEDULED',
    "roleOnShift" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockOutAt" TIMESTAMP(3),
    "outStatus" TEXT,
    "source" "MobileAppType" NOT NULL DEFAULT 'STAFF',
    "note" TEXT,
    "adjusted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "staffProfileId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'REQUESTED',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(8,2),
    "reason" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductionAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "baseAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonusAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductionAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "patientId" TEXT,
    "ownerId" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "campaignName" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "audience" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "budgetAmount" DECIMAL(12,2),
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "patientId" TEXT,
    "leadId" TEXT,
    "campaignId" TEXT,
    "actorId" TEXT,
    "type" "CrmActivityType" NOT NULL,
    "channel" "NotificationChannel",
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationThread" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "patientId" TEXT,
    "leadId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "direction" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" TEXT[],
    "externalId" TEXT,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySupplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "supplierId" TEXT,
    "code" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "minimumStock" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "onHandQuantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "averageUnitCost" DECIMAL(12,2),
    "lotTracked" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "itemId" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantityOnHand" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "performedById" TEXT,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,2),
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "supplierId" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "orderedAt" TIMESTAMP(3),
    "expectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "receivedQuantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "serialNo" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "cost" DECIMAL(12,2),
    "warrantyEndsAt" TIMESTAMP(3),
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "assetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cost" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationCatalogItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "brandName" TEXT,
    "strength" TEXT,
    "form" TEXT,
    "defaultSig" TEXT,
    "defaultDose" TEXT,
    "route" TEXT,
    "frequency" TEXT,
    "warnings" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicationCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "createdById" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "diagnosis" TEXT,
    "instructions" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "medicationId" TEXT,
    "drugName" TEXT NOT NULL,
    "sig" TEXT NOT NULL,
    "quantity" TEXT,
    "refills" INTEGER NOT NULL DEFAULT 0,
    "durationDays" INTEGER,
    "instructions" TEXT,

    CONSTRAINT "PrescriptionTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "prescriberId" TEXT NOT NULL,
    "prescriptionNo" TEXT NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "diagnosis" TEXT,
    "notes" TEXT,
    "signedAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionItem" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "medicationId" TEXT,
    "drugName" TEXT NOT NULL,
    "strength" TEXT,
    "sig" TEXT NOT NULL,
    "quantity" TEXT,
    "refills" INTEGER NOT NULL DEFAULT 0,
    "durationDays" INTEGER,
    "instructions" TEXT,

    CONSTRAINT "PrescriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "createdById" TEXT,
    "type" "FormTemplateType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "body" TEXT,
    "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientForm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "patientId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "requestedById" TEXT,
    "formNo" TEXT NOT NULL,
    "status" "PatientFormStatus" NOT NULL DEFAULT 'DRAFT',
    "responses" JSONB,
    "signatureUrl" TEXT,
    "attachments" TEXT[],
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningContent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "authorId" TEXT,
    "code" TEXT NOT NULL,
    "type" "LearningContentType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT,
    "mediaUrl" TEXT,
    "durationMinutes" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "contentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "status" "LearningEnrollmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "score" DECIMAL(5,2),

    CONSTRAINT "LearningEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "patientId" TEXT,
    "appType" "MobileAppType" NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "deviceId" TEXT NOT NULL,
    "pushToken" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "patientId" TEXT,
    "userId" TEXT,
    "campaignId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'DRAFT',
    "templateKey" TEXT,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_userId_key" ON "StaffProfile"("userId");

-- CreateIndex
CREATE INDEX "StaffProfile_clinicId_idx" ON "StaffProfile"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_organizationId_employeeCode_key" ON "StaffProfile"("organizationId", "employeeCode");

-- CreateIndex
CREATE INDEX "StaffShift_clinicId_startsAt_idx" ON "StaffShift"("clinicId", "startsAt");

-- CreateIndex
CREATE INDEX "StaffShift_staffProfileId_startsAt_idx" ON "StaffShift"("staffProfileId", "startsAt");

-- CreateIndex
CREATE INDEX "AttendanceLog_clinicId_clockInAt_idx" ON "AttendanceLog"("clinicId", "clockInAt");

-- CreateIndex
CREATE INDEX "AttendanceLog_staffProfileId_clockInAt_idx" ON "AttendanceLog"("staffProfileId", "clockInAt");

-- CreateIndex
CREATE INDEX "LeaveRequest_organizationId_status_idx" ON "LeaveRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_staffProfileId_startsAt_idx" ON "LeaveRequest"("staffProfileId", "startsAt");

-- CreateIndex
CREATE INDEX "PayrollRun_organizationId_periodStart_periodEnd_idx" ON "PayrollRun"("organizationId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "PayrollRun_clinicId_periodStart_idx" ON "PayrollRun"("clinicId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLine_payrollRunId_staffProfileId_key" ON "PayrollLine"("payrollRunId", "staffProfileId");

-- CreateIndex
CREATE INDEX "CrmLead_organizationId_status_idx" ON "CrmLead"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CrmLead_clinicId_nextFollowUpAt_idx" ON "CrmLead"("clinicId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "CrmLead_patientId_idx" ON "CrmLead"("patientId");

-- CreateIndex
CREATE INDEX "CrmCampaign_organizationId_status_idx" ON "CrmCampaign"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCampaign_organizationId_code_key" ON "CrmCampaign"("organizationId", "code");

-- CreateIndex
CREATE INDEX "CrmActivity_organizationId_dueAt_idx" ON "CrmActivity"("organizationId", "dueAt");

-- CreateIndex
CREATE INDEX "CrmActivity_patientId_idx" ON "CrmActivity"("patientId");

-- CreateIndex
CREATE INDEX "CrmActivity_leadId_idx" ON "CrmActivity"("leadId");

-- CreateIndex
CREATE INDEX "CommunicationThread_organizationId_updatedAt_idx" ON "CommunicationThread"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "CommunicationThread_patientId_idx" ON "CommunicationThread"("patientId");

-- CreateIndex
CREATE INDEX "CommunicationThread_leadId_idx" ON "CommunicationThread"("leadId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_threadId_createdAt_idx" ON "CommunicationMessage"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventorySupplier_organizationId_code_key" ON "InventorySupplier"("organizationId", "code");

-- CreateIndex
CREATE INDEX "InventoryItem_clinicId_category_idx" ON "InventoryItem"("clinicId", "category");

-- CreateIndex
CREATE INDEX "InventoryItem_supplierId_idx" ON "InventoryItem"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_organizationId_code_key" ON "InventoryItem"("organizationId", "code");

-- CreateIndex
CREATE INDEX "InventoryLot_clinicId_expiresAt_idx" ON "InventoryLot"("clinicId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_itemId_lotNo_key" ON "InventoryLot"("itemId", "lotNo");

-- CreateIndex
CREATE INDEX "InventoryMovement_clinicId_createdAt_idx" ON "InventoryMovement"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_itemId_createdAt_idx" ON "InventoryMovement"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_clinicId_status_idx" ON "PurchaseOrder"("clinicId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_poNo_key" ON "PurchaseOrder"("organizationId", "poNo");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_itemId_key" ON "PurchaseOrderLine"("purchaseOrderId", "itemId");

-- CreateIndex
CREATE INDEX "EquipmentAsset_clinicId_status_idx" ON "EquipmentAsset"("clinicId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentAsset_organizationId_code_key" ON "EquipmentAsset"("organizationId", "code");

-- CreateIndex
CREATE INDEX "MaintenanceTask_clinicId_dueAt_idx" ON "MaintenanceTask"("clinicId", "dueAt");

-- CreateIndex
CREATE INDEX "MaintenanceTask_assetId_dueAt_idx" ON "MaintenanceTask"("assetId", "dueAt");

-- CreateIndex
CREATE INDEX "MedicationCatalogItem_organizationId_genericName_idx" ON "MedicationCatalogItem"("organizationId", "genericName");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationCatalogItem_organizationId_code_key" ON "MedicationCatalogItem"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PrescriptionTemplate_clinicId_idx" ON "PrescriptionTemplate"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionTemplate_organizationId_code_key" ON "PrescriptionTemplate"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PrescriptionTemplateItem_templateId_idx" ON "PrescriptionTemplateItem"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_prescriptionNo_key" ON "Prescription"("prescriptionNo");

-- CreateIndex
CREATE INDEX "Prescription_clinicId_createdAt_idx" ON "Prescription"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "Prescription_patientId_createdAt_idx" ON "Prescription"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PrescriptionItem_prescriptionId_idx" ON "PrescriptionItem"("prescriptionId");

-- CreateIndex
CREATE INDEX "FormTemplate_clinicId_type_idx" ON "FormTemplate"("clinicId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "FormTemplate_organizationId_code_version_key" ON "FormTemplate"("organizationId", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PatientForm_formNo_key" ON "PatientForm"("formNo");

-- CreateIndex
CREATE INDEX "PatientForm_patientId_status_idx" ON "PatientForm"("patientId", "status");

-- CreateIndex
CREATE INDEX "PatientForm_clinicId_status_idx" ON "PatientForm"("clinicId", "status");

-- CreateIndex
CREATE INDEX "LearningContent_clinicId_type_idx" ON "LearningContent"("clinicId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LearningContent_organizationId_code_key" ON "LearningContent"("organizationId", "code");

-- CreateIndex
CREATE INDEX "LearningEnrollment_clinicId_status_idx" ON "LearningEnrollment"("clinicId", "status");

-- CreateIndex
CREATE INDEX "LearningEnrollment_userId_status_idx" ON "LearningEnrollment"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LearningEnrollment_contentId_userId_key" ON "LearningEnrollment"("contentId", "userId");

-- CreateIndex
CREATE INDEX "MobileDevice_userId_appType_idx" ON "MobileDevice"("userId", "appType");

-- CreateIndex
CREATE INDEX "MobileDevice_patientId_appType_idx" ON "MobileDevice"("patientId", "appType");

-- CreateIndex
CREATE UNIQUE INDEX "MobileDevice_organizationId_deviceId_key" ON "MobileDevice"("organizationId", "deviceId");

-- CreateIndex
CREATE INDEX "Notification_organizationId_status_idx" ON "Notification"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Notification_patientId_createdAt_idx" ON "Notification"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCampaign" ADD CONSTRAINT "CrmCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCampaign" ADD CONSTRAINT "CrmCampaign_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CrmCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunicationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySupplier" ADD CONSTRAINT "InventorySupplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "InventorySupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "InventorySupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAsset" ADD CONSTRAINT "EquipmentAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAsset" ADD CONSTRAINT "EquipmentAsset_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EquipmentAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationCatalogItem" ADD CONSTRAINT "MedicationCatalogItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionTemplate" ADD CONSTRAINT "PrescriptionTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionTemplate" ADD CONSTRAINT "PrescriptionTemplate_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionTemplate" ADD CONSTRAINT "PrescriptionTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionTemplateItem" ADD CONSTRAINT "PrescriptionTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PrescriptionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionTemplateItem" ADD CONSTRAINT "PrescriptionTemplateItem_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "MedicationCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_prescriberId_fkey" FOREIGN KEY ("prescriberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "MedicationCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientForm" ADD CONSTRAINT "PatientForm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientForm" ADD CONSTRAINT "PatientForm_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientForm" ADD CONSTRAINT "PatientForm_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientForm" ADD CONSTRAINT "PatientForm_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientForm" ADD CONSTRAINT "PatientForm_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningContent" ADD CONSTRAINT "LearningContent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningContent" ADD CONSTRAINT "LearningContent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningContent" ADD CONSTRAINT "LearningContent_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningEnrollment" ADD CONSTRAINT "LearningEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningEnrollment" ADD CONSTRAINT "LearningEnrollment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningEnrollment" ADD CONSTRAINT "LearningEnrollment_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningEnrollment" ADD CONSTRAINT "LearningEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningEnrollment" ADD CONSTRAINT "LearningEnrollment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CrmCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
