"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import {
  optionalString,
  parseDateInVietnam,
  requiredString,
  splitList,
} from "@/lib/form-validation";
import { applicationErrorCode } from "@/lib/application/errors";
import {
  createPatientCommand,
  updatePatientCommand,
  updatePatientConsentCommand,
  updatePatientLeadSourceCommand,
  type PatientConsentStatus,
  type PatientLeadSource,
} from "@/lib/application/patient/commands";

const consentStatuses = ["GRANTED", "REVOKED", "EXPIRED"] as const;
const patientLeadSources = [
  "WALK_IN",
  "FACEBOOK_ADS",
  "GOOGLE_ADS",
  "TIKTOK",
  "SOCIAL",
  "TELESALE",
  "WEBSITE",
  "ZALO",
  "PATIENT_REFERRAL",
  "STAFF_REFERRAL",
  "PARTNER",
  "OTHER",
] as const;

export async function createPatientAction(formData: FormData) {
  const session = await requireViewSession("patients");
  const clinicId = requiredString(formData.get("clinicId"));
  const fullName = requiredString(formData.get("fullName"));
  const phone = requiredString(formData.get("phone"));
  const dateOfBirth = parseDateInVietnam(formData.get("dateOfBirth"));

  if (!fullName || !phone) redirect("/patients?notice=patient-missing");
  if (dateOfBirth === "invalid") redirect("/patients?notice=patient-bad-date");

  let patientId: string;
  try {
    const patient = await createPatientCommand(session, {
      clinicId,
      fullName,
      phone,
      email: optionalString(formData.get("email")),
      gender: normalizeGender(formData.get("gender")),
      visitReason: optionalString(formData.get("visitReason")),
      leadSource: normalizeLeadSource(formData.get("leadSource")),
      dateOfBirth,
      guardianName: optionalString(formData.get("guardianName")),
      address: optionalString(formData.get("address")),
      nationalId: optionalString(formData.get("nationalId")),
      medicalAlerts: splitList(formData.get("medicalAlerts")),
    });
    patientId = patient.id;
  } catch (error) {
    redirect(`/patients?notice=${applicationErrorCode(error, "patient-database")}`);
  }

  revalidatePath("/patients");
  revalidatePath("/journey");
  redirect(patientRedirect("patient-created", patientId));
}

export async function updatePatientAction(formData: FormData) {
  const session = await requireViewSession("patients");
  const patientId = requiredString(formData.get("patientId"));
  const clinicId = requiredString(formData.get("clinicId"));
  const fullName = requiredString(formData.get("fullName"));
  const phone = requiredString(formData.get("phone"));
  const dateOfBirth = parseDateInVietnam(formData.get("dateOfBirth"));

  if (!patientId || !fullName || !phone) redirect(patientRedirect("patient-missing", patientId));
  if (dateOfBirth === "invalid") redirect(patientRedirect("patient-bad-date", patientId));

  try {
    await updatePatientCommand(session, patientId, {
      clinicId,
      fullName,
      phone,
      email: optionalString(formData.get("email")),
      gender: normalizeGender(formData.get("gender")),
      visitReason: optionalString(formData.get("visitReason")),
      dateOfBirth,
      guardianName: optionalString(formData.get("guardianName")),
      address: optionalString(formData.get("address")),
      nationalId: optionalString(formData.get("nationalId")),
      medicalAlerts: splitList(formData.get("medicalAlerts")),
    });
  } catch (error) {
    redirect(patientRedirect(applicationErrorCode(error, "patient-database"), patientId));
  }

  revalidatePath("/patients");
  revalidatePath("/journey");
  redirect(patientRedirect("patient-updated", patientId));
}

export async function updatePatientConsentAction(formData: FormData) {
  const session = await requireViewSession("patients");
  const patientId = requiredString(formData.get("patientId"));
  const status = requiredString(formData.get("status"));

  if (!patientId || !isConsentStatus(status)) {
    redirect(patientRedirect("patient-bad-consent", patientId));
  }

  try {
    await updatePatientConsentCommand(session, patientId, status);
  } catch (error) {
    redirect(patientRedirect(applicationErrorCode(error, "patient-database"), patientId));
  }

  revalidatePath("/patients");
  redirect(patientRedirect("patient-consent-updated", patientId));
}

export async function updatePatientLeadSourceAction(formData: FormData) {
  const session = await requireViewSession("patients");
  const patientId = requiredString(formData.get("patientId"));
  const leadSource = normalizeLeadSource(formData.get("leadSource"));
  const reason = optionalString(formData.get("reason"));

  if (!patientId || !reason) {
    redirect(patientRedirect("patient-source-reason-required", patientId));
  }

  try {
    await updatePatientLeadSourceCommand(session, patientId, leadSource, reason);
  } catch (error) {
    redirect(patientRedirect(applicationErrorCode(error, "patient-database"), patientId));
  }

  revalidatePath("/patients");
  revalidatePath("/reports");
  redirect(patientRedirect("patient-source-updated", patientId));
}

function patientRedirect(notice: string, patientId?: string | null) {
  const params = new URLSearchParams({ notice });
  if (patientId) params.set("patientId", patientId);
  return `/patients?${params.toString()}`;
}

function isConsentStatus(status: string): status is PatientConsentStatus {
  return consentStatuses.includes(status as PatientConsentStatus);
}

function normalizeGender(value: FormDataEntryValue | null) {
  const gender = requiredString(value).toUpperCase();
  return ["FEMALE", "MALE", "OTHER", "UNKNOWN"].includes(gender) ? gender : null;
}

function normalizeLeadSource(value: FormDataEntryValue | null): PatientLeadSource {
  const source = requiredString(value).toUpperCase();
  return (patientLeadSources.find((candidate) => candidate === source) ?? "WALK_IN") as PatientLeadSource;
}
