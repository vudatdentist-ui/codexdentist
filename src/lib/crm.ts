import "server-only";

import { canUseAllClinics, hasAnyRole, type AppRole, type RoleSource } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type { CrmActivitySummary, CrmLeadSummary, CrmWorkspace } from "@/lib/crm-types";
import type { AppSession } from "@/lib/session";

const mutableCrmRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
];

export async function getCrmWorkspace(
  session: AppSession,
  options: { patientId?: string } = {},
): Promise<CrmWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);
    const [patients, leads, activities] = await Promise.all([
      prisma.patient.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { id: options.patientId } : {}),
          clinicId: {
            in: clinicIds,
          },
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          clinicId: true,
        },
        orderBy: {
          fullName: "asc",
        },
      }),
      prisma.crmLead.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        include: {
          owner: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 120,
      }),
      prisma.crmActivity.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        include: {
          actor: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 150,
      }),
    ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableCrmRoles),
      message: null,
      patients: patients.map((patient) => ({
        id: patient.id,
        name: patient.fullName,
        phone: patient.phone,
        clinicId: patient.clinicId,
      })),
      leads: leads.map(toLeadSummary),
      activities: activities.map(toActivitySummary),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "crm");
    return {
      source: "demo",
      canMutate: false,
      message:
        "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
      patients: [],
      leads: [],
      activities: [],
    };
  }
}

export function canMutateCrm(source: RoleSource) {
  return hasAnyRole(source, mutableCrmRoles);
}

function toLeadSummary(lead: {
  id: string;
  clinicId: string | null;
  patientId: string | null;
  status: string;
  source: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  campaignName: string | null;
  nextFollowUpAt: Date | null;
  note: string | null;
  createdAt: Date;
  owner: {
    fullName: string;
  } | null;
}): CrmLeadSummary {
  return {
    id: lead.id,
    clinicId: lead.clinicId,
    patientId: lead.patientId,
    ownerName: lead.owner?.fullName ?? null,
    status: lead.status as CrmLeadSummary["status"],
    source: lead.source,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    campaignName: lead.campaignName,
    nextFollowUpAt: lead.nextFollowUpAt ? vietnamDateTime(lead.nextFollowUpAt) : null,
    nextFollowUpAtIso: lead.nextFollowUpAt?.toISOString() ?? null,
    note: lead.note,
    createdAt: vietnamDateTime(lead.createdAt),
  };
}

function toActivitySummary(activity: {
  id: string;
  clinicId: string | null;
  patientId: string | null;
  leadId: string | null;
  type: string;
  channel: string | null;
  subject: string;
  body: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  actor: {
    fullName: string;
  } | null;
}): CrmActivitySummary {
  return {
    id: activity.id,
    clinicId: activity.clinicId,
    patientId: activity.patientId,
    leadId: activity.leadId,
    actorName: activity.actor?.fullName ?? null,
    type: activity.type as CrmActivitySummary["type"],
    channel: activity.channel as CrmActivitySummary["channel"],
    subject: activity.subject,
    body: activity.body,
    dueAt: activity.dueAt ? vietnamDateTime(activity.dueAt) : null,
    dueAtIso: activity.dueAt?.toISOString() ?? null,
    completedAt: activity.completedAt ? vietnamDateTime(activity.completedAt) : null,
    completedAtIso: activity.completedAt?.toISOString() ?? null,
    createdAt: vietnamDateTime(activity.createdAt),
    createdAtIso: activity.createdAt.toISOString(),
  };
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function vietnamDateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}
