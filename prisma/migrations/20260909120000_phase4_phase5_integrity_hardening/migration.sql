ALTER TABLE "ImagingStudy"
  DROP CONSTRAINT "ImagingStudy_organizationId_fkey",
  DROP CONSTRAINT "ImagingStudy_clinicId_fkey",
  DROP CONSTRAINT "ImagingStudy_patientId_fkey";
ALTER TABLE "ImagingStudy"
  ADD CONSTRAINT "ImagingStudy_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ImagingStudy_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ImagingStudy_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ImagingStudy_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LabCase"
  DROP CONSTRAINT "LabCase_organizationId_fkey",
  DROP CONSTRAINT "LabCase_clinicId_fkey",
  DROP CONSTRAINT "LabCase_patientId_fkey";
ALTER TABLE "LabCase"
  ADD CONSTRAINT "LabCase_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabCase_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabCase_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SterilizationInstrument"
  DROP CONSTRAINT "SterilizationInstrument_organizationId_fkey",
  DROP CONSTRAINT "SterilizationInstrument_clinicId_fkey";
ALTER TABLE "SterilizationInstrument"
  ADD CONSTRAINT "SterilizationInstrument_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationInstrument_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SterilizationCycle"
  DROP CONSTRAINT "SterilizationCycle_organizationId_fkey",
  DROP CONSTRAINT "SterilizationCycle_clinicId_fkey";
ALTER TABLE "SterilizationCycle"
  ADD CONSTRAINT "SterilizationCycle_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycle_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SterilizationCycleInstrument"
  DROP CONSTRAINT "SterilizationCycleInstrument_cycleId_fkey",
  DROP CONSTRAINT "SterilizationCycleInstrument_organizationId_fkey",
  DROP CONSTRAINT "SterilizationCycleInstrument_clinicId_fkey";
ALTER TABLE "SterilizationCycleInstrument"
  ADD CONSTRAINT "SterilizationCycleInstrument_cycleId_fkey"
    FOREIGN KEY ("cycleId") REFERENCES "SterilizationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycleInstrument_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycleInstrument_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
