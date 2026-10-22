import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { canUseAllClinics, } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { roleAssignmentData, isOrganizationScopedRole, canWriteSettings, writeSettingsAuditLog, findScopedUser, assertCanManageStaffTarget, staffUserHasRole, assertAnotherActiveOwner, findActiveScopedClinic, primaryStaffRoleForAssignments, isStaffProfileRole, canAssignStaffRoles, } from "@/lib/application/settings/support";
export async function updateStaffRoleCommand(input: {
    session: AppSession;
    userId: string;
    assignmentRoles: ("OWNER" | "AREA_MANAGER" | "CLINIC_MANAGER" | "DENTIST" | "HYGIENIST" | "FRONT_DESK" | "BILLING")[];
    assignmentClinicId: string | null;
}) {
    const { session, userId, assignmentRoles, assignmentClinicId } = input;
    if (!canWriteSettings(session)) {
        failCommand("settings-denied");
    }
    if (!userId || assignmentRoles.length === 0) {
        failCommand("settings-missing");
    }
    if (!canAssignStaffRoles(session, assignmentRoles)) {
        failCommand("settings-denied");
    }
    if (!canUseAllClinics(session) &&
        assignmentRoles.some(isOrganizationScopedRole)) {
        failCommand("settings-denied");
    }
    let notice: string | null = null;
    const user = await findScopedUser(session, userId);
    if (!user) {
        notice = "settings-user-not-found";
    }
    else {
        assertCanManageStaffTarget(session, user);
        if (staffUserHasRole(user, "OWNER") && !assignmentRoles.includes("OWNER")) {
            await assertAnotherActiveOwner(user.organizationId, user.id);
        }
        const clinicScopedRoles = assignmentRoles.filter((assignmentRole) => !isOrganizationScopedRole(assignmentRole));
        const clinicId = assignmentClinicId ??
            user.clinics[0]?.clinicId ??
            session.activeClinicId ??
            accessibleClinicIds(session)[0] ??
            null;
        if (clinicScopedRoles.length > 0) {
            if (!clinicId) {
                failCommand("settings-missing");
            }
            const scopedClinic = await findActiveScopedClinic(session, clinicId);
            if (!scopedClinic || scopedClinic.organizationId !== user.organizationId) {
                failCommand("settings-user-not-found");
            }
        }
        const assignments = assignmentRoles.map((assignmentRole) => roleAssignmentData(user.organizationId, userId, assignmentRole, isOrganizationScopedRole(assignmentRole) ? null : clinicId));
        const managesAllClinics = canUseAllClinics(session);
        const preservedAssignments = managesAllClinics
            ? []
            : user.roleAssignments.filter((existingAssignment) => !existingAssignment.clinicId ||
                !accessibleClinicIds(session).includes(existingAssignment.clinicId));
        const role = primaryStaffRoleForAssignments([
            ...preservedAssignments
                .map((existingAssignment) => existingAssignment.role)
                .filter(isStaffProfileRole),
            ...assignmentRoles,
        ]);
        const membershipClinicIds = clinicScopedRoles.length > 0 && clinicId ? [clinicId] : [];
        const userClinicDeleteWhere = managesAllClinics
            ? { userId }
            : {
                userId,
                clinicId: {
                    in: accessibleClinicIds(session),
                },
            };
        const roleAssignmentDeleteWhere = managesAllClinics
            ? {
                userId,
                organizationId: user.organizationId,
            }
            : {
                userId,
                organizationId: user.organizationId,
                clinicId: {
                    in: accessibleClinicIds(session),
                },
            };
        const staffProfileUpdateWhere = managesAllClinics
            ? {
                userId,
                organizationId: user.organizationId,
            }
            : {
                userId,
                organizationId: user.organizationId,
                clinicId: {
                    in: accessibleClinicIds(session),
                },
            };
        await prisma.$transaction([
            prisma.user.update({
                where: {
                    id: userId,
                },
                data: {
                    role,
                },
            }),
            prisma.userRoleAssignment.deleteMany({
                where: roleAssignmentDeleteWhere,
            }),
            prisma.userRoleAssignment.createMany({
                data: assignments,
                skipDuplicates: true,
            }),
            prisma.userClinic.deleteMany({
                where: userClinicDeleteWhere,
            }),
            ...(membershipClinicIds.length > 0
                ? [
                    prisma.userClinic.createMany({
                        data: membershipClinicIds.map((membershipClinicId) => ({
                            userId,
                            clinicId: membershipClinicId,
                        })),
                        skipDuplicates: true,
                    }),
                ]
                : []),
            ...(clinicScopedRoles.length > 0 && clinicId
                ? [
                    prisma.staffProfile.updateMany({
                        where: staffProfileUpdateWhere,
                        data: {
                            clinicId,
                        },
                    }),
                ]
                : []),
        ]);
        await writeSettingsAuditLog({
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "staff.role_updated",
            entityId: userId,
            metadata: {
                derivedRole: role,
                assignmentRoles,
                assignmentClinicId: clinicId,
            },
        });
    }
    return { notice };
}
