import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canWriteSettings, writeSettingsAuditLog, findScopedUser, assertCanManageStaffTarget, staffUserHasRole, assertAnotherActiveOwner, } from "@/lib/application/settings/support";
export async function toggleStaffStatusCommand(input: {
    session: AppSession;
    userId: string;
    active: boolean;
}) {
    const { session, userId, active } = input;
    if (!canWriteSettings(session)) {
        failCommand("settings-denied");
    }
    if (!userId || userId === session.userId) {
        failCommand("settings-user-not-found");
    }
    let notice: string | null = null;
    const user = await findScopedUser(session, userId);
    if (!user) {
        notice = "settings-user-not-found";
    }
    else {
        assertCanManageStaffTarget(session, user);
        if (!active && staffUserHasRole(user, "OWNER")) {
            await assertAnotherActiveOwner(user.organizationId, user.id);
        }
        await prisma.user.update({
            where: {
                id: userId,
            },
            data: {
                active,
            },
        });
        await writeSettingsAuditLog({
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: active ? "staff.activated" : "staff.deactivated",
            entityId: userId,
        });
    }
    return { notice };
}
