"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import { canMutateCrm } from "@/lib/crm";
import {
  databaseActorId,
  optionalString,
  parseDateTimeInVietnam,
  requiredString,
} from "@/lib/form-validation";
import { allowedClinicIds } from "@/lib/patient-access";
import type { AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const schedulableProviderRoles: AppRole[] = ["DENTIST", "HYGIENIST", "CLINIC_MANAGER"];
const statusTransitions = {
  REQUESTED: ["CONFIRMED", "NO_SHOW"],
  CONFIRMED: ["ARRIVED", "NO_SHOW"],
  ARRIVED: ["IN_CHAIR"],
  IN_CHAIR: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
} as const;

type AppointmentStatus = keyof typeof statusTransitions;
type NextAppointmentStatus = (typeof statusTransitions)[AppointmentStatus][number];

export function noShowFollowUpSubject(appointmentId: string) {
  return `No-show follow-up · ${appointmentId}`;
}

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

  if (!clinicIds.includes(clinicId)) {
    redirect(patientAccessRedirect("clinic-denied", formData));
  }

  if (!patientId || !providerId || !date || !startTime || !reason) {
    redirect(patientAccessRedirect("missing-fields", formData));
  }

  if (!Number.isFinite(duration) || duration < 15 || duration > 240) {
    redirect(patientAccessRedirect("bad-duration", formData));
  }

  const startsAt = parseDateTimeInVietnam(date, startTime);
  if (startsAt === "invalid") {
    redirect(patientAccessRedirect("bad-time", formData));
  }
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);

  let notice: string | null = null;
  let createdId: string | null = null;

  try {
    const [clinic, patient, provider, chair] = await Promise.all([
      prisma.clinic.findFirst({
        where: { id: clinicId, organizationId: session.organizationId, active: true },
        select: { id: true },
      }),
      prisma.patient.findFirst({
        where: { id: patientId, organizationId: session.organizationId, clinicId },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: {
          id: providerId,
          organizationId: session.organizationId,
          active: true,
          OR: [
            { role: { in: schedulableProviderRoles } },
            {
              roleAssignments: {
                some: {
                  active: true,
                  role: { in: schedulableProviderRoles },
                  OR: [{ clinicId: null }, { clinicId }],
                },
              },
            },
          ],
          clinics: { some: { clinicId } },
        },
        select: { id: true },
      }),
      chairId
        ? prisma.chair.findFirst({
            where: { id: chairId, clinicId, active: true },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (!clinic) {
      notice = "clinic-inactive";
    } else if (!patient || !provider || (chairId && !chair)) {
      notice = "invalid-relation";
    } else {
      const conflict = await prisma.appointment.findFirst({
        where: {
          clinicId,
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          OR: [{ providerId }, ...(chairId ? [{ chairId }] : [])],
        },
        select: { id: true },
      });

      if (conflict) {
        notice = "conflict";
      } else {
        const appointment = await prisma.appointment.create({
          data: {
            clinicId,
            patientId,
            providerId,
            chairId: chairId || null,
            status: "CONFIRMED",
            startsAt,
            endsAt,
            reason,
            source: "staff",
          },
          select: { id: true },
        });
        createdId = appointment.id;
        await writeAppointmentAudit(session.organizationId, session.userId, "appointment.created", appointment.id, {
          clinicId,
          patientId,
          providerId,
          chairId: chairId || null,
          startsAt: startsAt.toISOString(),
          source: "patient-access-v1",
        });
      }
    }
  } catch {
    notice = "database-unavailable";
  }

  if (notice) {
    redirect(patientAccessRedirect(notice, formData));
  }

  revalidatePatientAccess();
  redirect(patientAccessRedirect("created", formData, createdId));
}

export async function transitionPatientAccessAppointmentAction(formData: FormData) {
  const session = await requireViewSession("schedule");

  if (!canPerformAction(session, "appointment.update")) {
    redirect(patientAccessRedirect("denied", formData));
  }

  const appointmentId = requiredString(formData.get("appointmentId"));
  const requestedStatus = requiredString(formData.get("status"));
  const requestedChairId = requiredString(formData.get("chairId"));
  const clinicIds = allowedClinicIds(session);

  if (!appointmentId || !isAppointmentStatus(requestedStatus)) {
    redirect(patientAccessRedirect("bad-status", formData));
  }

  let notice: string | null = null;

  try {
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId: { in: clinicIds } },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        providerId: true,
        chairId: true,
        status: true,
        startsAt: true,
      },
    });

    if (!appointment) {
      notice = "not-found";
    } else if (isBeforeTodayInVietnam(appointment.startsAt)) {
      notice = "past-appointment-locked";
    } else if (!canTransition(appointment.status as AppointmentStatus, requestedStatus)) {
      notice = "invalid-transition";
    } else {
      let nextChairId = appointment.chairId;

      if (requestedStatus === "IN_CHAIR") {
        if (!requestedChairId) {
          notice = "missing-chair";
        } else {
          const [chair, occupied] = await Promise.all([
            prisma.chair.findFirst({
              where: { id: requestedChairId, clinicId: appointment.clinicId, active: true },
              select: { id: true },
            }),
            prisma.appointment.findFirst({
              where: {
                id: { not: appointment.id },
                clinicId: appointment.clinicId,
                chairId: requestedChairId,
                status: "IN_CHAIR",
              },
              select: { id: true },
            }),
          ]);
          if (!chair) notice = "invalid-chair";
          else if (occupied) notice = "chair-busy";
          else nextChairId = chair.id;
        }
      }

      if (!notice) {
        await prisma.$transaction(async (tx) => {
          await tx.appointment.update({
            where: { id: appointment.id },
            data: {
              status: requestedStatus,
              ...(requestedStatus === "IN_CHAIR" && nextChairId ? { chairId: nextChairId } : {}),
            },
          });

          if (requestedStatus === "IN_CHAIR" && nextChairId) {
            await tx.chair.update({
              where: { id: nextChairId },
              data: { operationalStatus: "BUSY", operationalStatusUpdatedAt: new Date() },
            });
            await tx.user.update({
              where: { id: appointment.providerId },
              data: { operationalStatus: "BUSY", operationalStatusUpdatedAt: new Date() },
            });
          }

          if (requestedStatus === "COMPLETED") {
            if (appointment.chairId) {
              await tx.chair.updateMany({
                where: { id: appointment.chairId, clinicId: appointment.clinicId },
                data: { operationalStatus: "READY", operationalStatusUpdatedAt: new Date() },
              });
            }
            await tx.user.updateMany({
              where: { id: appointment.providerId, organizationId: session.organizationId },
              data: { operationalStatus: "READY", operationalStatusUpdatedAt: new Date() },
            });
          }
        });

        await writeAppointmentAudit(
          session.organizationId,
          session.userId,
          "appointment.status_updated",
          appointment.id,
          {
            fromStatus: appointment.status,
            status: requestedStatus,
            chairId: requestedStatus === "IN_CHAIR" ? nextChairId : appointment.chairId,
            source: "patient-access-v1",
          },
        );
      }
    }
  } catch {
    notice = "database-unavailable";
  }

  if (notice) {
    redirect(patientAccessRedirect(notice, formData, appointmentId));
  }

  revalidatePatientAccess();
  redirect(patientAccessRedirect("updated", formData, appointmentId));
}

export async function cancelPatientAccessAppointmentAction(formData: FormData) {
  const session = await requireViewSession("schedule");

  if (!canPerformAction(session, "appointment.cancel")) {
    redirect(patientAccessRedirect("denied", formData));
  }

  const appointmentId = requiredString(formData.get("appointmentId"));
  if (!appointmentId) redirect(patientAccessRedirect("not-found", formData));

  const clinicIds = allowedClinicIds(session);
  let notice: string | null = null;

  try {
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId: { in: clinicIds } },
      select: { id: true, status: true, startsAt: true },
    });

    if (!appointment) notice = "not-found";
    else if (isBeforeTodayInVietnam(appointment.startsAt)) notice = "past-appointment-locked";
    else if (["IN_CHAIR", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status)) {
      notice = "invalid-transition";
    } else {
      await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "CANCELLED" } });
      await writeAppointmentAudit(session.organizationId, session.userId, "appointment.cancelled", appointment.id, {
        fromStatus: appointment.status,
        source: "patient-access-v1",
      });
    }
  } catch {
    notice = "database-unavailable";
  }

  if (notice) redirect(patientAccessRedirect(notice, formData, appointmentId));
  revalidatePatientAccess();
  redirect(patientAccessRedirect("cancelled", formData, appointmentId));
}

export async function recordNoShowRecoveryAction(formData: FormData) {
  const session = await requireViewSession("crm");
  if (!canMutateCrm(session)) redirect(careRedirect("crm-denied", formData));

  const appointmentId = requiredString(formData.get("appointmentId"));
  const channel = normalizeCareChannel(requiredString(formData.get("channel")));
  const note = optionalString(formData.get("note"));

  if (!appointmentId || !channel) redirect(careRedirect("crm-missing", formData));

  const clinicIds = allowedClinicIds(session);
  let notice: string | null = null;

  try {
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId: { in: clinicIds }, status: "NO_SHOW" },
      include: { patient: { select: { id: true, fullName: true } } },
    });

    if (!appointment) {
      notice = "no-show-not-found";
    } else {
      const subject = noShowFollowUpSubject(appointment.id);
      const existing = await prisma.crmActivity.findFirst({
        where: {
          organizationId: session.organizationId,
          patientId: appointment.patientId,
          subject,
          completedAt: { not: null },
        },
        select: { id: true },
      });

      if (!existing) {
        const activity = await prisma.crmActivity.create({
          data: {
            organizationId: session.organizationId,
            clinicId: appointment.clinicId,
            patientId: appointment.patientId,
            actorId: databaseActorId(session.userId),
            type: "FOLLOW_UP",
            channel,
            subject,
            body: note,
            completedAt: new Date(),
          },
          select: { id: true },
        });
        await writeGenericAudit(session.organizationId, session.userId, "patient_access.no_show_recovered", "CrmActivity", activity.id, {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          channel,
        });
      }
    }
  } catch {
    notice = "crm-database";
  }

  if (notice) redirect(careRedirect(notice, formData));
  revalidatePatientAccess();
  redirect(careRedirect("no-show-recovered", formData));
}

export async function completeCareActivityAction(formData: FormData) {
  const session = await requireViewSession("crm");
  if (!canMutateCrm(session)) redirect(careRedirect("crm-denied", formData));

  const activityId = requiredString(formData.get("activityId"));
  if (!activityId) redirect(careRedirect("crm-missing", formData));

  const clinicIds = allowedClinicIds(session);
  let notice: string | null = null;

  try {
    const activity = await prisma.crmActivity.findFirst({
      where: {
        id: activityId,
        organizationId: session.organizationId,
        OR: [{ clinicId: null }, { clinicId: { in: clinicIds } }],
      },
      select: { id: true, completedAt: true },
    });
    if (!activity) notice = "crm-patient-not-found";
    else if (!activity.completedAt) {
      await prisma.crmActivity.update({ where: { id: activity.id }, data: { completedAt: new Date() } });
      await writeGenericAudit(session.organizationId, session.userId, "crm_activity.completed", "CrmActivity", activity.id);
    }
  } catch {
    notice = "crm-database";
  }

  if (notice) redirect(careRedirect(notice, formData));
  revalidatePatientAccess();
  redirect(careRedirect("care-activity-completed", formData));
}

function canTransition(from: AppointmentStatus, to: AppointmentStatus) {
  if (from === to) return true;
  return (statusTransitions[from] as readonly string[]).includes(to as NextAppointmentStatus);
}

function isAppointmentStatus(value: string): value is AppointmentStatus {
  return value in statusTransitions;
}

function normalizeCareChannel(value: string) {
  return ["PHONE", "ZALO", "SMS", "EMAIL", "IN_APP"].includes(value) ? value as "PHONE" | "ZALO" | "SMS" | "EMAIL" | "IN_APP" : null;
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

async function writeAppointmentAudit(
  organizationId: string,
  userId: string,
  action: string,
  entityId: string,
  metadata?: Record<string, unknown>,
) {
  await writeGenericAudit(organizationId, userId, action, "Appointment", entityId, metadata);
}

async function writeGenericAudit(
  organizationId: string,
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: {
      organizationId,
      actorId: databaseActorId(userId),
      action,
      entityType,
      entityId,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

function vietnamDateInput(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isBeforeTodayInVietnam(date: Date) {
  return vietnamDateInput(date) < vietnamDateInput(new Date());
}
