import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canManageClinics, writeSettingsAuditLog, findChainOwnerCandidate, findScopedChain, } from "@/lib/application/settings/support";
export async function updateChainCommand(input: {
    ownerIdInput: string | null;
    session: AppSession;
    chainId: string;
    name: string;
    legalName: string | null;
    brandName: string | null;
    taxCode: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    specialty: string;
}) {
    const { ownerIdInput, session, chainId, name, legalName, brandName, taxCode, phone, email, website, specialty } = input;
    if (!canManageClinics(session)) {
        failCommand("settings-denied");
    }
    if (!chainId || !name) {
        failCommand("settings-chain-missing");
    }
    const scopedChain = await findScopedChain(session, chainId);
    if (!scopedChain) {
        failCommand("settings-chain-not-found");
    }
    const owner = ownerIdInput ? await findChainOwnerCandidate(session, ownerIdInput) : null;
    if (ownerIdInput && !owner) {
        failCommand("settings-chain-owner-missing");
    }
    await prisma.chain.update({
        where: {
            id: chainId,
        },
        data: {
            ownerId: owner?.id ?? null,
            name,
            legalName,
            brandName,
            taxCode,
            phone,
            email,
            website,
            specialty,
        },
    });
    await writeSettingsAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "chain.updated",
        entityType: "Chain",
        entityId: chainId,
        metadata: {
            name,
            specialty,
            ownerId: owner?.id ?? null,
        },
    });
}
