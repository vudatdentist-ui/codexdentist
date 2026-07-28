import "server-only";

import { clinics as demoClinics } from "@/lib/data";
import { codexMedAiConfig, notificationDeliveryMode, resendEmailConfig } from "@/lib/env";
import { canUseAllClinics, hasAnyRole, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import { getSourceCommissionWorkspace } from "@/lib/source-commission";
import type {
  ArchivedClinicSummary,
  SettingsChainOption,
  SettingsClinicOption,
  SettingsWorkspace,
} from "@/lib/settings-types";
import type { AppSession } from "@/lib/session";
import { isSuperAdminSession } from "@/lib/super-admin";

const mutableSettingsRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"];

export async function getSettingsWorkspace(
  session: AppSession,
): Promise<SettingsWorkspace> {
  try {
    const canManageSystems = isSuperAdminSession(session);
    const clinicIds = await settingsClinicIds(session);

    const [dbOrganizations, dbChains, dbClinics, dbUsers, auditLogs, notificationCounts, sourceCommission, aiRuns] = await Promise.all([
      prisma.organization.findMany({
        where: canManageSystems ? {} : { id: session.organizationId },
        include: {
          _count: {
            select: {
              clinics: true,
              users: true,
            },
          },
          users: {
            where: {
              active: true,
              OR: [
                {
                  role: "OWNER",
                },
                {
                  roleAssignments: {
                    some: {
                      active: true,
                      role: "OWNER",
                    },
                  },
                },
              ],
            },
            select: {
              id: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      prisma.chain.findMany({
        where: {
          organizationId: session.organizationId,
          ...(canUseAllClinics(session)
            ? {}
            : {
                clinics: {
                  some: {
                    id: {
                      in: clinicIds,
                    },
                  },
                },
              }),
        },
        include: {
          owner: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          _count: {
            select: {
              clinics: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.clinic.findMany({
        where: {
          ...(canManageSystems
            ? {}
            : {
                organizationId: session.organizationId,
                id: {
                  in: clinicIds,
                },
              }),
        },
        select: {
          id: true,
          organizationId: true,
          organization: {
            select: {
              name: true,
            },
          },
          chainId: true,
          chain: {
            select: {
              name: true,
            },
          },
          name: true,
          city: true,
          address: true,
          phone: true,
          active: true,
          chairs: {
            select: {
              id: true,
              clinicId: true,
              name: true,
              specialty: true,
              active: true,
              operationalStatus: true,
            },
            orderBy: {
              name: "asc",
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.user.findMany({
        where: {
          organizationId: session.organizationId,
          ...(canUseAllClinics(session)
            ? {}
            : {
                clinics: {
                  some: {
                    clinicId: {
                      in: clinicIds,
                    },
                  },
                },
              }
          ),
        },
        include: {
          staffProfile: {
            select: {
              id: true,
              employeeCode: true,
              title: true,
              department: true,
              contractType: true,
              baseSalary: true,
              hireDate: true,
              dateOfBirth: true,
              gender: true,
              clinicId: true,
              avatarStorageKey: true,
              avatarThumbnailStorageKey: true,
            },
          },
          clinics: {
            include: {
              clinic: {
                select: {
                  id: true,
                  organizationId: true,
                  organization: {
                    select: {
                      name: true,
                    },
                  },
                  chainId: true,
                  chain: {
                    select: {
                      name: true,
                    },
                  },
                  name: true,
                  city: true,
                  address: true,
                  phone: true,
                  active: true,
                },
              },
            },
            orderBy: {
              clinic: {
                name: "asc",
              },
            },
          },
          roleAssignments: {
            include: {
              clinic: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: [
              {
                role: "asc",
              },
              {
                scopeKey: "asc",
              },
            ],
          },
          passwordResetTokens: {
            where: {
              usedAt: null,
              expiresAt: {
                gt: new Date(),
              },
            },
            select: {
              id: true,
            },
            take: 1,
          },
        },
        orderBy: {
          fullName: "asc",
        },
      }),
      prisma.auditLog.findMany({
        where: {
          organizationId: session.organizationId,
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
        take: 8,
      }),
      prisma.notification.groupBy({
        by: ["status"],
        where: {
          organizationId: session.organizationId,
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        _count: {
          _all: true,
        },
      }),
      getSourceCommissionWorkspace(session),
      prisma.aiRun.findMany({
        where: {
          organizationId: session.organizationId,
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
        take: 12,
      }),
    ]);

    const archivedClinics = await safeArchivedClinicSummaries(
      session,
      dbClinics.filter((clinic) => !clinic.active),
    );

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableSettingsRoles),
      canManageSystems,
      message:
        dbUsers.length === 0
          ? "Chưa có dữ liệu trong phạm vi hiện tại."
          : null,
      chains: dbChains.map(toSettingsChain),
      organizations: dbOrganizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        primaryDomain: organization.primaryDomain,
        ownerCount: organization.users.length,
        clinicCount: organization._count.clinics,
        userCount: organization._count.users,
        createdAt: vietnamDateTime(organization.createdAt),
      })),
      clinics: dbClinics.map(toSettingsClinic),
      staff: dbUsers.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role as AppRole,
        roleAssignments: user.roleAssignments.map((assignment) => ({
          id: assignment.id,
          role: assignment.role as AppRole,
          clinicId: assignment.clinicId,
          clinicName: assignment.clinic?.name ?? null,
          scope: assignment.clinicId ? "CLINIC" : "GLOBAL",
          active: assignment.active,
        })),
        active: user.active,
        staffProfileId: user.staffProfile?.id ?? null,
        employeeCode: user.staffProfile?.employeeCode ?? null,
        title: user.staffProfile?.title ?? null,
        department: user.staffProfile?.department ?? null,
        contractType: user.staffProfile?.contractType ?? null,
        baseSalary: user.staffProfile?.baseSalary?.toString() ?? null,
        hireDate: user.staffProfile?.hireDate
          ? vietnamDate(user.staffProfile.hireDate)
          : null,
        hireDateIso: user.staffProfile?.hireDate
          ? dateInputValue(user.staffProfile.hireDate)
          : null,
        dateOfBirth: user.staffProfile?.dateOfBirth
          ? vietnamDate(user.staffProfile.dateOfBirth)
          : null,
        dateOfBirthIso: user.staffProfile?.dateOfBirth
          ? dateInputValue(user.staffProfile.dateOfBirth)
          : null,
        gender: user.staffProfile?.gender ?? null,
        primaryClinicId: user.staffProfile?.clinicId ?? user.clinics[0]?.clinicId ?? null,
        avatarUrl:
          user.staffProfile?.avatarThumbnailStorageKey ?? user.staffProfile?.avatarStorageKey
            ? `/staff-avatars/${user.id}?variant=thumbnail`
            : null,
        canCreatePasswordSetup: user.id !== session.userId,
        mustChangePassword: user.mustChangePassword,
        passwordChangedAt: user.passwordChangedAt
          ? vietnamDateTime(user.passwordChangedAt)
          : null,
        hasPendingPasswordSetup: user.passwordResetTokens.length > 0,
        clinics: user.clinics.map((membership) => toSettingsClinic(membership.clinic)),
        lastLoginAt: user.lastLoginAt ? vietnamDateTime(user.lastLoginAt) : null,
      })),
      archivedClinics,
      auditLogs: auditLogs.map((log) => ({
        id: log.id,
        actor: log.actor?.fullName ?? "System",
        action: log.action,
        entityType: log.entityType,
        createdAt: vietnamDateTime(log.createdAt),
      })),
      notificationSettings: {
        deliveryMode: notificationDeliveryMode(),
        resendFromEmail: safeResendFromEmail(),
        recentFailed: notificationCounts.find((item) => item.status === "FAILED")?._count._all ?? 0,
        recentSent: notificationCounts.find((item) => item.status === "SENT")?._count._all ?? 0,
      },
      aiSettings: safeAiSettings(),
      sourceCommission,
      aiRuns: aiRuns.map((run) => ({
        id: run.id,
        module: run.module,
        action: run.action,
        provider: run.provider,
        model: run.model,
        status: run.status,
        actor: run.actor?.fullName ?? null,
        totalTokens: run.totalTokens,
        error: run.error,
        createdAt: vietnamDateTime(run.createdAt),
      })),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "settings");
    return demoSettingsWorkspace(session);
  }
}

function demoSettingsWorkspace(session: AppSession): SettingsWorkspace {
  const allowedIds = new Set(session.clinicIds);
  const clinics = demoClinics
    .filter((clinic) => allowedIds.has(clinic.id))
    .map((clinic) => ({
      id: clinic.id,
      organizationId: session.organizationId,
    organizationName: "Codexdentist",
      chainId: null,
      chainName: null,
      name: clinic.name,
      city: clinic.city,
      address: "",
      phone: null,
      active: true,
      chairs: [],
    }));

  return {
    source: "demo",
    canMutate: false,
    canManageSystems: false,
    message:
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    clinics,
    chains: [],
    organizations: [],
    staff: [],
    archivedClinics: [],
    auditLogs: [],
    notificationSettings: {
      deliveryMode: "demo",
      resendFromEmail: null,
      recentFailed: 0,
      recentSent: 0,
    },
    aiSettings: {
      baseUrlConfigured: false,
      enabled: false,
      error: null,
      model: "cx/gpt-5.5",
      provider: "openai-compatible",
    },
    sourceCommission: {
      policies: [],
      accruals: [],
    },
    aiRuns: [],
  };
}

function safeResendFromEmail() {
  try {
    return resendEmailConfig()?.from ?? null;
  } catch {
    return null;
  }
}

function safeAiSettings() {
  try {
    const config = codexMedAiConfig();

    return {
      baseUrlConfigured: Boolean(config.baseUrl),
      enabled: config.enabled,
      error: null,
      model: config.model,
      provider: config.provider,
    };
  } catch (error) {
    return {
      baseUrlConfigured: false,
      enabled: false,
      error: error instanceof Error ? error.message : "AI provider configuration is invalid.",
      model: process.env.CODEXMED_AI_MODEL?.trim() || "cx/gpt-5.5",
      provider: process.env.CODEXMED_AI_PROVIDER?.trim() || "openai-compatible",
    };
  }
}

function toSettingsClinic(clinic: {
  id: string;
  organizationId: string;
  organization?: { name: string } | null;
  chainId: string | null;
  chain?: { name: string } | null;
  name: string;
  city: string;
  address: string;
  phone: string | null;
  active: boolean;
  chairs?: Array<{
    id: string;
    clinicId: string;
    name: string;
    specialty: string | null;
    active: boolean;
    operationalStatus: string;
  }>;
}): SettingsClinicOption {
  return {
    id: clinic.id,
    organizationId: clinic.organizationId,
    organizationName: clinic.organization?.name ?? "",
    chainId: clinic.chainId,
    chainName: clinic.chain?.name ?? null,
    name: clinic.name,
    city: clinic.city,
    address: clinic.address,
    phone: clinic.phone,
    active: clinic.active,
    chairs:
      clinic.chairs?.map((chair) => ({
        id: chair.id,
        clinicId: chair.clinicId,
        name: chair.name,
        specialty: chair.specialty,
        active: chair.active,
        operationalStatus: chair.operationalStatus === "BUSY" ? "BUSY" : "READY",
      })) ?? [],
  };
}

function toSettingsChain(
  chain: {
    id: string;
    ownerId: string | null;
    owner?: { id: string; fullName: string; email: string } | null;
    name: string;
    legalName: string | null;
    brandName: string | null;
    taxCode: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    specialty: string;
    active: boolean;
    _count: {
      clinics: number;
    };
  },
): SettingsChainOption {
  return {
    id: chain.id,
    ownerId: chain.ownerId,
    ownerName: chain.owner?.fullName ?? null,
    ownerEmail: chain.owner?.email ?? null,
    name: chain.name,
    legalName: chain.legalName,
    brandName: chain.brandName,
    taxCode: chain.taxCode,
    phone: chain.phone,
    email: chain.email,
    website: chain.website,
    specialty: chain.specialty,
    active: chain.active,
    clinicCount: chain._count.clinics,
  };
}

async function archivedClinicSummaries(
  session: AppSession,
  clinics: Array<{
    id: string;
    organizationId: string;
    organization?: { name: string } | null;
    name: string;
    city: string;
  }>,
): Promise<ArchivedClinicSummary[]> {
  if (clinics.length === 0) {
    return [];
  }

  return Promise.all(
    clinics.map(async (clinic) => {
      const [
        patientCount,
        appointmentCount,
        invoiceCount,
        receiptCount,
        staffCount,
        latestAppointment,
        latestInvoice,
        latestReceipt,
      ] = await Promise.all([
        prisma.patient.count({
          where: {
            clinicId: clinic.id,
            organizationId: clinic.organizationId,
          },
        }),
        prisma.appointment.count({
          where: {
            clinicId: clinic.id,
          },
        }),
        prisma.invoice.count({
          where: {
            clinicId: clinic.id,
          },
        }),
        prisma.receipt.count({
          where: {
            clinicId: clinic.id,
            organizationId: clinic.organizationId,
          },
        }),
        prisma.user.count({
          where: {
            organizationId: clinic.organizationId,
            clinics: {
              some: {
                clinicId: clinic.id,
              },
            },
          },
        }),
        prisma.appointment.findFirst({
          where: {
            clinicId: clinic.id,
          },
          orderBy: {
            updatedAt: "desc",
          },
          select: {
            updatedAt: true,
          },
        }),
        prisma.invoice.findFirst({
          where: {
            clinicId: clinic.id,
          },
          orderBy: {
            updatedAt: "desc",
          },
          select: {
            updatedAt: true,
          },
        }),
        prisma.receipt.findFirst({
          where: {
            clinicId: clinic.id,
            organizationId: clinic.organizationId,
          },
          orderBy: {
            updatedAt: "desc",
          },
          select: {
            updatedAt: true,
          },
        }),
      ]);
      const latestActivityAt = [
        latestAppointment?.updatedAt,
        latestInvoice?.updatedAt,
        latestReceipt?.updatedAt,
      ]
        .filter((date): date is Date => Boolean(date))
        .sort((left, right) => right.getTime() - left.getTime())[0];

      return {
        clinicId: clinic.id,
        organizationId: clinic.organizationId,
        organizationName: clinic.organization?.name ?? "",
        name: clinic.name,
        city: clinic.city,
        patientCount,
        appointmentCount,
        invoiceCount,
        receiptCount,
        staffCount,
        latestActivityAt: latestActivityAt ? vietnamDateTime(latestActivityAt) : null,
      };
    }),
  );
}

async function safeArchivedClinicSummaries(
  session: AppSession,
  clinics: Array<{
    id: string;
    organizationId: string;
    organization?: { name: string } | null;
    name: string;
    city: string;
  }>,
) {
  try {
    return await archivedClinicSummaries(session, clinics);
  } catch (error) {
    console.error("Failed to load archived clinic summaries", error);
    return [];
  }
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId
    ? [session.activeClinicId]
    : session.clinicIds;
}

async function settingsClinicIds(session: AppSession) {
  if (!canUseAllClinics(session)) {
    return allowedClinicIds(session);
  }

  const clinics = await prisma.clinic.findMany({
    where: {
      organizationId: session.organizationId,
    },
    select: {
      id: true,
    },
  });

  return clinics.map((clinic) => clinic.id);
}

function vietnamDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function vietnamDate(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
  }).format(date);
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}
