import "server-only";

import type { Prisma } from "@prisma/client";
import { noShowFollowUpSubject } from "@/features/patient-access/model";
import { databaseActorId } from "@/lib/form-validation";
import type { AppRole } from "@/lib/permissions";
import { runSerializableTransaction } from "@/lib/transaction";

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

export type PatientAccessAppointmentStatus = keyof typeof statusTransitions;
export type PatientAccessOperationCode =
  | "clinic-inactive"
  | "invalid-relation"
  | "conflict"
  | "not-found"
  | "past-appointment-locked"
  | "invalid-transition"
  | "missing-chair"
  | "invalid-chair"
  | "chair-busy"
  | "provider-busy"
  | "no-show-not-found"
  | "crm-patient-not-found";

export class PatientAccessOperationError extends Error {
  constructor(public readonly code: PatientAccessOperationCode) {
    super(code);
    this.name = "PatientAccessOperationError";
  }
}

export async function createPatientAccessAppointment(input: {
  organizationId: string;
  userId: string;
  clinicIds: string[];
  clinicId: string;
  patientId: string;
  providerId: string;
  chairId: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string;
}) {
  if (!input.clinicIds.includes(input.clinicId)) {
    throw new PatientAccessOperationError("invalid-relation");
  }

  return runSerializableTransaction(async (tx) => {
    if (input.chairId) {
      await lockChair(tx, input.chairId, input.clinicId, "invalid-relation");
    }
    await lockProvider(tx, input.providerId, input.organizationId, input.clinicId);

    const [clinic, patient, provider, chair] = await Promise.all([
      tx.clinic.findFirst({
        where: {
          id: input.clinicId,
          organizationId: input.organizationId,
          active: true,
        },
        select: { id: true },
      }),
      tx.patient.findFirst({
        where: {
          id: input.patientId,
          organizationId: input.organizationId,
          clinicId: input.clinicId,
        },
        select: { id: true },
      }),
      tx.user.findFirst({
        where: {
          id: input.providerId,
          organizationId: input.organizationId,
          active: true,
          OR: [
            { role: { in: schedulableProviderRoles } },
            {
              roleAssignments: {
                some: {
                  active: true,
                  role: { in: schedulableProviderRoles },
                  OR: [{ clinicId: null }, { clinicId: input.clinicId }],
                },
              },
            },
          ],
          clinics: { some: { clinicId: input.clinicId } },
        },
        select: { id: true },
      }),
      input.chairId
        ? tx.chair.findFirst({
            where: { id: input.chairId, clinicId: input.clinicId, active: true },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (!clinic) throw new PatientAccessOperationError("clinic-inactive");
    if (!patient || !provider || (input.chairId && !chair)) {
      throw new PatientAccessOperationError("invalid-relation");
    }

    const conflict = await tx.appointment.findFirst({
      where: {
        clinicId: input.clinicId,
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
        OR: [{ providerId: input.providerId }, ...(input.chairId ? [{ chairId: input.chairId }] : [])],
      },
      select: { id: true },
    });
    if (conflict) throw new PatientAccessOperationError("conflict");

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

    await writeAudit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      action: "appointment.created",
      entityType: "Appointment",
      entityId: appointment.id,
      metadata: {
        clinicId: input.clinicId,
        patientId: input.patientId,
        providerId: input.providerId,
        chairId: input.chairId,
        startsAt: input.startsAt.toISOString(),
        source: "patient-access-v1",
      },
    });

    return appointment;
  });
}

export async function transitionPatientAccessAppointment(input: {
  organizationId: string;
  userId: string;
  clinicIds: string[];
  appointmentId: string;
  requestedStatus: PatientAccessAppointmentStatus;
  requestedChairId: string | null;
}) {
  return runSerializableTransaction(async (tx) => {
    await lockAppointment(tx, input.appointmentId, input.clinicIds);
    const appointment = await tx.appointment.findFirst({
      where: { id: input.appointmentId, clinicId: { in: input.clinicIds } },
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

    if (!appointment) throw new PatientAccessOperationError("not-found");
    if (isBeforeTodayInVietnam(appointment.startsAt)) {
      throw new PatientAccessOperationError("past-appointment-locked");
    }
    if (appointment.status === input.requestedStatus) return appointment;
    if (!canTransition(appointment.status as PatientAccessAppointmentStatus, input.requestedStatus)) {
      throw new PatientAccessOperationError("invalid-transition");
    }

    let nextChairId = appointment.chairId;
    if (input.requestedStatus === "IN_CHAIR") {
      if (!input.requestedChairId) throw new PatientAccessOperationError("missing-chair");
      await lockChair(tx, input.requestedChairId, appointment.clinicId, "invalid-chair");
      await lockProvider(tx, appointment.providerId, input.organizationId);

      const chair = await tx.chair.findFirst({
        where: { id: input.requestedChairId, clinicId: appointment.clinicId, active: true },
        select: { id: true },
      });
      if (!chair) throw new PatientAccessOperationError("invalid-chair");

      const [chairOccupant, providerOccupant] = await Promise.all([
        tx.appointment.findFirst({
          where: {
            id: { not: appointment.id },
            clinicId: appointment.clinicId,
            chairId: input.requestedChairId,
            status: "IN_CHAIR",
          },
          select: { id: true },
        }),
        tx.appointment.findFirst({
          where: {
            id: { not: appointment.id },
            clinicId: appointment.clinicId,
            providerId: appointment.providerId,
            status: "IN_CHAIR",
          },
          select: { id: true },
        }),
      ]);
      if (chairOccupant) throw new PatientAccessOperationError("chair-busy");
      if (providerOccupant) throw new PatientAccessOperationError("provider-busy");
      nextChairId = chair.id;
    }

    if (input.requestedStatus === "COMPLETED") {
      if (appointment.chairId) {
        await lockChair(tx, appointment.chairId, appointment.clinicId, "invalid-chair");
      }
      await lockProvider(tx, appointment.providerId, input.organizationId);
    }

    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: input.requestedStatus,
        ...(input.requestedStatus === "IN_CHAIR" && nextChairId ? { chairId: nextChairId } : {}),
      },
      select: { id: true, patientId: true, clinicId: true, providerId: true, chairId: true, status: true },
    });

    if (input.requestedStatus === "IN_CHAIR" && nextChairId) {
      await tx.chair.update({
        where: { id: nextChairId },
        data: { operationalStatus: "BUSY", operationalStatusUpdatedAt: new Date() },
      });
      await tx.user.update({
        where: { id: appointment.providerId },
        data: { operationalStatus: "BUSY", operationalStatusUpdatedAt: new Date() },
      });
    }

    if (input.requestedStatus === "COMPLETED") {
      if (appointment.chairId) {
        const otherChairUse = await tx.appointment.findFirst({
          where: {
            id: { not: appointment.id },
            clinicId: appointment.clinicId,
            chairId: appointment.chairId,
            status: "IN_CHAIR",
          },
          select: { id: true },
        });
        if (!otherChairUse) {
          await tx.chair.updateMany({
            where: { id: appointment.chairId, clinicId: appointment.clinicId },
            data: { operationalStatus: "READY", operationalStatusUpdatedAt: new Date() },
          });
        }
      }

      const otherProviderUse = await tx.appointment.findFirst({
        where: {
          id: { not: appointment.id },
          clinicId: appointment.clinicId,
          providerId: appointment.providerId,
          status: "IN_CHAIR",
        },
        select: { id: true },
      });
      if (!otherProviderUse) {
        await tx.user.updateMany({
          where: { id: appointment.providerId, organizationId: input.organizationId },
          data: { operationalStatus: "READY", operationalStatusUpdatedAt: new Date() },
        });
      }
    }

    await writeAudit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      action: "appointment.status_updated",
      entityType: "Appointment",
      entityId: appointment.id,
      metadata: {
        fromStatus: appointment.status,
        status: input.requestedStatus,
        chairId: input.requestedStatus === "IN_CHAIR" ? nextChairId : appointment.chairId,
        source: "patient-access-v1",
      },
    });

    return updated;
  });
}

export async function cancelPatientAccessAppointment(input: {
  organizationId: string;
  userId: string;
  clinicIds: string[];
  appointmentId: string;
}) {
  return runSerializableTransaction(async (tx) => {
    await lockAppointment(tx, input.appointmentId, input.clinicIds);
    const appointment = await tx.appointment.findFirst({
      where: { id: input.appointmentId, clinicId: { in: input.clinicIds } },
      select: { id: true, status: true, startsAt: true },
    });

    if (!appointment) throw new PatientAccessOperationError("not-found");
    if (isBeforeTodayInVietnam(appointment.startsAt)) {
      throw new PatientAccessOperationError("past-appointment-locked");
    }
    if (appointment.status === "CANCELLED") return appointment;
    if (["IN_CHAIR", "COMPLETED", "NO_SHOW"].includes(appointment.status)) {
      throw new PatientAccessOperationError("invalid-transition");
    }

    await tx.appointment.update({ where: { id: appointment.id }, data: { status: "CANCELLED" } });
    await writeAudit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      action: "appointment.cancelled",
      entityType: "Appointment",
      entityId: appointment.id,
      metadata: { fromStatus: appointment.status, source: "patient-access-v1" },
    });
    return appointment;
  });
}

export async function recordNoShowRecovery(input: {
  organizationId: string;
  userId: string;
  clinicIds: string[];
  appointmentId: string;
  channel: "PHONE" | "ZALO" | "SMS" | "EMAIL" | "IN_APP";
  note: string | null;
}) {
  return runSerializableTransaction(async (tx) => {
    await lockAppointment(tx, input.appointmentId, input.clinicIds, "no-show-not-found");
    const appointment = await tx.appointment.findFirst({
      where: {
        id: input.appointmentId,
        clinicId: { in: input.clinicIds },
        status: "NO_SHOW",
      },
      select: { id: true, clinicId: true, patientId: true },
    });
    if (!appointment) throw new PatientAccessOperationError("no-show-not-found");

    const subject = noShowFollowUpSubject(appointment.id);
    const existing = await tx.crmActivity.findFirst({
      where: {
        organizationId: input.organizationId,
        patientId: appointment.patientId,
        subject,
        completedAt: { not: null },
      },
      select: { id: true },
    });
    if (existing) return existing;

    const activity = await tx.crmActivity.create({
      data: {
        organizationId: input.organizationId,
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        actorId: databaseActorId(input.userId),
        type: "FOLLOW_UP",
        channel: input.channel,
        subject,
        body: input.note,
        completedAt: new Date(),
      },
      select: { id: true },
    });

    await writeAudit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      action: "patient_access.no_show_recovered",
      entityType: "CrmActivity",
      entityId: activity.id,
      metadata: {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        channel: input.channel,
      },
    });
    return activity;
  });
}

export async function completeCareActivity(input: {
  organizationId: string;
  userId: string;
  clinicIds: string[];
  activityId: string;
}) {
  return runSerializableTransaction(async (tx) => {
    const scopedActivity = await tx.crmActivity.findFirst({
      where: {
        id: input.activityId,
        organizationId: input.organizationId,
        OR: [{ clinicId: null }, { clinicId: { in: input.clinicIds } }],
      },
      select: { id: true },
    });
    if (!scopedActivity) throw new PatientAccessOperationError("crm-patient-not-found");

    const activityLock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CrmActivity" WHERE "id" = ${input.activityId} FOR UPDATE
    `;
    if (activityLock.length !== 1) throw new PatientAccessOperationError("crm-patient-not-found");

    const activity = await tx.crmActivity.findFirst({
      where: {
        id: input.activityId,
        organizationId: input.organizationId,
        OR: [{ clinicId: null }, { clinicId: { in: input.clinicIds } }],
      },
      select: { id: true, completedAt: true },
    });
    if (!activity) throw new PatientAccessOperationError("crm-patient-not-found");
    if (activity.completedAt) return activity;

    const updated = await tx.crmActivity.update({
      where: { id: activity.id },
      data: { completedAt: new Date() },
      select: { id: true, completedAt: true },
    });
    await writeAudit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      action: "crm_activity.completed",
      entityType: "CrmActivity",
      entityId: activity.id,
    });
    return updated;
  });
}

export function isPatientAccessAppointmentStatus(value: string): value is PatientAccessAppointmentStatus {
  return value in statusTransitions;
}

function canTransition(from: PatientAccessAppointmentStatus, to: PatientAccessAppointmentStatus) {
  return (statusTransitions[from] as readonly string[]).includes(to);
}

async function lockAppointment(
  tx: Prisma.TransactionClient,
  appointmentId: string,
  clinicIds: string[],
  notFoundCode: "not-found" | "no-show-not-found" = "not-found",
) {
  const scoped = await tx.appointment.findFirst({
    where: { id: appointmentId, clinicId: { in: clinicIds } },
    select: { id: true },
  });
  if (!scoped) throw new PatientAccessOperationError(notFoundCode);

  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Appointment" WHERE "id" = ${appointmentId} FOR UPDATE
  `;
  if (locked.length !== 1) throw new PatientAccessOperationError(notFoundCode);
}

async function lockChair(
  tx: Prisma.TransactionClient,
  chairId: string,
  clinicId: string,
  scopeErrorCode: "invalid-chair" | "invalid-relation",
) {
  const scoped = await tx.chair.findFirst({
    where: { id: chairId, clinicId },
    select: { id: true },
  });
  if (!scoped) throw new PatientAccessOperationError(scopeErrorCode);

  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Chair" WHERE "id" = ${chairId} FOR UPDATE
  `;
  if (locked.length !== 1) throw new PatientAccessOperationError(scopeErrorCode);
}

async function lockProvider(
  tx: Prisma.TransactionClient,
  providerId: string,
  organizationId: string,
  clinicId?: string,
) {
  if (clinicId) {
    const scoped = await tx.user.findFirst({
      where: {
        id: providerId,
        organizationId,
        clinics: { some: { clinicId } },
      },
      select: { id: true },
    });
    if (!scoped) throw new PatientAccessOperationError("invalid-relation");
  }

  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User"
    WHERE "id" = ${providerId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;
  if (locked.length !== 1) throw new PatientAccessOperationError("invalid-relation");
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: databaseActorId(input.userId),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
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
