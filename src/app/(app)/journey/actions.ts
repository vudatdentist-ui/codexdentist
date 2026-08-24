"use server";

import {
  createJourneyCommentAction as createJourneyComment,
  createJourneyTreatmentServicesAction as createJourneyTreatmentServices,
  deleteJourneyTreatmentServiceAction as deleteJourneyTreatmentService,
  recordJourneyServiceProgressAction as recordJourneyServiceProgress,
  updateJourneyStateAction as updateJourneyState,
  updateJourneyTreatmentServiceDiscountAction as updateJourneyTreatmentServiceDiscount,
} from "@/features/patient-360/server/journey-actions";

export async function createJourneyCommentAction(formData: FormData) {
  return createJourneyComment(formData);
}

export async function createJourneyTreatmentServicesAction(formData: FormData) {
  return createJourneyTreatmentServices(formData);
}

export async function deleteJourneyTreatmentServiceAction(formData: FormData) {
  return deleteJourneyTreatmentService(formData);
}

export async function recordJourneyServiceProgressAction(formData: FormData) {
  return recordJourneyServiceProgress(formData);
}

export async function updateJourneyStateAction(formData: FormData) {
  return updateJourneyState(formData);
}

export async function updateJourneyTreatmentServiceDiscountAction(formData: FormData) {
  return updateJourneyTreatmentServiceDiscount(formData);
}
