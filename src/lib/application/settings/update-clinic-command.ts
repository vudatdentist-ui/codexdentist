import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canManageClinics, writeSettingsAuditLog, findScopedClinic, } from "@/lib/application/settings/support";
export async function updateClinicCommand(input: {
    clinicId: string;
    phone: string;
    session: AppSession;
    name: string;
    city: string;
    address: string;
}) {
    const { clinicId, phone, session, name, city, address } = input;
    if (!canManageClinics(session)) {
        failCommand("settings-denied");
    }
    if (!clinicId || !name || !city || !address) {
        failCommand("settings-clinic-missing");
    }
    const scopedClinic = await findScopedClinic(session, clinicId);
    if (!scopedClinic) {
        failCommand("settings-clinic-not-found");
    }
    const targetOrganizationId = scopedClinic.organizationId;
    await prisma.clinic.update({
        where: {
            id: clinicId,
        },
        data: {
            organizationId: targetOrganizationId,
            chainId: null,
            name,
            city,
            address,
            phone: phone || null,
        },
    });
    await writeSettingsAuditLog({
        organizationId: targetOrganizationId,
        actorId: databaseActorId(session.userId),
        action: "clinic.updated",
        entityId: clinicId,
        metadata: {
            name,
            city,
        },
    });
}
