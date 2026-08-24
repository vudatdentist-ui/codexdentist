"use server";

import {
  createClinicalNoteAction as createClinicalNote,
  lockClinicalNoteAction as lockClinicalNote,
} from "@/features/patient-360/server/clinical-actions";

export async function createClinicalNoteAction(formData: FormData) {
  return createClinicalNote(formData);
}

export async function lockClinicalNoteAction(formData: FormData) {
  return lockClinicalNote(formData);
}
