-- Add restrictive guard constraints without dropping the earlier foreign keys.
-- Keeping the original FKs makes this migration expand/rollback compatible;
-- the restrictive companions prevent destructive tenant deletion.
ALTER TABLE "ImagingStudy"
  ADD CONSTRAINT "ImagingStudy_organizationId_restrict_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ImagingStudy_clinicId_restrict_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ImagingStudy_patientId_restrict_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ImagingStudy_connectionId_restrict_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LabCase"
  ADD CONSTRAINT "LabCase_organizationId_restrict_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabCase_clinicId_restrict_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabCase_patientId_restrict_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SterilizationInstrument"
  ADD CONSTRAINT "SterilizationInstrument_organizationId_restrict_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationInstrument_clinicId_restrict_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SterilizationCycle"
  ADD CONSTRAINT "SterilizationCycle_organizationId_restrict_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycle_clinicId_restrict_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SterilizationCycleInstrument"
  ADD CONSTRAINT "SterilizationCycleInstrument_cycle_restrict_fkey"
    FOREIGN KEY ("cycleId") REFERENCES "SterilizationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycleInstrument_organization_restrict_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycleInstrument_clinic_restrict_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
