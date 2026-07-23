-- CreateEnum
CREATE TYPE "ServiceCatalogStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCatalogItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "status" "ServiceCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "defaultPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "defaultDurationMinutes" INTEGER,
    "targetMode" TEXT NOT NULL DEFAULT 'TOOTH',
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "consentRequired" BOOLEAN NOT NULL DEFAULT false,
    "clinicalTemplate" TEXT,
    "version" TEXT NOT NULL DEFAULT '1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "expectedMinutes" INTEGER,
    "defaultProgress" INTEGER,
    "roleHint" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePrice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "serviceId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "version" TEXT NOT NULL DEFAULT '1',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceMaterial" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "itemCode" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,2),
    "unit" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceMedication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "medicationId" TEXT,
    "drugName" TEXT NOT NULL,
    "timing" TEXT,
    "instructions" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceMedication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceCategory_organizationId_active_idx" ON "ServiceCategory"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_organizationId_code_key" ON "ServiceCategory"("organizationId", "code");

-- CreateIndex
CREATE INDEX "ServiceCatalogItem_organizationId_status_idx" ON "ServiceCatalogItem"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ServiceCatalogItem_categoryId_idx" ON "ServiceCatalogItem"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCatalogItem_organizationId_code_key" ON "ServiceCatalogItem"("organizationId", "code");

-- CreateIndex
CREATE INDEX "ServiceStep_organizationId_idx" ON "ServiceStep"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceStep_serviceId_sequence_key" ON "ServiceStep"("serviceId", "sequence");

-- CreateIndex
CREATE INDEX "ServicePrice_clinicId_active_idx" ON "ServicePrice"("clinicId", "active");

-- CreateIndex
CREATE INDEX "ServicePrice_serviceId_active_idx" ON "ServicePrice"("serviceId", "active");

-- CreateIndex
CREATE INDEX "ServicePrice_organizationId_effectiveFrom_idx" ON "ServicePrice"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ServiceMaterial_serviceId_idx" ON "ServiceMaterial"("serviceId");

-- CreateIndex
CREATE INDEX "ServiceMaterial_inventoryItemId_idx" ON "ServiceMaterial"("inventoryItemId");

-- CreateIndex
CREATE INDEX "ServiceMedication_serviceId_idx" ON "ServiceMedication"("serviceId");

-- CreateIndex
CREATE INDEX "ServiceMedication_medicationId_idx" ON "ServiceMedication"("medicationId");

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceStep" ADD CONSTRAINT "ServiceStep_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceStep" ADD CONSTRAINT "ServiceStep_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMaterial" ADD CONSTRAINT "ServiceMaterial_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMaterial" ADD CONSTRAINT "ServiceMaterial_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMaterial" ADD CONSTRAINT "ServiceMaterial_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMedication" ADD CONSTRAINT "ServiceMedication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMedication" ADD CONSTRAINT "ServiceMedication_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMedication" ADD CONSTRAINT "ServiceMedication_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "MedicationCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
