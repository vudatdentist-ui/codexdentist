"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { parseDateTimeInVietnam, requiredString } from "@/lib/form-validation";
import { applicationErrorCode } from "@/lib/application/errors";
import {
  cancelAppointmentCommand,
  createAppointmentCommand,
  updateAppointmentStatusCommand,
  updateChairOperationalStatusCommand,
  updateProviderOperationalStatusCommand,
  type AppointmentStatus,
  type OperationalStatus,
} from "@/lib/application/scheduling/commands";

const allowedStatusUpdates = ["REQUESTED", "CONFIRMED", "ARRIVED", "IN_CHAIR", "COMPLETED", "NO_SHOW"] as const;

function scheduleRedirect(
  notice: string,
  patientId?: string | null,
  context: {
    clinicId?: string | null;
    date?: string | null;
    dateTo?: string | null;
    providerId?: string | null;
    status?: string | null;
  } = {},
) {
  const params = new URLSearchParams({ notice });
  if (patientId) params.set("patientId", patientId);
  if (context.clinicId) params.set("clinicId", context.clinicId);
  if (context.date) params.set("date", context.date);
  if (context.dateTo) params.set("dateTo", context.dateTo);
  if (context.providerId) params.set("providerId", context.providerId);
  if (context.status) params.set("status", context.status);
  return `/schedule?${params.toString()}`;
}

export async function createAppointmentAction(formData: FormData) {
  const session = await requireViewSession("schedule");
  const clinicId = requiredString(formData.get("clinicId"));
  const patientId = requiredString(formData.get("patientId"));
  const providerId = requiredString(formData.get("providerId"));
  const chairId = requiredString(formData.get("chairId"));
  const date = requiredString(formData.get("date"));
  const startTime = requiredString(formData.get("startTime"));
  const duration = Number(formData.get("duration") ?? 30);
  const reason = requiredString(formData.get("reason"));

  if (!patientId || !providerId || !date || !startTime || !reason) {
    redirect(scheduleRedirect("missing-fields", patientId, { clinicId, date }));
  }
  if (!Number.isFinite(duration) || duration < 15 || duration > 240) {
    redirect(scheduleRedirect("bad-duration", patientId, { clinicId, date }));
  }
  const startsAt = parseDateTimeInVietnam(date, startTime);
  if (startsAt === "invalid") redirect(scheduleRedirect("bad-time", patientId, { clinicId, date }));

  try {
    await createAppointmentCommand(session, {
      clinicId,
      patientId,
      providerId,
      chairId: chairId || null,
      startsAt,
      endsAt: new Date(startsAt.getTime() + duration * 60000),
      reason,
    });
    revalidatePath("/schedule");
    redirect(scheduleRedirect("created", patientId, { clinicId, date }));
  } catch (error) {
    redirect(scheduleRedirect(applicationErrorCode(error, "database-unavailable"), patientId, { clinicId, date }));
  }
}

export async function updateAppointmentStatusAction(formData: FormData) {
  const session = await requireViewSession("schedule");
  const appointmentId = requiredString(formData.get("appointmentId"));
  const postedPatientId = requiredString(formData.get("patientId"));
  const status = requiredString(formData.get("status"));
  const redirectContext = scheduleContextFromForm(formData);

  if (!appointmentId || !isAllowedStatus(status)) {
    redirect(scheduleRedirect("bad-status", postedPatientId, redirectContext));
  }

  try {
    const appointment = await updateAppointmentStatusCommand(session, {
      appointmentId,
      status,
      requestedChairId: requiredString(formData.get("chairId")) || null,
      releaseChair: requiredString(formData.get("releaseChair")) === "1",
    });
    redirectContext.clinicId = redirectContext.clinicId ?? appointment.clinicId;
    redirectContext.date = redirectContext.date ?? vietnamDateInput(appointment.startsAt);
    revalidatePath("/schedule");
    redirect(scheduleRedirect("updated", appointment.patientId, redirectContext));
  } catch (error) {
    redirect(scheduleRedirect(applicationErrorCode(error, "database-unavailable"), postedPatientId, redirectContext));
  }
}

export async function cancelAppointmentAction(formData: FormData) {
  const session = await requireViewSession("schedule");
  const appointmentId = requiredString(formData.get("appointmentId"));
  const postedPatientId = requiredString(formData.get("patientId"));
  const redirectContext = scheduleContextFromForm(formData);
  if (!appointmentId) redirect(scheduleRedirect("not-found", postedPatientId, redirectContext));

  try {
    const appointment = await cancelAppointmentCommand(session, appointmentId);
    redirectContext.clinicId = redirectContext.clinicId ?? appointment.clinicId;
    redirectContext.date = redirectContext.date ?? vietnamDateInput(appointment.startsAt);
    revalidatePath("/schedule");
    redirect(scheduleRedirect("cancelled", appointment.patientId, redirectContext));
  } catch (error) {
    redirect(scheduleRedirect(applicationErrorCode(error, "database-unavailable"), postedPatientId, redirectContext));
  }
}

export async function updateChairOperationalStatusAction(formData: FormData) {
  const session = await requireViewSession("schedule");
  const chairId = requiredString(formData.get("chairId"));
  const status = normalizeOperationalStatus(requiredString(formData.get("operationalStatus")));
  const postedPatientId = requiredString(formData.get("patientId"));
  const redirectContext = scheduleContextFromForm(formData);
  if (!chairId || !status) redirect(scheduleRedirect("bad-status", postedPatientId, redirectContext));

  try {
    await updateChairOperationalStatusCommand(session, {
      chairId,
      status,
      appointmentId: requiredString(formData.get("appointmentId")) || null,
    });
    revalidatePath("/schedule");
    redirect(scheduleRedirect("updated", postedPatientId, redirectContext));
  } catch (error) {
    redirect(scheduleRedirect(applicationErrorCode(error, "database-unavailable"), postedPatientId, redirectContext));
  }
}

export async function updateProviderOperationalStatusAction(formData: FormData) {
  const session = await requireViewSession("schedule");
  const providerId = requiredString(formData.get("providerId"));
  const status = normalizeOperationalStatus(requiredString(formData.get("operationalStatus")));
  const postedPatientId = requiredString(formData.get("patientId"));
  const redirectContext = scheduleContextFromForm(formData);
  if (!providerId || !status) redirect(scheduleRedirect("bad-status", postedPatientId, redirectContext));

  try {
    await updateProviderOperationalStatusCommand(session, { providerId, status });
    revalidatePath("/schedule");
    redirect(scheduleRedirect("updated", postedPatientId, redirectContext));
  } catch (error) {
    redirect(scheduleRedirect(applicationErrorCode(error, "database-unavailable"), postedPatientId, redirectContext));
  }
}

function isAllowedStatus(status: string): status is AppointmentStatus {
  return allowedStatusUpdates.includes(status as AppointmentStatus);
}

function normalizeOperationalStatus(status: string): OperationalStatus | null {
  return status === "READY" || status === "BUSY" ? status : null;
}

function scheduleContextFromForm(formData: FormData) {
  const postedProviderId = requiredString(formData.get("providerFilter"));
  const postedStatus = requiredString(formData.get("statusFilter"));
  return {
    clinicId: requiredString(formData.get("clinicId")) || null,
    date: requiredString(formData.get("date")) || null,
    dateTo: requiredString(formData.get("dateTo")) || null,
    providerId: postedProviderId === "all" ? null : postedProviderId,
    status: postedStatus === "all" ? null : postedStatus,
  };
}

function vietnamDateInput(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
