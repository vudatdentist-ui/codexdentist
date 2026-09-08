CREATE TABLE "SterilizationInstrument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SterilizationInstrument_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SterilizationCycle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "cycleNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARING',
    "method" TEXT NOT NULL,
    "machineName" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SterilizationCycle_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SterilizationCycleInstrument" (
    "cycleId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "includedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SterilizationCycleInstrument_pkey" PRIMARY KEY ("cycleId", "instrumentId")
);
CREATE UNIQUE INDEX "SterilizationInstrument_org_clinic_code_key" ON "SterilizationInstrument" ("organizationId", "clinicId", "code");
CREATE INDEX "SterilizationInstrument_scope_status_idx" ON "SterilizationInstrument" ("organizationId", "clinicId", "status");
CREATE UNIQUE INDEX "SterilizationCycle_org_cycle_no_key" ON "SterilizationCycle" ("organizationId", "cycleNo");
CREATE INDEX "SterilizationCycle_scope_status_created_idx" ON "SterilizationCycle" ("organizationId", "clinicId", "status", "createdAt");
CREATE INDEX "SterilizationCycleInstrument_scope_instrument_idx" ON "SterilizationCycleInstrument" ("organizationId", "clinicId", "instrumentId");
ALTER TABLE "SterilizationInstrument"
  ADD CONSTRAINT "SterilizationInstrument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationInstrument_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SterilizationCycle"
  ADD CONSTRAINT "SterilizationCycle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycle_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SterilizationCycleInstrument"
  ADD CONSTRAINT "SterilizationCycleInstrument_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "SterilizationCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycleInstrument_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "SterilizationInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycleInstrument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycleInstrument_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
