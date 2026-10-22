import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canWriteSettings, writeSettingsAuditLog, } from "@/lib/application/settings/support";
export async function toggleSourceCommissionPolicyCommand(input: {
    policyId: string;
    session: AppSession;
    active: boolean;
}) {
    const { policyId, session, active } = input;
    if (!canWriteSettings(session)) {
        failCommand("settings-denied");
    }
    if (!policyId) {
        failCommand("settings-source-policy-missing");
    }
    await prisma.sourceCommissionPolicy.updateMany({
        where: {
            id: policyId,
            organizationId: session.organizationId,
        },
        data: {
            active,
        },
    });
    await writeSettingsAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: active ? "source_commission_policy.activated" : "source_commission_policy.deactivated",
        entityType: "SourceCommissionPolicy",
        entityId: policyId,
    });
}
