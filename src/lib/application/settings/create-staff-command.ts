import "server-only";
import { randomBytes } from "crypto";
import { hashPassword } from "@/lib/auth";
import { databaseActorId } from "@/lib/form-validation";
import { canUseAllClinics, } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import type { AppSession } from "@/lib/session";
import { isSuperAdminSession } from "@/lib/super-admin";
import { failCommand } from "@/lib/application/command-failure";
import { roleAssignmentData, isOrganizationScopedRole, createPasswordSetupArtifactsTx, PasswordSetupArtifacts, canWriteSettings, defaultEmployeeCode, defaultRoleTitle, findActiveScopedClinic, primaryStaffRoleForAssignments, canAssignStaffRoles, } from "@/lib/application/settings/support";
export async function createStaffCommand(input: {
    createAssignmentRoles: ("OWNER" | "AREA_MANAGER" | "CLINIC_MANAGER" | "DENTIST" | "HYGIENIST" | "FRONT_DESK" | "BILLING")[];
    clinicId: string;
    title: string | null;
    session: AppSession;
    email: string;
    fullName: string;
}) {
    const { createAssignmentRoles, clinicId, title, session, email, fullName } = input;
    if (!canWriteSettings(session)) {
        failCommand("settings-denied");
    }
    if (!canAssignStaffRoles(session, createAssignmentRoles)) {
        failCommand("settings-denied");
    }
    if (!fullName ||
        !email ||
        createAssignmentRoles.length === 0 ||
        (!canUseAllClinics(session) && !accessibleClinicIds(session).includes(clinicId))) {
        failCommand("settings-missing");
    }
    const role = primaryStaffRoleForAssignments(createAssignmentRoles);
    if (!canUseAllClinics(session) &&
        createAssignmentRoles.some(isOrganizationScopedRole)) {
        failCommand("settings-denied");
    }
    const scopedClinic = await findActiveScopedClinic(session, clinicId);
    if (!scopedClinic) {
        failCommand("settings-clinic-inactive");
    }
    const targetOrganizationId = scopedClinic.organizationId;
    if (targetOrganizationId !== session.organizationId && !isSuperAdminSession(session)) {
        failCommand("settings-denied");
    }
    let result: {
        userId: string;
        setup: PasswordSetupArtifacts;
    } | null = null;
    const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
    });
    if (existing) {
        failCommand("settings-email-exists");
    }
    result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
            data: {
                organizationId: targetOrganizationId,
                email,
                fullName,
                passwordHash: hashPassword(randomBytes(32).toString("base64url")),
                role,
                active: true,
                mustChangePassword: true,
                clinics: {
                    create: { clinicId },
                },
            },
            select: { id: true },
        });
        await tx.userRoleAssignment.createMany({
            data: createAssignmentRoles.map((assignmentRole) => roleAssignmentData(targetOrganizationId, user.id, assignmentRole, clinicId)),
            skipDuplicates: true,
        });
        await tx.staffProfile.create({
            data: {
                organizationId: targetOrganizationId,
                userId: user.id,
                clinicId,
                employeeCode: defaultEmployeeCode(user.id),
                title: title ?? defaultRoleTitle(role),
                department: "Clinic operations",
                active: true,
            },
        });
        const setup = await createPasswordSetupArtifactsTx(tx, {
            organizationId: targetOrganizationId,
            userId: user.id,
            createdById: databaseActorId(session.userId),
            email,
            fullName,
            clinicId,
        });
        await tx.auditLog.create({
            data: {
                organizationId: targetOrganizationId,
                actorId: databaseActorId(session.userId),
                action: "staff.created",
                entityType: "User",
                entityId: user.id,
                metadata: {
                    email,
                    derivedRole: role,
                    assignmentRoles: createAssignmentRoles,
                    clinicId,
                    createdFromOrganizationId: session.organizationId,
                },
            },
        });
        return { userId: user.id, setup };
    });
    return { result };
}
