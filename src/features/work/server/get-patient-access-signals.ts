import "server-only";

import { noShowFollowUpSubject } from "@/features/patient-access/model";
import { allowedClinicIds } from "@/lib/patient-access";
import { canAccessView } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import type { TaskInboxItemSummary } from "@/lib/task-inbox-types";

export async function getPatientAccessSignals(session: AppSession): Promise<TaskInboxItemSummary[]> {
  if (!canAccessView(session, "schedule")) return [];

  const now = new Date();
  const clinicIds = allowedClinicIds(session);
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const to = new Date(now.getTime() + 48 * 60 * 60_000);

  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId: { in: clinicIds },
      status: { in: ["REQUESTED", "CONFIRMED", "ARRIVED", "NO_SHOW"] },
      startsAt: { gte: from, lte: to },
    },
    include: {
      clinic: { select: { name: true } },
      patient: { select: { fullName: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 240,
  });

  const appointmentIds = appointments.map((appointment) => appointment.id);
  const [auditLogs, completedNoShowActivities] = await Promise.all([
    appointmentIds.length
      ? prisma.auditLog.findMany({
          where: {
            organizationId: session.organizationId,
            entityType: "Appointment",
            entityId: { in: appointmentIds },
            action: "appointment.status_updated",
          },
          select: { entityId: true, createdAt: true, metadata: true },
          orderBy: { createdAt: "desc" },
        })
      : [],
    canAccessView(session, "crm")
      ? prisma.crmActivity.findMany({
          where: {
            organizationId: session.organizationId,
            clinicId: { in: clinicIds },
            completedAt: { not: null },
            subject: { startsWith: "No-show follow-up · " },
            createdAt: { gte: from },
          },
          select: { subject: true },
        })
      : Promise.resolve([]),
  ]);

  const arrivalAtByAppointment = new Map<string, Date>();
  for (const log of auditLogs) {
    if (!log.entityId || arrivalAtByAppointment.has(log.entityId)) continue;
    if (metadataStatus(log.metadata) === "ARRIVED") {
      arrivalAtByAppointment.set(log.entityId, log.createdAt);
    }
  }
  const resolvedNoShowSubjects = new Set(completedNoShowActivities.map((activity) => activity.subject));

  const items: TaskInboxItemSummary[] = [];
  for (const appointment of appointments) {
    const startsAt = appointment.startsAt;
    const minutesToStart = Math.round((startsAt.getTime() - now.getTime()) / 60_000);
    const scheduleHref = `/schedule?date=${vietnamDate(startsAt)}&appointmentId=${encodeURIComponent(appointment.id)}`;

    if (appointment.status === "REQUESTED" && startsAt <= to) {
      items.push({
        id: `patient-access-confirm-${appointment.id}`,
        sourceId: appointment.id,
        kind: "schedule",
        priority: minutesToStart <= 120 ? "high" : "medium",
        title: "Lịch hẹn cần xác nhận",
        detail: `${vietnamTime(startsAt)} · ${appointment.patient.fullName}`,
        href: scheduleHref,
        dueAt: startsAt.toISOString(),
        patientName: appointment.patient.fullName,
        clinicName: appointment.clinic.name,
        status: "needs-confirmation",
        assignedToName: null,
        actionable: true,
        createdAt: null,
        actionUrl: scheduleHref,
      });
      continue;
    }

    if (appointment.status === "CONFIRMED") {
      const lateMinutes = Math.floor((now.getTime() - startsAt.getTime()) / 60_000);
      if (lateMinutes >= 15 && lateMinutes <= 180) {
        items.push({
          id: `patient-access-late-${appointment.id}`,
          sourceId: appointment.id,
          kind: "schedule",
          priority: lateMinutes >= 30 ? "high" : "medium",
          title: "Bệnh nhân chưa check-in",
          detail: `Trễ ${lateMinutes} phút · ${appointment.patient.fullName}`,
          href: scheduleHref,
          dueAt: startsAt.toISOString(),
          patientName: appointment.patient.fullName,
          clinicName: appointment.clinic.name,
          status: "late-arrival",
          assignedToName: null,
          actionable: true,
          createdAt: null,
          actionUrl: scheduleHref,
        });
      }
      continue;
    }

    if (appointment.status === "ARRIVED") {
      const arrivedAt = arrivalAtByAppointment.get(appointment.id) ?? appointment.updatedAt;
      const waitMinutes = Math.floor((now.getTime() - arrivedAt.getTime()) / 60_000);
      if (waitMinutes >= 20) {
        items.push({
          id: `patient-access-wait-${appointment.id}`,
          sourceId: appointment.id,
          kind: "schedule",
          priority: waitMinutes >= 45 ? "high" : "medium",
          title: "Bệnh nhân đang chờ lâu",
          detail: `${waitMinutes} phút · ${appointment.patient.fullName}`,
          href: scheduleHref,
          dueAt: arrivedAt.toISOString(),
          patientName: appointment.patient.fullName,
          clinicName: appointment.clinic.name,
          status: "waiting",
          assignedToName: null,
          actionable: true,
          createdAt: null,
          actionUrl: scheduleHref,
        });
      }
      continue;
    }

    if (
      appointment.status === "NO_SHOW" &&
      canAccessView(session, "crm") &&
      !resolvedNoShowSubjects.has(noShowFollowUpSubject(appointment.id))
    ) {
      const careHref = `/care?appointmentId=${encodeURIComponent(appointment.id)}`;
      items.push({
        id: `patient-access-no-show-${appointment.id}`,
        sourceId: appointment.id,
        kind: "crm",
        priority: "medium",
        title: "Cần chăm sóc sau no-show",
        detail: `${vietnamDateTime(startsAt)} · ${appointment.patient.fullName}`,
        href: careHref,
        dueAt: startsAt.toISOString(),
        patientName: appointment.patient.fullName,
        clinicName: appointment.clinic.name,
        status: "no-show-follow-up",
        assignedToName: null,
        actionable: true,
        createdAt: null,
        actionUrl: careHref,
      });
    }
  }

  return items;
}

function metadataStatus(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const status = (metadata as Record<string, unknown>).status;
  return typeof status === "string" ? status : null;
}

function vietnamDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function vietnamTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function vietnamDateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
