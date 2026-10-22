import { reportApplicationError } from "@/lib/error-reporting";
import "server-only";
import type { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { canPerformAction } from "@/lib/actions/permissions";
import { appBaseUrl } from "@/lib/env";
import { requiredString, parseDateInVietnam } from "@/lib/form-validation";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { processNotificationNow } from "@/lib/notifications";
import { canUseAllClinics, effectiveRoles, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import type { AppSession } from "@/lib/session";
import { isSuperAdminSession } from "@/lib/super-admin";
import { tenantDomainForSlug, } from "@/lib/tenant";
import { failCommand } from "@/lib/application/command-failure";
export function roleAssignmentData(organizationId: string, userId: string, role: Exclude<(typeof userRoles)[number], "PATIENT">, clinicId: string | null) {
    const scopedClinicId = isOrganizationScopedRole(role) ? null : clinicId;
    return {
        organizationId,
        userId,
        role,
        clinicId: scopedClinicId,
        scopeKey: scopedClinicId ?? "GLOBAL",
        active: true,
    };
}
export const userRoles = [
    "OWNER",
    "AREA_MANAGER",
    "CLINIC_MANAGER",
    "DENTIST",
    "HYGIENIST",
    "FRONT_DESK",
    "BILLING",
    "PATIENT",
] as const;
export function isOrganizationScopedRole(role: string): role is (typeof organizationScopedRoles)[number] {
    return organizationScopedRoles.includes(role as (typeof organizationScopedRoles)[number]);
}
export const organizationScopedRoles = ["OWNER", "AREA_MANAGER"] as const;
export async function createPasswordSetupArtifactsTx(tx: Prisma.TransactionClient, input: {
    organizationId: string;
    organizationDomain?: string | null;
    organizationSlug?: string | null;
    userId: string;
    createdById: string | null;
    email: string;
    fullName: string;
    clinicId?: string | null;
}): Promise<PasswordSetupArtifacts> {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() +
        (process.env.NODE_ENV === "production"
            ? 60 * 60 * 1000
            : 24 * 60 * 60 * 1000));
    await tx.passwordResetToken.updateMany({
        where: {
            userId: input.userId,
            usedAt: null,
            expiresAt: { gt: now },
        },
        data: { usedAt: now },
    });
    await tx.passwordResetToken.create({
        data: {
            organizationId: input.organizationId,
            userId: input.userId,
            createdById: input.createdById,
            tokenHash: createHash("sha256").update(token).digest("hex"),
            purpose: "STAFF_PASSWORD_SETUP",
            expiresAt,
        },
    });
    let organizationDomain = input.organizationDomain ?? null;
    let organizationSlug = input.organizationSlug ?? null;
    if (!organizationDomain && !organizationSlug) {
        const organization = await tx.organization.findUnique({
            where: { id: input.organizationId },
            select: { primaryDomain: true, slug: true },
        });
        organizationDomain = organization?.primaryDomain ?? null;
        organizationSlug = organization?.slug ?? null;
    }
    const domain = organizationDomain?.trim() ||
        (organizationSlug ? tenantDomainForSlug(organizationSlug) : "");
    const baseUrl = passwordSetupBaseUrl(domain);
    const setupUrl = baseUrl + "/reset-password?token=" + encodeURIComponent(token);
    const rendered = renderNotificationTemplate("STAFF_PASSWORD_SETUP", {
        fullName: input.fullName,
        setupUrl,
        expiresAt: expiresAt.toISOString(),
    });
    const notification = await tx.notification.create({
        data: {
            organizationId: input.organizationId,
            clinicId: input.clinicId ?? null,
            userId: input.userId,
            channel: "EMAIL",
            status: "SCHEDULED",
            templateKey: "STAFF_PASSWORD_SETUP",
            recipient: input.email,
            subject: rendered.subject,
            body: "A one-time password setup email was requested for this account.",
            scheduledAt: now,
            metadata: {
                purpose: "STAFF_PASSWORD_SETUP",
            },
        },
        select: { id: true },
    });
    return {
        notificationId: notification.id,
        deliveryContent: rendered,
    };
}
export type PasswordSetupArtifacts = {
    notificationId: string;
    deliveryContent: ReturnType<typeof renderNotificationTemplate>;
};
export function passwordSetupBaseUrl(domain: string) {
    if (!domain) {
        return appBaseUrl();
    }
    const trimmedDomain = domain.trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(trimmedDomain)) {
        return new URL(trimmedDomain).toString().replace(/\/+$/, "");
    }
    const protocol = new URL(appBaseUrl()).protocol;
    return protocol + "//" + trimmedDomain;
}
export function canWriteSettings(session: AppSession) {
    return canPerformAction(session, "settings.manage");
}
export function defaultEmployeeCode(userId: string) {
    return `NV-${userId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase()}`;
}
export function defaultRoleTitle(role: AppRole) {
    const labels: Record<AppRole, string> = {
        OWNER: "Owner",
        AREA_MANAGER: "Area manager",
        CLINIC_MANAGER: "Clinic manager",
        DENTIST: "Dentist",
        HYGIENIST: "Hygienist",
        FRONT_DESK: "Front desk",
        BILLING: "Billing",
        PATIENT: "Patient",
    };
    return labels[role] ?? role;
}
export function canManageClinics(session: AppSession) {
    return canWriteSettings(session) && canUseAllClinics(session);
}
export async function targetClinicOrganizationId(session: AppSession, organizationIdInput: string | null) {
    if (!isSuperAdminSession(session)) {
        return session.organizationId;
    }
    const organizationId = organizationIdInput || session.organizationId;
    const organization = await prisma.organization.findUnique({
        where: {
            id: organizationId,
        },
        select: {
            id: true,
        },
    });
    if (!organization) {
        failCommand("settings-organization-missing");
    }
    return organization.id;
}
export async function writeSettingsAuditLog(input: {
    organizationId: string;
    actorId: string | null;
    action: string;
    entityType?: string;
    entityId: string;
    metadata?: Record<string, unknown>;
}) {
    await prisma.auditLog.create({
        data: {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: input.action,
            entityType: input.entityType ?? "User",
            entityId: input.entityId,
            metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
    });
}
export async function findChainOwnerCandidate(session: AppSession, userId: string) {
    return prisma.user.findFirst({
        where: {
            id: userId,
            organizationId: session.organizationId,
            active: true,
            OR: [
                {
                    role: {
                        in: ["OWNER", "AREA_MANAGER"],
                    },
                },
                {
                    roleAssignments: {
                        some: {
                            active: true,
                            role: {
                                in: ["OWNER", "AREA_MANAGER"],
                            },
                        },
                    },
                },
            ],
        },
        select: {
            id: true,
            organizationId: true,
        },
    });
}
export async function findScopedUser(session: AppSession, userId: string) {
    return prisma.user.findFirst({
        where: {
            id: userId,
            organizationId: session.organizationId,
            ...(canUseAllClinics(session)
                ? {}
                : {
                    clinics: {
                        some: {
                            clinicId: {
                                in: accessibleClinicIds(session),
                            },
                        },
                    },
                }),
        },
        select: {
            id: true,
            organizationId: true,
            email: true,
            fullName: true,
            role: true,
            active: true,
            clinics: {
                select: {
                    clinicId: true,
                },
            },
            roleAssignments: {
                where: {
                    active: true,
                },
                select: {
                    clinicId: true,
                    role: true,
                },
            },
        },
    });
}
export function assertCanManageStaffTarget(session: AppSession, target: NonNullable<Awaited<ReturnType<typeof findScopedUser>>>) {
    if (isSuperAdminSession(session) && target.id !== session.userId) {
        return;
    }
    const actorRank = strongestRoleRank(effectiveRoles(session));
    const targetRank = strongestRoleRank([
        target.role,
        ...target.roleAssignments.map((assignment) => assignment.role),
    ]);
    if (actorRank >= targetRank) {
        failCommand("settings-denied");
    }
}
export function strongestRoleRank(roles: AppRole[]) {
    return Math.min(...roles.map((role) => {
        const rank = staffRolePriority.indexOf(role as (typeof staffRolePriority)[number]);
        return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
    }));
}
export const staffRolePriority = [
    "OWNER",
    "AREA_MANAGER",
    "CLINIC_MANAGER",
    "DENTIST",
    "HYGIENIST",
    "FRONT_DESK",
    "BILLING",
] as const;
export function staffUserHasRole(target: NonNullable<Awaited<ReturnType<typeof findScopedUser>>>, role: AppRole) {
    return (target.role === role ||
        target.roleAssignments.some((assignment) => assignment.role === role));
}
export async function assertAnotherActiveOwner(organizationId: string, excludedUserId: string) {
    const activeOwner = await prisma.user.findFirst({
        where: {
            organizationId,
            id: {
                not: excludedUserId,
            },
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
    });
    if (!activeOwner) {
        failCommand("settings-denied");
    }
}
export async function findActiveScopedClinic(session: AppSession, clinicId: string) {
    if (isSuperAdminSession(session)) {
        return prisma.clinic.findFirst({
            where: {
                id: clinicId,
                active: true,
            },
            select: {
                id: true,
                organizationId: true,
            },
        });
    }
    return prisma.clinic.findFirst({
        where: {
            organizationId: session.organizationId,
            active: true,
            ...(canUseAllClinics(session)
                ? {
                    id: clinicId,
                }
                : {
                    id: {
                        equals: clinicId,
                        in: accessibleClinicIds(session),
                    },
                }),
        },
        select: {
            id: true,
            organizationId: true,
        },
    });
}
export function primaryStaffRoleForAssignments(roles: Array<Exclude<(typeof userRoles)[number], "PATIENT">>) {
    const roleSet = new Set(roles);
    return staffRolePriority.find((role) => roleSet.has(role)) ?? "FRONT_DESK";
}
export function isStaffProfileRole(role: string): role is Exclude<(typeof userRoles)[number], "PATIENT"> {
    return staffProfileRoles.includes(role as Exclude<(typeof userRoles)[number], "PATIENT">);
}
export const staffProfileRoles = userRoles.filter((role) => role !== "PATIENT");
export function canAssignStaffRoles(session: AppSession, roles: Array<Exclude<(typeof userRoles)[number], "PATIENT">>) {
    if (isSuperAdminSession(session)) {
        return true;
    }
    const actorRank = strongestRoleRank(effectiveRoles(session));
    return roles.every((role) => actorRank < strongestRoleRank([role]));
}
export async function findScopedClinic(session: AppSession, clinicId: string) {
    if (isSuperAdminSession(session)) {
        return prisma.clinic.findFirst({
            where: {
                id: clinicId,
            },
            select: {
                id: true,
                organizationId: true,
            },
        });
    }
    return prisma.clinic.findFirst({
        where: {
            organizationId: session.organizationId,
            ...(canUseAllClinics(session)
                ? {
                    id: clinicId,
                }
                : {
                    id: {
                        equals: clinicId,
                        in: accessibleClinicIds(session),
                    },
                }),
        },
        select: {
            id: true,
            organizationId: true,
        },
    });
}
export async function findScopedChair(session: AppSession, chairId: string, clinicId: string) {
    const scopedClinic = await findScopedClinic(session, clinicId);
    if (!scopedClinic) {
        return null;
    }
    return prisma.chair.findFirst({
        where: {
            id: chairId,
            clinicId,
        },
        select: {
            id: true,
            clinic: {
                select: {
                    organizationId: true,
                },
            },
        },
    });
}
export async function findScopedChain(session: AppSession, chainId: string) {
    return prisma.chain.findFirst({
        where: {
            id: chainId,
            organizationId: session.organizationId,
        },
        select: {
            id: true,
        },
    });
}
export function optionalString(value: (string | File) | null) {
    const text = requiredString(value).trim();
    return text || null;
}
export function optionalDate(value: (string | File) | null): Date | null | false { const date = parseDateInVietnam(value); return date === "invalid" ? false : date; }
export function optionalDecimal(value: (string | File) | null): string | null | false {
    const text = requiredString(value);
    if (!text)
        return null;
    if (/^\d+(?:[.,]\d{1,2})?$/.test(text))
        return text.replace(",", ".");
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(text))
        return text.replace(/[.,]/g, "");
    return false;
}
export async function deliverSetupNotification(setup: PasswordSetupArtifacts) {
    try {
        const result = await processNotificationNow(setup.notificationId, setup.deliveryContent);
        if (result.results[0]?.status === "failed") {
            reportApplicationError("staff.password_setup_delivery_failed", new Error("Delivery failed"));
        }
    }
    catch (error) {
        reportApplicationError("staff.password_setup_delivery_failed", error);
    }
}
