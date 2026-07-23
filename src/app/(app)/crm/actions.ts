"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  optionalString,
  parseDateInVietnam,
  requiredString,
} from "@/lib/form-validation";
import { canMutateCrm } from "@/lib/crm";
import { generateCrmRecallTasks } from "@/lib/crm-recall";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const leadStatuses = [
  "NEW",
  "CONTACTED",
  "CONSULT_BOOKED",
  "VISITED",
  "CONVERTED",
  "LOST",
  "RECALL",
] as const;

const activityTypes = [
  "CALL",
  "ZALO",
  "SMS",
  "EMAIL",
  "NOTE",
  "TASK",
  "VISIT",
  "FOLLOW_UP",
] as const;

const channels = ["EMAIL", "SMS", "ZALO", "PUSH", "IN_APP", "PHONE"] as const;

export async function createCrmLeadAction(formData: FormData) {
  const session = await requireViewSession("crm");

  if (!canMutateCrm(session)) {
    redirect("/crm?notice=crm-denied");
  }

  const name = requiredString(formData.get("name"));
  const clinicId = normalizeClinicId(formData.get("clinicId"), session);
  const patientId = optionalString(formData.get("patientId"));
  const nextFollowUpAt = parseDateInVietnam(formData.get("nextFollowUpAt"));

  if (!name || clinicId === "denied" || nextFollowUpAt === "invalid") {
    redirect("/crm?notice=crm-missing");
  }

  try {
    const patient = patientId
      ? await prisma.patient.findFirst({
          where: {
            id: patientId,
            organizationId: session.organizationId,
            clinicId: {
              in: allowedClinicIds(session),
            },
          },
          select: {
            id: true,
            clinicId: true,
            fullName: true,
            phone: true,
            email: true,
            leadSource: true,
          },
        })
      : null;

    if (patientId && !patient) {
      redirect("/crm?notice=crm-patient-not-found");
    }

    const source = optionalString(formData.get("source")) ?? patient?.leadSource ?? null;
    const lead = await prisma.crmLead.create({
      data: {
        organizationId: session.organizationId,
        clinicId: patient?.clinicId ?? (clinicId === "all" ? null : clinicId),
        patientId: patient?.id ?? null,
        ownerId: databaseActorId(session.userId),
        status: "NEW",
        source,
        name: patient?.fullName ?? name,
        phone: patient?.phone ?? optionalString(formData.get("phone")),
        email: patient?.email ?? optionalString(formData.get("email")),
        campaignName: optionalString(formData.get("campaignName")),
        nextFollowUpAt: nextFollowUpAt ?? null,
        note: optionalString(formData.get("note")),
      },
      select: {
        id: true,
      },
    });

    await writeCrmAuditLog(session, "crm_lead.created", "CrmLead", lead.id, {
      clinicId: patient?.clinicId ?? (clinicId === "all" ? null : clinicId),
      patientId: patient?.id ?? null,
      source,
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/crm?notice=crm-database");
  }

  revalidateCrmViews();
  redirect("/crm?notice=crm-lead-created");
}

export async function addCrmActivityAction(formData: FormData) {
  const session = await requireViewSession("crm");

  if (!canMutateCrm(session)) {
    redirect("/crm?notice=crm-denied");
  }

  const subject = requiredString(formData.get("subject"));
  const type = normalizeActivityType(formData.get("type"));
  const channel = normalizeChannel(formData.get("channel"));
  const leadId = optionalString(formData.get("leadId"));
  const patientId = optionalString(formData.get("patientId"));
  const dueAt = parseDateInVietnam(formData.get("dueAt"));

  if (!subject || !type || dueAt === "invalid") {
    redirect("/crm?notice=crm-missing");
  }

  try {
    const [lead, patient] = await Promise.all([
      leadId ? scopedLead(session, leadId) : null,
      patientId ? scopedPatient(session, patientId) : null,
    ]);

    if ((leadId && !lead) || (patientId && !patient)) {
      redirect("/crm?notice=crm-patient-not-found");
    }

    const activity = await prisma.crmActivity.create({
      data: {
        organizationId: session.organizationId,
        clinicId: patient?.clinicId ?? lead?.clinicId ?? session.activeClinicId,
        patientId: patient?.id ?? lead?.patientId ?? null,
        leadId: lead?.id ?? null,
        actorId: databaseActorId(session.userId),
        type,
        channel,
        subject,
        body: optionalString(formData.get("body")),
        dueAt: dueAt ?? null,
        completedAt:
          requiredString(formData.get("completed")) === "on" ? new Date() : null,
      },
      select: {
        id: true,
      },
    });

    if (lead) {
      await prisma.crmLead.update({
        where: {
          id: lead.id,
        },
        data: {
          status: type === "VISIT" ? "VISITED" : "CONTACTED",
          nextFollowUpAt: dueAt ?? lead.nextFollowUpAt,
        },
      });
    }

    await writeCrmAuditLog(session, "crm_activity.created", "CrmActivity", activity.id);
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/crm?notice=crm-database");
  }

  revalidateCrmViews();
  redirect("/crm?notice=crm-activity-created");
}

export async function updateCrmLeadStatusAction(formData: FormData) {
  const session = await requireViewSession("crm");

  if (!canMutateCrm(session)) {
    redirect("/crm?notice=crm-denied");
  }

  const leadId = requiredString(formData.get("leadId"));
  const status = normalizeLeadStatus(formData.get("status"));

  if (!leadId || !status) {
    redirect("/crm?notice=crm-missing");
  }

  try {
    const lead = await scopedLead(session, leadId);

    if (!lead) {
      redirect("/crm?notice=crm-patient-not-found");
    }

    await prisma.crmLead.update({
      where: {
        id: lead.id,
      },
      data: {
        status,
        convertedAt: status === "CONVERTED" ? new Date() : null,
        lostReason:
          status === "LOST" ? optionalString(formData.get("lostReason")) : null,
      },
    });

    await writeCrmAuditLog(session, "crm_lead.status_updated", "CrmLead", lead.id, {
      status,
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/crm?notice=crm-database");
  }

  revalidateCrmViews();
  redirect("/crm?notice=crm-lead-updated");
}

export async function convertCrmLeadToPatientAction(formData: FormData) {
  const session = await requireViewSession("crm");

  if (!canMutateCrm(session)) {
    redirect("/crm?notice=crm-denied");
  }

  const leadId = requiredString(formData.get("leadId"));

  if (!leadId) {
    redirect("/crm?notice=crm-missing");
  }

  try {
    const lead = await scopedLead(session, leadId);

    if (!lead) {
      redirect("/crm?notice=crm-patient-not-found");
    }

    if (lead.patientId) {
      await prisma.crmLead.update({
        where: {
          id: lead.id,
        },
        data: {
          status: "CONVERTED",
          convertedAt: new Date(),
        },
      });

      await writeCrmAuditLog(session, "crm_lead.converted", "CrmLead", lead.id, {
        patientId: lead.patientId,
        linkedExistingPatient: true,
      });

      revalidateCrmViews();
      redirect("/crm?notice=crm-lead-converted");
    }

    if (!lead.phone) {
      redirect("/crm?notice=crm-lead-phone-required");
    }

    const clinicId = lead.clinicId ?? session.activeClinicId ?? session.clinicIds[0] ?? null;

    if (!clinicId || !allowedClinicIds(session).includes(clinicId)) {
      redirect("/crm?notice=crm-denied");
    }

    const [clinic, existingPatient] = await Promise.all([
      prisma.clinic.findFirst({
        where: {
          id: clinicId,
          organizationId: session.organizationId,
          active: true,
        },
        select: {
          id: true,
        },
      }),
      prisma.patient.findUnique({
        where: {
          organizationId_phone: {
            organizationId: session.organizationId,
            phone: lead.phone,
          },
        },
        select: {
          id: true,
          clinicId: true,
        },
      }),
    ]);

    if (!clinic) {
      redirect("/crm?notice=crm-patient-not-found");
    }

    if (existingPatient && !allowedClinicIds(session).includes(existingPatient.clinicId)) {
      redirect("/crm?notice=crm-denied");
    }

    const patientId =
      existingPatient?.id ??
      (
        await prisma.patient.create({
          data: {
            organizationId: session.organizationId,
            clinicId,
            fullName: lead.name,
            phone: lead.phone,
            email: lead.email,
            leadSource: crmLeadSourceToPatientSource(lead.source),
            medicalAlerts: [],
            consents: {
              create: {
                status: "GRANTED",
                purpose: "Health data processing for dental care",
                channel: "crm",
                signedAt: new Date(),
                version: "vn-simple-v1",
              },
            },
          },
          select: {
            id: true,
          },
        })
      ).id;

    await prisma.crmLead.update({
      where: {
        id: lead.id,
      },
      data: {
        patientId,
        clinicId,
        status: "CONVERTED",
        convertedAt: new Date(),
      },
    });

    await writeCrmAuditLog(session, "crm_lead.converted", "CrmLead", lead.id, {
      patientId,
      reusedExistingPatient: Boolean(existingPatient),
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/crm?notice=crm-database");
  }

  revalidateCrmViews();
  revalidatePath("/patients");
  revalidatePath("/journey");
  redirect("/crm?notice=crm-lead-converted");
}

export async function generateCrmRecallTasksAction() {
  const session = await requireViewSession("crm");

  if (!canMutateCrm(session)) {
    redirect("/crm?notice=crm-denied");
  }

  try {
    await generateCrmRecallTasks({
      organizationId: session.organizationId,
      clinicIds: allowedClinicIds(session),
      actorId: session.userId,
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/crm?notice=crm-database");
  }

  revalidateCrmViews();
  redirect("/crm?notice=crm-recalls-generated");

  /*
  const clinicIds = allowedClinicIds(session);
  const now = new Date();
  const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
    const services = await prisma.treatmentService.findMany({
      where: {
        organizationId: session.organizationId,
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
    const [futureAppointments, openActivities, leads] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          organizationId: session.organizationId,
          patientId: {
            in: patientIds,
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
          organizationId: session.organizationId,
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
          organizationId: session.organizationId,
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
                organizationId: session.organizationId,
                clinicId: service.patient.clinicId,
                patientId: service.patient.id,
                ownerId: databaseActorId(session.userId),
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
            organizationId: session.organizationId,
            clinicId: service.patient.clinicId,
            patientId: service.patient.id,
            leadId,
            actorId: databaseActorId(session.userId),
            type: "FOLLOW_UP",
            channel: "PHONE",
            subject: `Recall: ${service.patient.fullName}`,
            body: `${service.serviceCode} · ${service.serviceName} · ${Number(
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
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "crm.recall_tasks_generated",
          entityType: "CrmActivity",
          entityId: session.organizationId,
          metadata: {
            createdCount: serviceByPatientId.size,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/crm?notice=crm-database");
  }

  revalidateCrmViews();
  redirect("/crm?notice=crm-recalls-generated");
  */
}

async function scopedLead(session: AppSession, leadId: string) {
  return prisma.crmLead.findFirst({
    where: {
      id: leadId,
      organizationId: session.organizationId,
      OR: [
        {
          clinicId: null,
        },
        {
          clinicId: {
            in: allowedClinicIds(session),
          },
        },
      ],
    },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      name: true,
      phone: true,
      email: true,
      source: true,
      nextFollowUpAt: true,
    },
  });
}

async function scopedPatient(session: AppSession, patientId: string) {
  return prisma.patient.findFirst({
    where: {
      id: patientId,
      organizationId: session.organizationId,
      clinicId: {
        in: allowedClinicIds(session),
      },
    },
    select: {
      id: true,
      clinicId: true,
    },
  });
}

function normalizeLeadStatus(value: FormDataEntryValue | null) {
  const parsed = requiredString(value);

  return leadStatuses.find((status) => status === parsed) ?? null;
}

function normalizeActivityType(value: FormDataEntryValue | null) {
  const parsed = requiredString(value);

  return activityTypes.find((type) => type === parsed) ?? null;
}

function normalizeChannel(value: FormDataEntryValue | null) {
  const parsed = requiredString(value);

  return channels.find((channel) => channel === parsed) ?? null;
}

function normalizeClinicId(value: FormDataEntryValue | null, session: AppSession) {
  const parsed = requiredString(value);

  if (!parsed || parsed === "all") {
    return canUseAllClinics(session) ? "all" : session.activeClinicId ?? "denied";
  }

  return session.clinicIds.includes(parsed) ? parsed : "denied";
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function crmLeadSourceToPatientSource(source: string | null) {
  const normalized = String(source ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  const patientLeadSources = new Set([
    "WALK_IN",
    "FACEBOOK_ADS",
    "GOOGLE_ADS",
    "TIKTOK",
    "SOCIAL",
    "TELESALE",
    "WEBSITE",
    "ZALO",
    "PATIENT_REFERRAL",
    "STAFF_REFERRAL",
    "PARTNER",
    "OTHER",
  ]);

  return patientLeadSources.has(normalized) ? normalized : "OTHER";
}

async function writeCrmAuditLog(
  session: AppSession,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await prisma.auditLog.create({
    data: {
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action,
      entityType,
      entityId,
      metadata,
    },
  });
}

function revalidateCrmViews() {
  revalidatePath("/crm");
  revalidatePath("/journey");
  revalidatePath("/reports");
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}
