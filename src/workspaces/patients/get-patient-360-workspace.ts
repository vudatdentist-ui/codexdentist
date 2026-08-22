import "server-only";

import { getBillingWorkspace } from "@/lib/billing";
import type { BillingWorkspace } from "@/lib/billing-types";
import { getClinicalWorkspace } from "@/lib/clinical";
import type { ClinicalWorkspace } from "@/lib/clinical-types";
import { getCrmWorkspace } from "@/lib/crm";
import type { CrmWorkspace } from "@/lib/crm-types";
import { getFormsWorkspace } from "@/lib/forms";
import type { FormsWorkspace } from "@/lib/forms-types";
import { getJourneyRecordsWorkspace } from "@/lib/journey-records";
import type { JourneyRecordsWorkspace } from "@/lib/journey-records-types";
import { getPatientFilesWorkspace } from "@/lib/patient-files";
import type { PatientFilesWorkspace } from "@/lib/patient-files-types";
import type { PatientWorkspace } from "@/lib/patient-types";
import { getPatientWorkspace } from "@/lib/patients";
import { getPharmacyWorkspace } from "@/lib/pharmacy";
import type { PharmacyWorkspace } from "@/lib/pharmacy-types";
import { canAccessView } from "@/lib/permissions";
import { getScheduleWorkspace } from "@/lib/schedule";
import type { ScheduleWorkspace } from "@/lib/schedule-types";
import { getServicesWorkspace } from "@/lib/services";
import type { ServicesWorkspace } from "@/lib/services-types";
import type { AppSession } from "@/lib/session";
import { getSettingsWorkspace } from "@/lib/settings";
import type { SettingsWorkspace } from "@/lib/settings-types";
import { getTreatmentWorkspace } from "@/lib/treatments";
import type { TreatmentWorkspace } from "@/lib/treatment-types";

export type Patient360WorkspaceModel = {
  selectedPatientId: string | null;
  patientWorkspace: PatientWorkspace;
  scheduleWorkspace: ScheduleWorkspace | null;
  treatmentWorkspace: TreatmentWorkspace | null;
  billingWorkspace: BillingWorkspace | null;
  clinicalWorkspace: ClinicalWorkspace | null;
  crmWorkspace: CrmWorkspace | null;
  patientFilesWorkspace: PatientFilesWorkspace | null;
  journeyRecordsWorkspace: JourneyRecordsWorkspace | null;
  pharmacyWorkspace: PharmacyWorkspace | null;
  formsWorkspace: FormsWorkspace | null;
  servicesWorkspace: ServicesWorkspace | null;
  settingsWorkspace: SettingsWorkspace | null;
};

export async function getPatient360Workspace(
  session: AppSession,
  requestedPatientId?: string | null,
): Promise<Patient360WorkspaceModel> {
  const patientWorkspace = await getPatientWorkspace(session);
  const selectedPatient = requestedPatientId
    ? patientWorkspace.patients.find((patient) => patient.id === requestedPatientId) ?? null
    : null;

  if (!selectedPatient) {
    return emptyPatient360Workspace(patientWorkspace);
  }

  const scope = { patientId: selectedPatient.id };
  const [
    scheduleWorkspace,
    treatmentWorkspace,
    billingWorkspace,
    clinicalWorkspace,
    crmWorkspace,
    patientFilesWorkspace,
    journeyRecordsWorkspace,
    pharmacyWorkspace,
    formsWorkspace,
    servicesWorkspace,
    settingsWorkspace,
  ] = await Promise.all([
    getScheduleWorkspace(session, {
      scope: "all",
      patientId: selectedPatient.id,
    }),
    getTreatmentWorkspace(session, scope),
    canAccessView(session, "billing")
      ? getBillingWorkspace(session, scope)
      : Promise.resolve(null),
    getClinicalWorkspace(session, scope),
    canAccessView(session, "crm")
      ? getCrmWorkspace(session, scope)
      : Promise.resolve(null),
    getPatientFilesWorkspace(session, scope),
    getJourneyRecordsWorkspace(session, scope),
    canAccessView(session, "pharmacy")
      ? getPharmacyWorkspace(session, scope)
      : Promise.resolve(null),
    canAccessView(session, "forms")
      ? getFormsWorkspace(session, scope)
      : Promise.resolve(null),
    getServicesWorkspace(session, scope),
    getSettingsWorkspace(session),
  ]);

  return {
    selectedPatientId: selectedPatient.id,
    patientWorkspace,
    scheduleWorkspace,
    treatmentWorkspace,
    billingWorkspace,
    clinicalWorkspace,
    crmWorkspace,
    patientFilesWorkspace,
    journeyRecordsWorkspace,
    pharmacyWorkspace,
    formsWorkspace,
    servicesWorkspace,
    settingsWorkspace,
  };
}

function emptyPatient360Workspace(
  patientWorkspace: PatientWorkspace,
): Patient360WorkspaceModel {
  return {
    selectedPatientId: null,
    patientWorkspace,
    scheduleWorkspace: null,
    treatmentWorkspace: null,
    billingWorkspace: null,
    clinicalWorkspace: null,
    crmWorkspace: null,
    patientFilesWorkspace: null,
    journeyRecordsWorkspace: null,
    pharmacyWorkspace: null,
    formsWorkspace: null,
    servicesWorkspace: null,
    settingsWorkspace: null,
  };
}
