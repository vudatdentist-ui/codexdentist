"use server";

import {
  resetPatientOdontogramStagesAction as resetPatientOdontogramStages,
  savePatientOdontogramAction as savePatientOdontogram,
} from "@/features/patient-360/server/odontogram-actions";

export async function savePatientOdontogramAction(
  input: Parameters<typeof savePatientOdontogram>[0],
) {
  return savePatientOdontogram(input);
}

export async function resetPatientOdontogramStagesAction(
  input: Parameters<typeof resetPatientOdontogramStages>[0],
) {
  return resetPatientOdontogramStages(input);
}
