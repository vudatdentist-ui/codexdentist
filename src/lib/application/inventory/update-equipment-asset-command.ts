import "server-only";
import type { Prisma } from "@prisma/client";
import { databaseActorId, } from "@/lib/form-validation";
import { canMutateInventory } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { allowedClinicIds, } from "@/lib/application/inventory/support";
export async function updateEquipmentAssetCommand(input: {
    assetId: string;
    session: AppSession;
    clinicId: string;
    serialNoInput: string | null;
    purchasedAt: import("@/lib/form-validation").ParsedDate;
    costInput: number | null;
    warrantyEndsAt: import("@/lib/form-validation").ParsedDate;
    name: string;
    category: string;
    status: "ACTIVE" | "MAINTENANCE" | "RETIRED" | "LOST" | null;
}) {
    const { assetId, session, clinicId, serialNoInput, purchasedAt, costInput, warrantyEndsAt, name, category, status } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    if (!assetId ||
        !name ||
        !status ||
        clinicId === "denied" ||
        purchasedAt === "invalid" ||
        warrantyEndsAt === "invalid") {
        failCommand("inventory-missing");
    }
    const asset = await prisma.equipmentAsset.findFirst({
        where: {
            id: assetId,
            organizationId: session.organizationId,
            OR: [
                {
                    clinicId: null,
                },
                {
                    clinicId: {
                        in: allowedClinicIds(session),
                    },
                },
            ],
        },
        select: {
            id: true,
            code: true,
        },
    });
    if (!asset) {
        failCommand("inventory-item-not-found");
    }
    const code = asset.code;
    await prisma.equipmentAsset.update({
        where: {
            id: asset.id,
        },
        data: {
            clinicId: clinicId === "all" ? null : clinicId,
            code,
            name,
            category,
            serialNo: serialNoInput,
            purchasedAt: purchasedAt ?? undefined,
            cost: costInput,
            warrantyEndsAt: warrantyEndsAt ?? undefined,
            status,
        },
    });
    await prisma.auditLog.create({
        data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "inventory.equipment_updated",
            entityType: "EquipmentAsset",
            entityId: asset.id,
            metadata: {
                code,
                status,
            } as Prisma.InputJsonValue,
        },
    });
}
