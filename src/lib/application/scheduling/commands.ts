import type { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { ApplicationCommandError } from "@/lib/application/errors";
import { databaseActorId } from "@/lib/form-validation";
import { allowedClinicIds } from "@/lib/patient-access";
import type { AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const schedulableProviderRoles: AppRole[] = ["DENTIST", "HYGIENIST", "CLINIC_MANAGER"];
export type AppointmentStatus = "REQUESTED" | "CONFIRMED" | "ARRIVED" | "IN_CHAIR" | "COMPLETED" | "NO_SHOW";
export type OperationalStatus = "READY" | "BUSY";

export async function createAppointmentCommand(session: AppSession, input: {
  clinicId: string;
  patientId: string;
  providerId: string;
  chairId: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string;
}) {
  requireAction(session, "appointment.create");
  const clinicIds = allowedClinicIds(session);
  if (!clinicIds.includes(input.clinicId)) throw new ApplicationCommandError("clinic-denied");

  const [clinic, patient, provider, chair] = await Promise.all([
    prisma.clinic.findFirst({ where: { id: input.clinicId, organizationId: session.organizationId, active: true }, select: { id: true } }),
    prisma.patient.findFirst({ where: { id: input.patientId, organizationId: session.organizationId, clinicId: input.clinicId }, select: { id: true } }),
    prisma.user.findFirst({
      where: {
        id: input.providerId,
        organizationId: session.organizationId,
        active: true,
        OR: [
          { role: { in: schedulableProviderRoles } },
          { roleAssignments: { some: { active: true, role: { in: schedulableProviderRoles }, OR: [{ clinicId: null }, { clinicId: input.clinicId }] } } },
        ],
        clinics: { some: { clinicId: input.clinicId } },
      },
      select: { id: true },
    }),
    input.chairId
      ? prisma.chair.findFirst({ where: { id: input.chairId, clinicId: input.clinicId, active: true }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  if (!clinic) throw new ApplicationCommandError("clinic-inactive");
  if (!patient || !provider || (input.chairId && !chair)) throw new ApplicationCommandError("invalid-relation");

  const conflict = await prisma.appointment.findFirst({
    where: {
      clinicId: input.clinicId,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
      OR: [{ providerId: input.providerId }, ...(input.chairId ? [{ chairId: input.chairId }] : [])],
    },
    select: { id: true },
  });
  if (conflict) throw new ApplicationCommandError("conflict");

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.create({
      data: {
        clinicId: input.clinicId,
        patientId: input.patientId,
        providerId: input.providerId,
        chairId: input.chairId,
        status: "CONFIRMED",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason,
        source: "staff",
      },
      select: { id: true },
    });
    await writeAuditLog(tx, session, "appointment.created", appointment.id, {
      clinicId: input.clinicId,
      patientId: input.patientId,
      providerId: input.providerId,
      chairId: input.chairId,
      startsAt: input.startsAt.toISOString(),
    });
    return appointment;
  });
}

export async function updateAppointmentStatusCommand(session: AppSession, input: {
  appointmentId: string;
  status: AppointmentStatus;
  requestedChairId?: string | null;
  releaseChair?: boolean;
}) {
  requireAction(session, "appointment.update");
  const appointment = await scopedAppointment(session, input.appointmentId, true);
  if (isBeforeTodayInVietnam(appointment.startsAt)) throw new ApplicationCommandError("past-appointment-locked");

  let nextChairId: string | undefined;
  if (input.status === "IN_CHAIR") {
    if (!input.requestedChairId) throw new ApplicationCommandError("missing-fields");
    const chair = await prisma.chair.findFirst({
      where: { id: input.requestedChairId, clinicId: appointment.clinicId, active: true },
      select: { id: true },
    });
    if (!chair) throw new ApplicationCommandError("invalid-relation");
    nextChairId = chair.id;
  }

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: input.status,
        ...(input.releaseChair ? { chairId: null } : nextChairId ? { chairId: nextChairId } : {}),
      },
    });
    if (input.status === "IN_CHAIR" && nextChairId) {
      await tx.chair.update({ where: { id: nextChairId }, data: { operationalStatus: "BUSY", operationalStatusUpdatedAt: new Date() } });
      await tx.user.update({ where: { id: appointment.providerId }, data: { operationalStatus: "BUSY", operationalStatusUpdatedAt: new Date() } });
    }
    await writeAuditLog(tx, session, "appointment.status_updated", appointment.id, {
      status: input.status,
      chairId: input.releaseChair ? null : nextChairId,
      releaseChair: Boolean(input.releaseChair),
    });
  });
  return appointment;
}

export async function cancelAppointmentCommand(session: AppSession, appointmentId: string) {
  requireAction(session, "appointment.cancel");
  const appointment = await scopedAppointment(session, appointmentId, false);
  if (isBeforeTodayInVietnam(appointment.startsAt)) throw new ApplicationCommandError("past-appointment-locked");
  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id: appointment.id }, data: { status: "CANCELLED" } });
    await writeAuditLog(tx, session, "appointment.cancelled", appointment.id);
  });
  return appointment;
}

export async function updateChairOperationalStatusCommand(session: AppSession, input: {
  chairId: string;
  status: OperationalStatus;
  appointmentId?: string | null;
}) {
  requireAction(session, "appointment.update");
  const clinicIds = allowedClinicIds(session);
  const chair = await prisma.chair.findFirst({ where: { id: input.chairId, clinicId: { in: clinicIds } }, select: { id: true, clinicId: true } });
  if (!chair) throw new ApplicationCommandError("invalid-relation");
  await prisma.$transaction(async (tx) => {
    await tx.chair.update({ where: { id: chair.id }, data: { operationalStatus: input.status, operationalStatusUpdatedAt: new Date() } });
    if (input.status === "READY" && input.appointmentId) {
      await tx.appointment.updateMany({ where: { id: input.appointmentId, chairId: chair.id, clinicId: chair.clinicId }, data: { chairId: null } });
    }
    await writeAuditLog(tx, session, "chair.operational_status_updated", chair.id, { status: input.status, appointmentId: input.appointmentId || null });
  });
}

export async function updateProviderOperationalStatusCommand(session: AppSession, input: {
  providerId: string;
  status: OperationalStatus;
}) {
  requireAction(session, "appointment.update");
  const clinicIds = allowedClinicIds(session);
  const provider = await prisma.user.findFirst({
    where: {
      id: input.providerId,
      organizationId: session.organizationId,
      active: true,
      OR: [
        { role: { in: schedulableProviderRoles } },
        { roleAssignments: { some: { active: true, role: { in: schedulableProviderRoles }, OR: [{ clinicId: null }, { clinicId: { in: clinicIds } }] } } },
      ],
      clinics: { some: { clinicId: { in: clinicIds } } },
    },
    select: { id: true },
  });
  if (!provider) throw new ApplicationCommandError("invalid-relation");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: provider.id }, data: { operationalStatus: input.status, operationalStatusUpdatedAt: new Date() } });
    await writeAuditLog(tx, session, "user.operational_status_updated", provider.id, { status: input.status });
  });
}

function requireAction(session: AppSession, action: Parameters<typeof canPerformAction>[1]) {
  if (!canPerformAction(session, action)) throw new ApplicationCommandError("denied");
}

async function scopedAppointment(session: AppSession, appointmentId: string, includeProvider: boolean) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId: { in: allowedClinicIds(session) } },
    select: { id: true, clinicId: true, patientId: true, startsAt: true, ...(includeProvider ? { providerId: true } : {}) },
  });
  if (!appointment) throw new ApplicationCommandError("not-found");
  return appointment as typeof appointment & { providerId: string };
}

async function writeAuditLog(tx: Prisma.TransactionClient, session: AppSession, action: string, entityId: string, metadata?: Record<string, unknown>) {
  await tx.auditLog.create({
    data: {
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action,
      entityType: "Appointment",
      entityId,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

function vietnamDateInput(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function isBeforeTodayInVietnam(date: Date) {
  return vietnamDateInput(date) < vietnamDateInput(new Date());
}
