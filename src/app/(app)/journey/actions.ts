"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applicationErrorCode } from "@/lib/application/errors";
import {
  createJourneyCommentCommand,
  updateJourneyStateCommand,
} from "@/lib/application/journey/commands";
import { requireViewSession } from "@/lib/auth";
import { optionalString, requiredString, splitList } from "@/lib/form-validation";
import {
  createJourneyTreatmentServicesAction as createJourneyTreatmentServicesTransport,
  deleteJourneyTreatmentServiceAction as deleteJourneyTreatmentServiceTransport,
  recordJourneyServiceProgressAction as recordJourneyServiceProgressTransport,
  updateJourneyTreatmentServiceDiscountAction as updateJourneyTreatmentServiceDiscountTransport,
} from "./treatment-actions";

function journeyRedirect(notice: string, patientId?: string | null) {
  const params = new URLSearchParams({ notice });
  if (patientId) params.set("patientId", patientId);
  return `/journey?${params.toString()}`;
}

export async function updateJourneyStateAction(formData: FormData) {
  const session = await requireViewSession("journey");
  const patientId = requiredString(formData.get("patientId"));
  const stateRedirect = (notice: string) => journeyRedirect(notice, patientId);
  const treatmentGoal = optionalString(formData.get("treatmentGoal"));
  const treatmentPlan = optionalString(formData.get("treatmentPlan"));
  const odontogramTeeth = splitList(formData.get("odontogramTeeth"), /[\n,]/);

  if (!patientId) redirect(stateRedirect("journey-state-missing"));

  try {
    await updateJourneyStateCommand(session, {
      patientId,
      treatmentGoal,
      treatmentPlan,
      odontogramTeeth,
    });
  } catch (error) {
    console.error("journey.state_update_failed", error);
    redirect(stateRedirect(applicationErrorCode(error, "journey-database")));
  }

  revalidatePath("/journey");
  redirect(stateRedirect("journey-state-saved"));
}

export async function createJourneyCommentAction(formData: FormData) {
  const session = await requireViewSession("journey");
  const patientId = requiredString(formData.get("patientId"));
  const commentRedirect = (notice: string) => journeyRedirect(notice, patientId);
  const body = requiredString(formData.get("body"));
  const files = formData.getAll("file").filter(isUploadedFile);

  if (!patientId || (!body && files.length === 0)) {
    redirect(commentRedirect("journey-comment-missing"));
  }

  try {
    await createJourneyCommentCommand(session, { patientId, body, files });
  } catch (error) {
    console.error("journey.comment_create_failed", error);
    redirect(commentRedirect(applicationErrorCode(error, "journey-database")));
  }

  revalidatePath("/journey");
  redirect(commentRedirect("journey-comment-created"));
}

export async function createJourneyTreatmentServicesAction(formData: FormData) {
  return createJourneyTreatmentServicesTransport(formData);
}

export async function deleteJourneyTreatmentServiceAction(formData: FormData) {
  return deleteJourneyTreatmentServiceTransport(formData);
}

export async function recordJourneyServiceProgressAction(formData: FormData) {
  return recordJourneyServiceProgressTransport(formData);
}

export async function updateJourneyTreatmentServiceDiscountAction(formData: FormData) {
  return updateJourneyTreatmentServiceDiscountTransport(formData);
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File && value.size > 0;
}
