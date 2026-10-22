import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canManageClinics, findScopedChain, } from "@/lib/application/settings/support";
export async function toggleChainStatusCommand(input: {
    chainId: string;
    session: AppSession;
    active: boolean;
}) {
    const { chainId, session, active } = input;
    if (!canManageClinics(session)) {
        failCommand("settings-denied");
    }
    if (!chainId) {
        failCommand("settings-chain-not-found");
    }
    const scopedChain = await findScopedChain(session, chainId);
    if (!scopedChain) {
        failCommand("settings-chain-not-found");
    }
    await prisma.$transaction([
        prisma.chain.update({
            where: {
                id: chainId,
            },
            data: {
                active,
            },
        }),
        prisma.auditLog.create({
            data: {
                organizationId: session.organizationId,
                actorId: databaseActorId(session.userId),
                action: active ? "chain.activated" : "chain.deactivated",
                entityType: "Chain",
                entityId: chainId,
            },
        }),
    ]);
}
