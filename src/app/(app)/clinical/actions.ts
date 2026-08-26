"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { applicationErrorCode } from "@/lib/application/errors";
import {
  finalizeClinicalNoteCommand,
  lockClinicalNoteCommand,
} from "@/lib/application/clinical/commands";
import { optionalString, requiredString, splitList } from "@/lib/form-validation";

export async function createClinicalNoteAction(formData: FormData) {
  const session = await requireViewSession("clinical");
  const patientId = requiredString(formData.get("patientId"));
  const subjectiveRaw = requiredString(formData.get("subjective"));
  const subjective = subjectiveRaw || null;
  const objectiveInput = optionalString(formData.get("objective"));
  const medicalHistory = optionalString(formData.get("medicalHistory"));
  const temperature = optionalString(formData.get("temperature"));
  const bloodPressure = optionalString(formData.get("bloodPressure"));
  const heartRate = optionalString(formData.get("heartRate"));
  const vitals = [
    heartRate ? `Mạch: ${heartRate}` : null,
    temperature ? `Nhiệt độ: ${temperature}` : null,
    bloodPressure ? `Huyết áp: ${bloodPressure}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  const objective =
    [
      objectiveInput,
      medicalHistory ? `Bệnh sử: ${medicalHistory}` : null,
      vitals ? `Sinh hiệu: ${vitals}` : null,
    ]
      .filter(Boolean)
      .join("\n\n") || null;
  const assessment = optionalString(formData.get("assessment"));
  const prognosis = optionalString(formData.get("prognosis"));
  const legacyPlan = optionalString(formData.get("plan"));
  const treatmentGoal = optionalString(formData.get("treatmentGoal"));
  const treatmentPlan = optionalString(formData.get("treatmentPlan"));
  const odontogramTeeth = splitList(formData.get("odontogramTeeth"), /[\n,]/);
  const hasTreatmentFields = formData.has("treatmentGoal") || formData.has("treatmentPlan");
  const plan =
    [
      legacyPlan,
      treatmentGoal ? `Mục tiêu điều trị: ${treatmentGoal}` : null,
      treatmentPlan ? `Kế hoạch điều trị: ${treatmentPlan}` : null,
    ]
      .filter(Boolean)
      .join("\n\n") || null;

  if (!patientId || (!subjective && !objective && !assessment && !prognosis && !plan)) {
    redirect("/journey?notice=clinical-missing");
  }

  try {
    await finalizeClinicalNoteCommand(session, {
      patientId,
      subjective,
      objective,
      assessment,
      prognosis,
      plan,
      treatmentGoal,
      treatmentPlan,
      odontogramTeeth,
      updateTreatmentPlan: hasTreatmentFields,
    });
  } catch (error) {
    console.error("clinical.note_create_failed", error);
    redirect(`/journey?notice=${applicationErrorCode(error, "clinical-database")}`);
  }

  revalidatePath("/journey");
  revalidatePath("/clinical");
  revalidatePath("/patients");
  redirect(`/journey?notice=clinical-created&patientId=${encodeURIComponent(patientId)}`);
}

export async function lockClinicalNoteAction(formData: FormData) {
  const session = await requireViewSession("clinical");
  const noteId = requiredString(formData.get("noteId"));
  if (!noteId) redirect("/journey?notice=clinical-note-not-found");

  let patientId: string;
  try {
    const note = await lockClinicalNoteCommand(session, noteId);
    patientId = note.patientId;
  } catch (error) {
    redirect(`/journey?notice=${applicationErrorCode(error, "clinical-database")}`);
  }

  revalidatePath("/journey");
  redirect(`/journey?notice=clinical-locked&patientId=${encodeURIComponent(patientId)}`);
}
