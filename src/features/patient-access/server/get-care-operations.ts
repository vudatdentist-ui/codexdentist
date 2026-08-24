import "server-only";

import { noShowFollowUpSubject } from "@/features/patient-access/model";
import { getCrmWorkspace } from "@/lib/crm";
import { allowedClinicIds } from "@/lib/patient-access";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export type CareOperationsModel = {
  message: string | null;
  canMutate: boolean;
  noShows: Array<{
    appointmentId: string;
    clinicName: string;
    patientId: string;
    patientName: string;
    patientPhone: string | null;
    providerName: string;
    startsAt: string;
    startsAtLabel: string;
    reason: string;
    resolved: boolean;
  }>;
  openActivities: Array<{
    id: string;
    patientId: string | null;
    patientName: string | null;
    subject: string;
    type: string;
    channel: string | null;
    dueAt: string | null;
    dueAtIso: string | null;
  }>;
  leads: Array<{
    id: string;
    patientId: string | null;
    name: string;
    phone: string | null;
    status: string;
    nextFollowUpAt: string | null;
  }>;
};

export async function getCareOperationsModel(session: AppSession): Promise<CareOperationsModel> {
  const clinicIds = allowedClinicIds(session);
  const now = new Date();
  const from = new Date(now.getTime() - 14 * 24 * 60 * 60_000);
  const [crm, noShows] = await Promise.all([
    getCrmWorkspace(session),
    prisma.appointment.findMany({
      where: {
        clinicId: { in: clinicIds },
        status: "NO_SHOW",
        startsAt: { gte: from, lte: now },
      },
      include: {
        clinic: { select: { name: true } },
        patient: { select: { id: true, fullName: true, phone: true } },
        provider: { select: { fullName: true } },
      },
      orderBy: { startsAt: "desc" },
      take: 80,
    }),
  ]);

  const subjects = noShows.map((appointment) => noShowFollowUpSubject(appointment.id));
  const resolvedActivities = subjects.length
    ? await prisma.crmActivity.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: { in: clinicIds },
          completedAt: { not: null },
          subject: { in: subjects },
        },
        select: { subject: true },
      })
    : [];
  const resolvedSubjects = new Set(resolvedActivities.map((activity) => activity.subject));
  const patientNameById = new Map(crm.patients.map((patient) => [patient.id, patient.name]));

  return {
    message: crm.message,
    canMutate: crm.canMutate,
    noShows: noShows.map((appointment) => ({
      appointmentId: appointment.id,
      clinicName: appointment.clinic.name,
      patientId: appointment.patientId,
      patientName: appointment.patient.fullName,
      patientPhone: appointment.patient.phone,
      providerName: appointment.provider.fullName,
      startsAt: appointment.startsAt.toISOString(),
      startsAtLabel: vietnamDateTime(appointment.startsAt),
      reason: appointment.reason,
      resolved: resolvedSubjects.has(noShowFollowUpSubject(appointment.id)),
    })),
    openActivities: crm.activities
      .filter((activity) => !activity.completedAtIso)
      .sort((left, right) => {
        const leftTime = Date.parse(left.dueAtIso ?? left.createdAtIso);
        const rightTime = Date.parse(right.dueAtIso ?? right.createdAtIso);
        return leftTime - rightTime;
      })
      .slice(0, 80)
      .map((activity) => ({
        id: activity.id,
        patientId: activity.patientId,
        patientName: activity.patientId ? patientNameById.get(activity.patientId) ?? null : null,
        subject: activity.subject,
        type: activity.type,
        channel: activity.channel,
        dueAt: activity.dueAt,
        dueAtIso: activity.dueAtIso,
      })),
    leads: crm.leads.slice(0, 60).map((lead) => ({
      id: lead.id,
      patientId: lead.patientId,
      name: lead.name,
      phone: lead.phone,
      status: lead.status,
      nextFollowUpAt: lead.nextFollowUpAt,
    })),
  };
}

function vietnamDateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
