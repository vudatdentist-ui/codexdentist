import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { createPasswordSetupArtifactsTx, PasswordSetupArtifacts, canWriteSettings, findScopedUser, assertCanManageStaffTarget, } from "@/lib/application/settings/support";
export async function createStaffPasswordSetupLinkCommand(input: {
    session: AppSession;
    userId: string;
}) {
    const { session, userId } = input;
    if (!canWriteSettings(session)) {
        failCommand("settings-denied");
    }
    if (!userId) {
        failCommand("settings-user-not-found");
    }
    if (userId === session.userId) {
        failCommand("settings-self-password-link");
    }
    const user = await findScopedUser(session, userId);
    if (!user) {
        failCommand("settings-user-not-found");
    }
    assertCanManageStaffTarget(session, user);
    let setup: PasswordSetupArtifacts | null = null;
    setup = await prisma.$transaction(async (tx) => {
        const artifacts = await createPasswordSetupArtifactsTx(tx, {
            organizationId: session.organizationId,
            userId: user.id,
            createdById: databaseActorId(session.userId),
            email: user.email,
            fullName: user.fullName,
            clinicId: user.clinics[0]?.clinicId ??
                session.activeClinicId ??
                accessibleClinicIds(session)[0] ??
                null,
        });
        await tx.user.update({
            where: { id: user.id },
            data: { mustChangePassword: true },
        });
        await tx.auditLog.create({
            data: {
                organizationId: session.organizationId,
                actorId: databaseActorId(session.userId),
                action: "staff.password_setup_link_created",
                entityType: "User",
                entityId: user.id,
            },
        });
        return artifacts;
    });
    return { setup, setupEmail: user.email };
}
