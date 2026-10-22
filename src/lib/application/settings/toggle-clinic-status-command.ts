import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canManageClinics, findScopedClinic, } from "@/lib/application/settings/support";
export async function toggleClinicStatusCommand(input: {
    clinicId: string;
    session: AppSession;
    active: boolean;
}) {
    const { clinicId, session, active } = input;
    if (!canManageClinics(session)) {
        failCommand("settings-denied");
    }
    if (!clinicId) {
        failCommand("settings-clinic-not-found");
    }
    const scopedClinic = await findScopedClinic(session, clinicId);
    if (!scopedClinic) {
        failCommand("settings-clinic-not-found");
    }
    await prisma.$transaction([
        prisma.clinic.update({
            where: {
                id: clinicId,
            },
            data: {
                active,
            },
        }),
        prisma.auditLog.create({
            data: {
                organizationId: session.organizationId,
                actorId: databaseActorId(session.userId),
                action: active ? "clinic.activated" : "clinic.deactivated",
                entityType: "Clinic",
                entityId: clinicId,
            },
        }),
    ]);
}
