import "server-only";

import { canPerformAction } from "@/lib/actions/permissions";
import { allowedClinicIds } from "@/lib/patient-access";
import type { AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const schedulableProviderRoles: AppRole[] = ["DENTIST", "HYGIENIST", "CLINIC_MANAGER"];

export type PatientAccessStatus =
  | "REQUESTED"
  | "CONFIRMED"
  | "ARRIVED"
  | "IN_CHAIR"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export type PatientAccessAppointmentRow = {
  id: string;
  clinicId: string;
  clinicName: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  providerId: string;
  providerName: string;
  chairId: string | null;
  chairName: string | null;
  status: PatientAccessStatus;
  reason: string;
  source: string;
  startsAt: string;
  endsAt: string;
  timeLabel: string;
  arrivedAt: string | null;
  inChairAt: string | null;
  waitMinutes: number | null;
};

export type PatientAccessModel = {
  date: string;
  dateLabel: string;
  generatedAt: string;
  canCreate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
  clinics: Array<{ id: string; name: string }>;
  patients: Array<{ id: string; clinicId: string; name: string; phone: string | null }>;
  providers: Array<{ id: string; name: string; clinicIds: string[] }>;
  chairs: Array<{ id: string; name: string; clinicId: string; operationalStatus: string }>;
  appointments: PatientAccessAppointmentRow[];
  confirmation: PatientAccessAppointmentRow[];
  activeFlow: PatientAccessAppointmentRow[];
  completed: PatientAccessAppointmentRow[];
  exceptions: Array<{
    appointmentId: string;
    patientId: string;
    kind: "needs-confirmation" | "late" | "waiting";
    label: string;
    detail: string;
  }>;
};

export async function getPatientAccessModel(
  session: AppSession,
  requestedDate?: string | null,
): Promise<PatientAccessModel> {
  const date = normalizeDate(requestedDate);
  const { start, end } = vietnamDayRange(date);
  const clinicIds = allowedClinicIds(session);

  const [clinics, patients, providers, chairs, appointments] = await Promise.all([
    prisma.clinic.findMany({
      where: { organizationId: session.organizationId, id: { in: clinicIds }, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.patient.findMany({
      where: {
        organizationId: session.organizationId,
        clinicId: { in: clinicIds },
      },
      select: { id: true, clinicId: true, fullName: true, phone: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.user.findMany({
      where: {
        organizationId: session.organizationId,
        active: true,
        OR: [
          { role: { in: schedulableProviderRoles } },
          {
            roleAssignments: {
              some: {
                active: true,
                role: { in: schedulableProviderRoles },
                OR: [{ clinicId: null }, { clinicId: { in: clinicIds } }],
              },
            },
          },
        ],
        clinics: { some: { clinicId: { in: clinicIds } } },
      },
      select: {
        id: true,
        fullName: true,
        clinics: { select: { clinicId: true } },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.chair.findMany({
      where: { clinicId: { in: clinicIds }, active: true },
      select: { id: true, clinicId: true, name: true, operationalStatus: true },
      orderBy: [{ clinicId: "asc" }, { name: "asc" }],
    }),
    prisma.appointment.findMany({
      where: {
        clinicId: { in: clinicIds },
        startsAt: { gte: start, lt: end },
      },
      include: {
        clinic: { select: { name: true } },
        patient: { select: { id: true, fullName: true, phone: true } },
        provider: { select: { id: true, fullName: true } },
        chair: { select: { id: true, name: true } },
      },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const appointmentIds = appointments.map((appointment) => appointment.id);
  const auditLogs = appointmentIds.length
    ? await prisma.auditLog.findMany({
        where: {
          organizationId: session.organizationId,
          entityType: "Appointment",
          entityId: { in: appointmentIds },
          action: "appointment.status_updated",
        },
        select: { entityId: true, createdAt: true, metadata: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const statusTimes = new Map<string, { arrivedAt: Date | null; inChairAt: Date | null }>();
  for (const log of auditLogs) {
    if (!log.entityId) continue;
    const status = metadataStatus(log.metadata);
    const current = statusTimes.get(log.entityId) ?? { arrivedAt: null, inChairAt: null };
    if (status === "ARRIVED") current.arrivedAt = log.createdAt;
    if (status === "IN_CHAIR") current.inChairAt = log.createdAt;
    statusTimes.set(log.entityId, current);
  }

  const now = new Date();
  const rows: PatientAccessAppointmentRow[] = appointments.map((appointment) => {
    const times = statusTimes.get(appointment.id);
    const arrivedAt = times?.arrivedAt ?? null;
    const waitEnd = times?.inChairAt ?? (appointment.status === "ARRIVED" ? now : null);
    const waitMinutes = arrivedAt && waitEnd
      ? Math.max(0, Math.floor((waitEnd.getTime() - arrivedAt.getTime()) / 60_000))
      : null;

    return {
      id: appointment.id,
      clinicId: appointment.clinicId,
      clinicName: appointment.clinic.name,
      patientId: appointment.patientId,
      patientName: appointment.patient.fullName,
      patientPhone: appointment.patient.phone,
      providerId: appointment.providerId,
      providerName: appointment.provider.fullName,
      chairId: appointment.chairId,
      chairName: appointment.chair?.name ?? null,
      status: appointment.status,
      reason: appointment.reason,
      source: appointment.source,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      timeLabel: vietnamTime(appointment.startsAt),
      arrivedAt: arrivedAt?.toISOString() ?? null,
      inChairAt: times?.inChairAt?.toISOString() ?? null,
      waitMinutes,
    };
  });

  const exceptions: PatientAccessModel["exceptions"] = [];
  for (const row of rows) {
    if (row.status === "REQUESTED") {
      exceptions.push({
        appointmentId: row.id,
        patientId: row.patientId,
        kind: "needs-confirmation",
        label: "Cần xác nhận",
        detail: `${row.timeLabel} · ${row.patientName}`,
      });
      continue;
    }
    if (row.status === "CONFIRMED" && new Date(row.startsAt).getTime() < now.getTime() - 15 * 60_000) {
      exceptions.push({
        appointmentId: row.id,
        patientId: row.patientId,
        kind: "late",
        label: "Chưa check-in",
        detail: `${row.timeLabel} · ${row.patientName}`,
      });
      continue;
    }
    if (row.status === "ARRIVED" && (row.waitMinutes ?? 0) >= 20) {
      exceptions.push({
        appointmentId: row.id,
        patientId: row.patientId,
        kind: "waiting",
        label: "Đang chờ lâu",
        detail: `${row.waitMinutes} phút · ${row.patientName}`,
      });
    }
  }

  return {
    date,
    dateLabel: vietnamDateLabel(start),
    generatedAt: now.toISOString(),
    canCreate: canPerformAction(session, "appointment.create"),
    canUpdate: canPerformAction(session, "appointment.update"),
    canCancel: canPerformAction(session, "appointment.cancel"),
    clinics,
    patients: patients.map((patient) => ({
      id: patient.id,
      clinicId: patient.clinicId,
      name: patient.fullName,
      phone: patient.phone,
    })),
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.fullName,
      clinicIds: provider.clinics.map((clinic) => clinic.clinicId).filter((id) => clinicIds.includes(id)),
    })),
    chairs,
    appointments: rows,
    confirmation: rows.filter((row) => row.status === "REQUESTED"),
    activeFlow: rows.filter((row) => ["CONFIRMED", "ARRIVED", "IN_CHAIR"].includes(row.status)),
    completed: rows.filter((row) => ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(row.status)),
    exceptions,
  };
}

function metadataStatus(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const status = (metadata as Record<string, unknown>).status;
  return typeof status === "string" ? status : null;
}

function normalizeDate(value?: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function vietnamDayRange(date: string) {
  return {
    start: new Date(`${date}T00:00:00+07:00`),
    end: new Date(`${date}T23:59:59.999+07:00`),
  };
}

function vietnamTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function vietnamDateLabel(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}
