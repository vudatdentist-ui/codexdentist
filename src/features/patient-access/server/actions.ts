"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import { canMutateCrm } from "@/lib/crm";
import { optionalString, parseDateTimeInVietnam, requiredString } from "@/lib/form-validation";
import { allowedClinicIds } from "@/lib/patient-access";
import {
  cancelPatientAccessAppointment,
  completeCareActivity,
  createPatientAccessAppointment,
  isPatientAccessAppointmentStatus,
  PatientAccessOperationError,
  recordNoShowRecovery,
  transitionPatientAccessAppointment,
} from "./operations";

export async function createPatientAccessAppointmentAction(formData: FormData) {
  const session = await requireViewSession("schedule");
  if (!canPerformAction(session, "appointment.create")) {
    redirect(patientAccessRedirect("denied", formData));
  }

  const clinicIds = allowedClinicIds(session);
  const clinicId = requiredString(formData.get("clinicId"));
  const patientId = requiredString(formData.get("patientId"));
  const providerId = requiredString(formData.get("providerId"));
  const chairId = requiredString(formData.get("chairId"));
  const date = requiredString(formData.get("date"));
  const startTime = requiredString(formData.get("startTime"));
  const duration = Number(formData.get("duration") ?? 30);
  const reason = requiredString(formData.get("reason"));

  if (!clinicIds.includes(clinicId)) redirect(patientAccessRedirect("clinic-denied", formData));
  if (!patientId || !providerId || !date || !startTime || !reason) {
    redirect(patientAccessRedirect("missing-fields", formData));
  }
  if (!Number.isFinite(duration) || duration < 15 || duration > 240) {
    redirect(patientAccessRedirect("bad-duration", formData));
  }

  const startsAt = parseDateTimeInVietnam(date, startTime);
  if (startsAt === "invalid") redirect(patientAccessRedirect("bad-time", formData));
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);

  try {
    const appointment = await createPatientAccessAppointment({
      organizationId: session.organizationId,
      userId: session.userId,
      clinicIds,
      clinicId,
      patientId,
      providerId,
      chairId: chairId || null,
      startsAt,
      endsAt,
      reason,
    });
    finishSchedule("created", formData, appointment.id);
  } catch (error) {
    finishSchedule(operationNotice(error, "database-unavailable"), formData);
  }
}

export async function transitionPatientAccessAppointmentAction(formData: FormData) {
  const session = await requireViewSession("schedule");
  if (!canPerformAction(session, "appointment.update")) {
    redirect(patientAccessRedirect("denied", formData));
  }

  const appointmentId = requiredString(formData.get("appointmentId"));
  const requestedStatus = requiredString(formData.get("status"));
  const requestedChairId = requiredString(formData.get("chairId"));
  if (!appointmentId || !isPatientAccessAppointmentStatus(requestedStatus)) {
    redirect(patientAccessRedirect("bad-status", formData));
  }

  try {
    await transitionPatientAccessAppointment({
      organizationId: session.organizationId,
      userId: session.userId,
      clinicIds: allowedClinicIds(session),
      appointmentId,
      requestedStatus,
      requestedChairId: requestedChairId || null,
    });
    finishSchedule("updated", formData, appointmentId);
  } catch (error) {
    finishSchedule(operationNotice(error, "database-unavailable"), formData, appointmentId);
  }
}

export async function cancelPatientAccessAppointmentAction(formData: FormData) {
  const session = await requireViewSession("schedule");
  if (!canPerformAction(session, "appointment.cancel")) {
    redirect(patientAccessRedirect("denied", formData));
  }

  const appointmentId = requiredString(formData.get("appointmentId"));
  if (!appointmentId) redirect(patientAccessRedirect("not-found", formData));

  try {
    await cancelPatientAccessAppointment({
      organizationId: session.organizationId,
      userId: session.userId,
      clinicIds: allowedClinicIds(session),
      appointmentId,
    });
    finishSchedule("cancelled", formData, appointmentId);
  } catch (error) {
    finishSchedule(operationNotice(error, "database-unavailable"), formData, appointmentId);
  }
}

export async function recordNoShowRecoveryAction(formData: FormData) {
  const session = await requireViewSession("crm");
  if (!canMutateCrm(session)) redirect(careRedirect("crm-denied", formData));

  const appointmentId = requiredString(formData.get("appointmentId"));
  const channel = normalizeCareChannel(requiredString(formData.get("channel")));
  const note = optionalString(formData.get("note"));
  if (!appointmentId || !channel) redirect(careRedirect("crm-missing", formData));

  try {
    await recordNoShowRecovery({
      organizationId: session.organizationId,
      userId: session.userId,
      clinicIds: allowedClinicIds(session),
      appointmentId,
      channel,
      note,
    });
    finishCare("no-show-recovered", formData);
  } catch (error) {
    finishCare(operationNotice(error, "crm-database"), formData);
  }
}

export async function completeCareActivityAction(formData: FormData) {
  const session = await requireViewSession("crm");
  if (!canMutateCrm(session)) redirect(careRedirect("crm-denied", formData));

  const activityId = requiredString(formData.get("activityId"));
  if (!activityId) redirect(careRedirect("crm-missing", formData));

  try {
    await completeCareActivity({
      organizationId: session.organizationId,
      userId: session.userId,
      clinicIds: allowedClinicIds(session),
      activityId,
    });
    finishCare("care-activity-completed", formData);
  } catch (error) {
    finishCare(operationNotice(error, "crm-database"), formData);
  }
}

function normalizeCareChannel(value: string) {
  return ["PHONE", "ZALO", "SMS", "EMAIL", "IN_APP"].includes(value)
    ? (value as "PHONE" | "ZALO" | "SMS" | "EMAIL" | "IN_APP")
    : null;
}

function operationNotice(error: unknown, fallback: string) {
  return error instanceof PatientAccessOperationError ? error.code : fallback;
}

function finishSchedule(notice: string, formData: FormData, appointmentId?: string | null): never {
  revalidatePatientAccess();
  redirect(patientAccessRedirect(notice, formData, appointmentId));
}

function finishCare(notice: string, formData: FormData): never {
  revalidatePatientAccess();
  redirect(careRedirect(notice, formData));
}

function patientAccessRedirect(notice: string, formData: FormData, appointmentId?: string | null) {
  const params = new URLSearchParams({ notice });
  const date = requiredString(formData.get("date"));
  if (date) params.set("date", date);
  if (appointmentId) params.set("appointmentId", appointmentId);
  return `/schedule?${params.toString()}`;
}

function careRedirect(notice: string, formData: FormData) {
  const params = new URLSearchParams({ notice });
  const appointmentId = requiredString(formData.get("appointmentId"));
  if (appointmentId) params.set("appointmentId", appointmentId);
  return `/care?${params.toString()}`;
}

function revalidatePatientAccess() {
  revalidatePath("/schedule");
  revalidatePath("/care");
  revalidatePath("/crm");
  revalidatePath("/work");
  revalidatePath("/today");
}
