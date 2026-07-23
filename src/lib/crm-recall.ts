import "server-only";

import type { Prisma } from "@prisma/client";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";

type GenerateCrmRecallTasksInput = {
  organizationId: string;
  clinicIds: string[];
  actorId?: string | null;
  now?: Date;
};

export async function generateCrmRecallTasks(input: GenerateCrmRecallTasksInput) {
  const clinicIds = Array.from(new Set(input.clinicIds.filter(Boolean)));

  if (clinicIds.length === 0) {
    return { createdCount: 0 };
  }

  const now = input.now ?? new Date();
  const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const actorId = input.actorId ? databaseActorId(input.actorId) : null;

  const services = await prisma.treatmentService.findMany({
    where: {
      organizationId: input.organizationId,
      clinicId: {
        in: clinicIds,
      },
      status: {
        in: ["PLANNED", "IN_PROGRESS"],
      },
    },
    include: {
      patient: {
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          clinicId: true,
        },
      },
    },
    orderBy: {
      updatedAt: "asc",
    },
    take: 300,
  });

  const patientIds = Array.from(new Set(services.map((service) => service.patientId)));

  if (patientIds.length === 0) {
    return { createdCount: 0 };
  }

  const [futureAppointments, openActivities, leads] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        patientId: {
          in: patientIds,
        },
        patient: {
          organizationId: input.organizationId,
        },
        startsAt: {
          gt: now,
        },
        status: {
          notIn: ["CANCELLED", "NO_SHOW"],
        },
      },
      select: {
        patientId: true,
      },
    }),
    prisma.crmActivity.findMany({
      where: {
        organizationId: input.organizationId,
        patientId: {
          in: patientIds,
        },
        type: "FOLLOW_UP",
        completedAt: null,
        subject: {
          startsWith: "Recall:",
        },
      },
      select: {
        patientId: true,
      },
    }),
    prisma.crmLead.findMany({
      where: {
        organizationId: input.organizationId,
        patientId: {
          in: patientIds,
        },
        status: {
          notIn: ["CONVERTED", "LOST"],
        },
      },
      select: {
        id: true,
        patientId: true,
      },
    }),
  ]);

  const patientsWithFutureAppointment = new Set(
    futureAppointments.map((appointment) => appointment.patientId),
  );
  const patientsWithOpenRecall = new Set(
    openActivities.map((activity) => activity.patientId).filter(Boolean) as string[],
  );
  const leadByPatientId = new Map(
    leads
      .filter((lead) => lead.patientId)
      .map((lead) => [lead.patientId as string, lead.id]),
  );
  const serviceByPatientId = new Map<string, (typeof services)[number]>();

  for (const service of services) {
    if (
      patientsWithFutureAppointment.has(service.patientId) ||
      patientsWithOpenRecall.has(service.patientId) ||
      serviceByPatientId.has(service.patientId)
    ) {
      continue;
    }

    serviceByPatientId.set(service.patientId, service);
  }

  await prisma.$transaction(async (tx) => {
    for (const service of serviceByPatientId.values()) {
      const leadId =
        leadByPatientId.get(service.patientId) ??
        (
          await tx.crmLead.create({
            data: {
              organizationId: input.organizationId,
              clinicId: service.patient.clinicId,
              patientId: service.patient.id,
              ownerId: actorId,
              status: "RECALL",
              source: "AUTO_RECALL",
              name: service.patient.fullName,
              phone: service.patient.phone,
              email: service.patient.email,
              campaignName: "Auto recall",
              nextFollowUpAt: dueAt,
              note: `Auto recall from treatment service ${service.serviceCode}`,
            },
            select: {
              id: true,
            },
          })
        ).id;

      await tx.crmActivity.create({
        data: {
          organizationId: input.organizationId,
          clinicId: service.patient.clinicId,
          patientId: service.patient.id,
          leadId,
          actorId,
          type: "FOLLOW_UP",
          channel: "PHONE",
          subject: `Recall: ${service.patient.fullName}`,
          body: `${service.serviceCode} - ${service.serviceName} - ${Number(
            service.currentProgressPercent,
          )}%`,
          dueAt,
          metadata: {
            source: "AUTO_RECALL",
            treatmentServiceId: service.id,
          } as Prisma.InputJsonValue,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId,
        action: "crm.recall_tasks_generated",
        entityType: "CrmActivity",
        entityId: input.organizationId,
        metadata: {
          createdCount: serviceByPatientId.size,
          clinicIds,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return { createdCount: serviceByPatientId.size };
}
