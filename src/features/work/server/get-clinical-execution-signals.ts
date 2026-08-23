import "server-only";

import { prisma } from "@/lib/prisma";
import { canAccessView } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";
import type { TaskInboxItemSummary } from "@/lib/task-inbox-types";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALLED_TREATMENT_DAYS = 14;
const UNSIGNED_CLINICAL_HOURS = 24;

export async function getClinicalExecutionSignals(
  session: AppSession,
): Promise<TaskInboxItemSummary[]> {
  const now = new Date();
  const canViewTreatment = canAccessView(session, "treatment");
  const canViewClinical = canAccessView(session, "clinical");

  const [treatmentServices, clinicalNotes] = await Promise.all([
    canViewTreatment
      ? prisma.treatmentService.findMany({
          where: {
            organizationId: session.organizationId,
            clinicId: {
              in: session.clinicIds,
            },
            status: "IN_PROGRESS",
          },
          select: {
            id: true,
            patientId: true,
            serviceCode: true,
            serviceName: true,
            currentProgressPercent: true,
            createdAt: true,
            patient: {
              select: {
                fullName: true,
              },
            },
            clinic: {
              select: {
                name: true,
              },
            },
            progressEvents: {
              select: {
                occurredAt: true,
              },
              orderBy: {
                occurredAt: "desc",
              },
              take: 1,
            },
          },
          orderBy: {
            createdAt: "asc",
          },
          take: 80,
        })
      : Promise.resolve([]),
    canViewClinical
      ? prisma.clinicalNote.findMany({
          where: {
            lockedAt: null,
            patient: {
              organizationId: session.organizationId,
              clinicId: {
                in: session.clinicIds,
              },
            },
          },
          select: {
            id: true,
            createdAt: true,
            assessment: true,
            patient: {
              select: {
                id: true,
                fullName: true,
                clinic: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            author: {
              select: {
                fullName: true,
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
          take: 60,
        })
      : Promise.resolve([]),
  ]);

  const stalledCutoff = new Date(
    now.getTime() - STALLED_TREATMENT_DAYS * DAY_MS,
  );
  const unsignedCutoff = new Date(
    now.getTime() - UNSIGNED_CLINICAL_HOURS * 60 * 60 * 1000,
  );

  const treatmentSignals = treatmentServices.flatMap((service) => {
    const latestActivityAt = service.progressEvents[0]?.occurredAt ?? service.createdAt;

    if (latestActivityAt > stalledCutoff) {
      return [];
    }

    const actionUrl = `/patients/${encodeURIComponent(service.patientId)}/treatments/${encodeURIComponent(service.id)}`;

    return [
      {
        id: `signal-treatment-stalled-${service.id}`,
        sourceId: service.id,
        kind: "treatment" as const,
        priority: "high" as const,
        title: `Ca điều trị chậm: ${service.serviceName}`,
        detail: `${Math.round(Number(service.currentProgressPercent))}% · ${service.serviceCode}`,
        href: actionUrl,
        dueAt: vietnamDateTime(latestActivityAt),
        patientName: service.patient.fullName,
        clinicName: service.clinic.name,
        status: "STALLED",
        assignedToName: null,
        actionable: true,
        createdAt: vietnamDateTime(latestActivityAt),
        channel: null,
        actionUrl,
      },
    ];
  });

  const clinicalSignals = clinicalNotes.flatMap((note) => {
    if (note.createdAt > unsignedCutoff) {
      return [];
    }

    const actionUrl = `/patients/${encodeURIComponent(note.patient.id)}`;

    return [
      {
        id: `signal-clinical-unsigned-${note.id}`,
        sourceId: note.id,
        kind: "clinical" as const,
        priority: "high" as const,
        title: "Hồ sơ lâm sàng chưa ký",
        detail: note.assessment || `Tác giả: ${note.author.fullName}`,
        href: actionUrl,
        dueAt: vietnamDateTime(note.createdAt),
        patientName: note.patient.fullName,
        clinicName: note.patient.clinic.name,
        status: "UNSIGNED",
        assignedToName: note.author.fullName,
        actionable: true,
        createdAt: vietnamDateTime(note.createdAt),
        channel: null,
        actionUrl,
      },
    ];
  });

  return [...treatmentSignals, ...clinicalSignals].sort((left, right) =>
    String(left.dueAt ?? "").localeCompare(String(right.dueAt ?? "")),
  );
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
