import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canManageClinics, writeSettingsAuditLog, findScopedChair, } from "@/lib/application/settings/support";
export async function updateChairCommand(input: {
    chairId: string;
    session: AppSession;
    name: string;
    specialty: string | null;
    clinicId: string;
}) {
    const { chairId, session, name, specialty, clinicId } = input;
    if (!canManageClinics(session)) {
        failCommand("settings-denied");
    }
    if (!chairId || !clinicId || !name) {
        failCommand("settings-chair-missing");
    }
    const scopedChair = await findScopedChair(session, chairId, clinicId);
    if (!scopedChair) {
        failCommand("settings-chair-not-found");
    }
    await prisma.chair.update({
        where: {
            id: chairId,
        },
        data: {
            name,
            specialty,
        },
    });
    await writeSettingsAuditLog({
        organizationId: scopedChair.clinic.organizationId,
        actorId: databaseActorId(session.userId),
        action: "chair.updated",
        entityType: "Chair",
        entityId: chairId,
        metadata: {
            clinicId,
            name,
            specialty,
        },
    });
}
