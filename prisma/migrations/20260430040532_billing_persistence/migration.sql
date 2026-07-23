-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "treatmentServiceId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "allocatedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unallocatedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "invoiceItemId" TEXT,
    "treatmentServiceId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientCreditBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientCreditBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_treatmentServiceId_idx" ON "InvoiceItem"("treatmentServiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_patientId_createdAt_idx" ON "InvoiceItem"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceItem_clinicId_createdAt_idx" ON "InvoiceItem"("clinicId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_receiptNo_key" ON "Receipt"("receiptNo");

-- CreateIndex
CREATE INDEX "Receipt_clinicId_receivedAt_idx" ON "Receipt"("clinicId", "receivedAt");

-- CreateIndex
CREATE INDEX "Receipt_patientId_receivedAt_idx" ON "Receipt"("patientId", "receivedAt");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_receiptId_idx" ON "ReceiptAllocation"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_invoiceId_idx" ON "ReceiptAllocation"("invoiceId");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_invoiceItemId_idx" ON "ReceiptAllocation"("invoiceItemId");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_treatmentServiceId_idx" ON "ReceiptAllocation"("treatmentServiceId");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_patientId_createdAt_idx" ON "ReceiptAllocation"("patientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatientCreditBalance_patientId_key" ON "PatientCreditBalance"("patientId");

-- CreateIndex
CREATE INDEX "PatientCreditBalance_clinicId_idx" ON "PatientCreditBalance"("clinicId");

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_treatmentServiceId_fkey" FOREIGN KEY ("treatmentServiceId") REFERENCES "TreatmentService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_treatmentServiceId_fkey" FOREIGN KEY ("treatmentServiceId") REFERENCES "TreatmentService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCreditBalance" ADD CONSTRAINT "PatientCreditBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCreditBalance" ADD CONSTRAINT "PatientCreditBalance_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCreditBalance" ADD CONSTRAINT "PatientCreditBalance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
