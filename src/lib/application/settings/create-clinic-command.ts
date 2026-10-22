import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canManageClinics, targetClinicOrganizationId, writeSettingsAuditLog, } from "@/lib/application/settings/support";
export async function createClinicCommand(input: {
    session: AppSession;
    organizationIdInput: string | null;
    phone: string;
    name: string;
    city: string;
    address: string;
}) {
    const { session, organizationIdInput, phone, name, city, address } = input;
    if (!canManageClinics(session)) {
        failCommand("settings-denied");
    }
    if (!name || !city || !address) {
        failCommand("settings-clinic-missing");
    }
    const targetOrganizationId = await targetClinicOrganizationId(session, organizationIdInput);
    const clinic = await prisma.clinic.create({
        data: {
            organizationId: targetOrganizationId,
            chainId: null,
            name,
            city,
            address,
            phone: phone || null,
            ...(targetOrganizationId === session.organizationId
                ? {
                    users: {
                        create: {
                            userId: databaseActorId(session.userId) ?? session.userId,
                        },
                    },
                }
                : {}),
        },
        select: {
            id: true,
        },
    });
    await writeSettingsAuditLog({
        organizationId: targetOrganizationId,
        actorId: databaseActorId(session.userId),
        action: "clinic.created",
        entityId: clinic.id,
        metadata: {
            name,
            city,
        },
    });
}
