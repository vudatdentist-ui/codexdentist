-- Enforce tenant and clinic consistency for operational PHI records. Any
-- malformed existing row fails the migration rather than being reassigned.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PatientFile" file
    LEFT JOIN "Clinic" clinic
      ON clinic.id = file."clinicId" AND clinic."organizationId" = file."organizationId"
    LEFT JOIN "Patient" patient
      ON patient.id = file."patientId"
     AND patient."clinicId" = file."clinicId"
     AND patient."organizationId" = file."organizationId"
    WHERE clinic.id IS NULL OR patient.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "ImagingStudy" study
    LEFT JOIN "Clinic" clinic
      ON clinic.id = study."clinicId" AND clinic."organizationId" = study."organizationId"
    LEFT JOIN "Patient" patient
      ON patient.id = study."patientId"
     AND patient."clinicId" = study."clinicId"
     AND patient."organizationId" = study."organizationId"
    WHERE clinic.id IS NULL OR patient.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "LabCase" lab
    LEFT JOIN "Clinic" clinic
      ON clinic.id = lab."clinicId" AND clinic."organizationId" = lab."organizationId"
    LEFT JOIN "Patient" patient
      ON patient.id = lab."patientId"
     AND patient."clinicId" = lab."clinicId"
     AND patient."organizationId" = lab."organizationId"
    WHERE clinic.id IS NULL OR patient.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "SterilizationInstrument" instrument
    LEFT JOIN "Clinic" clinic
      ON clinic.id = instrument."clinicId" AND clinic."organizationId" = instrument."organizationId"
    WHERE clinic.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "SterilizationCycle" cycle
    LEFT JOIN "Clinic" clinic
      ON clinic.id = cycle."clinicId" AND clinic."organizationId" = cycle."organizationId"
    WHERE clinic.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "SterilizationCycleInstrument" item
    LEFT JOIN "SterilizationCycle" cycle
      ON cycle.id = item."cycleId"
     AND cycle."organizationId" = item."organizationId"
     AND cycle."clinicId" = item."clinicId"
    LEFT JOIN "SterilizationInstrument" instrument
      ON instrument.id = item."instrumentId"
     AND instrument."organizationId" = item."organizationId"
     AND instrument."clinicId" = item."clinicId"
    LEFT JOIN "Clinic" clinic
      ON clinic.id = item."clinicId" AND clinic."organizationId" = item."organizationId"
    WHERE cycle.id IS NULL OR instrument.id IS NULL OR clinic.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "PatientFileObjectStage" stage
    LEFT JOIN "Clinic" clinic
      ON clinic.id = stage."clinicId" AND clinic."organizationId" = stage."organizationId"
    LEFT JOIN "Patient" patient
      ON patient.id = stage."patientId"
     AND patient."clinicId" = stage."clinicId"
     AND patient."organizationId" = stage."organizationId"
    WHERE clinic.id IS NULL OR patient.id IS NULL
  ) THEN
    RAISE EXCEPTION 'tenant consistency check failed for phase 4/5 records or patient-file stages';
  END IF;
END $$;

ALTER TABLE "Clinic" ADD CONSTRAINT "Clinic_id_organizationId_key" UNIQUE ("id", "organizationId");
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_id_clinicId_organizationId_key" UNIQUE ("id", "clinicId", "organizationId");
ALTER TABLE "SterilizationInstrument" ADD CONSTRAINT "SterilizationInstrument_id_organizationId_clinicId_key" UNIQUE ("id", "organizationId", "clinicId");
ALTER TABLE "SterilizationCycle" ADD CONSTRAINT "SterilizationCycle_id_organizationId_clinicId_key" UNIQUE ("id", "organizationId", "clinicId");

ALTER TABLE "PatientFile" DROP CONSTRAINT "PatientFile_clinicId_fkey";
ALTER TABLE "PatientFile" DROP CONSTRAINT "PatientFile_patientId_fkey";
ALTER TABLE "PatientFile"
  ADD CONSTRAINT "PatientFile_clinicId_organizationId_fkey"
    FOREIGN KEY ("clinicId", "organizationId") REFERENCES "Clinic" ("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientFile_patientId_clinicId_organizationId_fkey"
    FOREIGN KEY ("patientId", "clinicId", "organizationId") REFERENCES "Patient" ("id", "clinicId", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "ImagingStudy" DROP CONSTRAINT "ImagingStudy_clinicId_fkey";
ALTER TABLE "ImagingStudy" DROP CONSTRAINT "ImagingStudy_patientId_fkey";
ALTER TABLE "ImagingStudy"
  ADD CONSTRAINT "ImagingStudy_clinicId_organizationId_fkey"
    FOREIGN KEY ("clinicId", "organizationId") REFERENCES "Clinic" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ImagingStudy_patientId_clinicId_organizationId_fkey"
    FOREIGN KEY ("patientId", "clinicId", "organizationId") REFERENCES "Patient" ("id", "clinicId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LabCase" DROP CONSTRAINT "LabCase_clinicId_fkey";
ALTER TABLE "LabCase" DROP CONSTRAINT "LabCase_patientId_fkey";
ALTER TABLE "LabCase"
  ADD CONSTRAINT "LabCase_clinicId_organizationId_fkey"
    FOREIGN KEY ("clinicId", "organizationId") REFERENCES "Clinic" ("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "LabCase_patientId_clinicId_organizationId_fkey"
    FOREIGN KEY ("patientId", "clinicId", "organizationId") REFERENCES "Patient" ("id", "clinicId", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "SterilizationInstrument" DROP CONSTRAINT "SterilizationInstrument_clinicId_fkey";
ALTER TABLE "SterilizationInstrument"
  ADD CONSTRAINT "SterilizationInstrument_clinicId_organizationId_fkey"
    FOREIGN KEY ("clinicId", "organizationId") REFERENCES "Clinic" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SterilizationCycle" DROP CONSTRAINT "SterilizationCycle_clinicId_fkey";
ALTER TABLE "SterilizationCycle"
  ADD CONSTRAINT "SterilizationCycle_clinicId_organizationId_fkey"
    FOREIGN KEY ("clinicId", "organizationId") REFERENCES "Clinic" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SterilizationCycleInstrument" DROP CONSTRAINT "SterilizationCycleInstrument_cycleId_fkey";
ALTER TABLE "SterilizationCycleInstrument" DROP CONSTRAINT "SterilizationCycleInstrument_instrumentId_fkey";
ALTER TABLE "SterilizationCycleInstrument" DROP CONSTRAINT "SterilizationCycleInstrument_clinicId_fkey";
ALTER TABLE "SterilizationCycleInstrument"
  ADD CONSTRAINT "SterilizationCycleInstrument_cycle_scope_fkey"
    FOREIGN KEY ("cycleId", "organizationId", "clinicId") REFERENCES "SterilizationCycle" ("id", "organizationId", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycleInstrument_instrument_scope_fkey"
    FOREIGN KEY ("instrumentId", "organizationId", "clinicId") REFERENCES "SterilizationInstrument" ("id", "organizationId", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SterilizationCycleInstrument_clinic_organization_fkey"
    FOREIGN KEY ("clinicId", "organizationId") REFERENCES "Clinic" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientFileObjectStage"
  DROP CONSTRAINT "PatientFileObjectStage_clinicId_fkey",
  DROP CONSTRAINT "PatientFileObjectStage_patientId_fkey";
ALTER TABLE "PatientFileObjectStage"
  ADD CONSTRAINT "PatientFileObjectStage_clinicId_organizationId_fkey"
    FOREIGN KEY ("clinicId", "organizationId") REFERENCES "Clinic" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientFileObjectStage_patientId_clinicId_organizationId_fkey"
    FOREIGN KEY ("patientId", "clinicId", "organizationId") REFERENCES "Patient" ("id", "clinicId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
