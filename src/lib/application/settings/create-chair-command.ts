import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canManageClinics, writeSettingsAuditLog, findScopedClinic, } from "@/lib/application/settings/support";
export async function createChairCommand(input: {
    session: AppSession;
    clinicId: string;
    name: string;
    specialty: string | null;
}) {
    const { session, clinicId, name, specialty } = input;
    if (!canManageClinics(session)) {
        failCommand("settings-denied");
    }
    if (!clinicId || !name) {
        failCommand("settings-chair-missing");
    }
    const scopedClinic = await findScopedClinic(session, clinicId);
    if (!scopedClinic) {
        failCommand("settings-clinic-not-found");
    }
    const chair = await prisma.chair.create({
        data: {
            clinicId,
            name,
            specialty,
            active: true,
            operationalStatus: "READY",
        },
        select: {
            id: true,
        },
    });
    await writeSettingsAuditLog({
        organizationId: scopedClinic.organizationId,
        actorId: databaseActorId(session.userId),
        action: "chair.created",
        entityType: "Chair",
        entityId: chair.id,
        metadata: {
            clinicId,
            name,
            specialty,
        },
    });
}
