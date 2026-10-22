import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canManageClinics, findScopedChair, } from "@/lib/application/settings/support";
export async function toggleChairStatusCommand(input: {
    chairId: string;
    active: boolean;
    session: AppSession;
    clinicId: string;
}) {
    const { chairId, active, session, clinicId } = input;
    if (!canManageClinics(session)) {
        failCommand("settings-denied");
    }
    if (!chairId || !clinicId) {
        failCommand("settings-chair-not-found");
    }
    const scopedChair = await findScopedChair(session, chairId, clinicId);
    if (!scopedChair) {
        failCommand("settings-chair-not-found");
    }
    await prisma.$transaction([
        prisma.chair.update({
            where: {
                id: chairId,
            },
            data: {
                active,
                operationalStatus: active ? "READY" : "READY",
                operationalStatusUpdatedAt: new Date(),
            },
        }),
        prisma.auditLog.create({
            data: {
                organizationId: scopedChair.clinic.organizationId,
                actorId: databaseActorId(session.userId),
                action: active ? "chair.activated" : "chair.deactivated",
                entityType: "Chair",
                entityId: chairId,
                metadata: {
                    clinicId,
                },
            },
        }),
    ]);
}
