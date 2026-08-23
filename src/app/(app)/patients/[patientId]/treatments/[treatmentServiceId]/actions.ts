"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import { optionalString, requiredString } from "@/lib/form-validation";
import {
  recordTreatmentProgress,
  TreatmentProgressError,
} from "@/features/treatment-progress/server/record-treatment-progress";

export async function recordTreatmentCaseProgressAction(formData: FormData) {
  const session = await requireViewSession("treatment");

  if (!canPerformAction(session, "treatment.service.progress")) {
    redirect("/unauthorized");
  }

  const treatmentServiceId = requiredString(formData.get("treatmentServiceId"));
  const fallbackPatientId = optionalString(formData.get("patientId"));
  const toProgressPercent = Number(formData.get("toProgressPercent"));
  const performedById = optionalString(formData.get("performedById"));
  const consultantId = optionalString(formData.get("consultantId"));
  const clinicalSupportId = optionalString(formData.get("clinicalSupportId"));
  const assistantPrimaryId = optionalString(formData.get("assistantPrimaryId"));
  const assistantSecondaryId = optionalString(formData.get("assistantSecondaryId"));
  const note = optionalString(formData.get("note"));

  if (!treatmentServiceId) {
    redirect("/treatment?notice=progress-missing");
  }

  try {
    const result = await recordTreatmentProgress(session, {
      treatmentServiceId,
      toProgressPercent,
      performedById,
      consultantId,
      clinicalSupportId,
      assistantPrimaryId,
      assistantSecondaryId,
      note,
    });
    const casePath = treatmentCasePath(result.patientId, result.treatmentServiceId);

    revalidatePath(casePath);
    revalidatePath(`/patients/${encodeURIComponent(result.patientId)}`);
    revalidatePath("/treatment");
    revalidatePath("/journey");
    revalidatePath("/staff");
    revalidatePath("/employee-app");
    revalidatePath("/inventory");
    revalidatePath("/work");
    redirect(`${casePath}?notice=progress-recorded`);
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    const notice =
      error instanceof TreatmentProgressError
        ? progressErrorNotice(error)
        : "progress-database";
    const fallbackPath =
      fallbackPatientId && treatmentServiceId
        ? treatmentCasePath(fallbackPatientId, treatmentServiceId)
        : "/treatment";

    redirect(`${fallbackPath}?notice=${notice}`);
  }
}

function treatmentCasePath(patientId: string, treatmentServiceId: string) {
  return `/patients/${encodeURIComponent(patientId)}/treatments/${encodeURIComponent(treatmentServiceId)}`;
}

function progressErrorNotice(error: TreatmentProgressError) {
  switch (error.code) {
    case "forbidden":
      return "progress-denied";
    case "regression":
      return "progress-regression";
    case "invalid-progress":
      return "progress-invalid";
    case "missing":
      return "progress-missing";
  }
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}
