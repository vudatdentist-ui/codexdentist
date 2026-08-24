"use server";

import {
  createPatientFileAction as createPatientFile,
  updatePatientFileGovernanceAction as updatePatientFileGovernance,
} from "@/features/patient-360/server/patient-file-actions";

export async function createPatientFileAction(formData: FormData) {
  return createPatientFile(formData);
}

export async function updatePatientFileGovernanceAction(formData: FormData) {
  return updatePatientFileGovernance(formData);
}
