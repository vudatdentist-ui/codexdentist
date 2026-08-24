"use server";

import {
  createPatientAction as createPatient,
  updatePatientAction as updatePatient,
  updatePatientConsentAction as updatePatientConsent,
  updatePatientLeadSourceAction as updatePatientLeadSource,
} from "@/features/patient-360/server/patient-actions";

export async function createPatientAction(formData: FormData) {
  return createPatient(formData);
}

export async function updatePatientAction(formData: FormData) {
  return updatePatient(formData);
}

export async function updatePatientConsentAction(formData: FormData) {
  return updatePatientConsent(formData);
}

export async function updatePatientLeadSourceAction(formData: FormData) {
  return updatePatientLeadSource(formData);
}
