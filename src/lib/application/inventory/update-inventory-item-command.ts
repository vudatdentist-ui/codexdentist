import "server-only";
import type { Prisma } from "@prisma/client";
import { databaseActorId, } from "@/lib/form-validation";
import { canMutateInventory } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { resolveScopedSupplier, resolveScopedItemGroup, resolveScopedTags, syncInventoryItemTags, allowedClinicIds, } from "@/lib/application/inventory/support";
export async function updateInventoryItemCommand(input: {
    itemId: string;
    session: AppSession;
    supplierId: string | null;
    supplierName: string | null;
    groupId: string | null;
    tagIds: string[];
    clinicId: string;
    category: string;
    lotTrackedInput: string;
    name: string;
    unit: string;
    minimumStock: number;
    averageUnitCost: number | null;
}) {
    const { itemId, session, supplierId, supplierName, groupId, tagIds, clinicId, category, lotTrackedInput, name, unit, minimumStock, averageUnitCost } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    if (!itemId || !name || clinicId === "denied") {
        failCommand("inventory-missing");
    }
    const [item, supplier, group, tags] = await Promise.all([
        prisma.inventoryItem.findFirst({
            where: {
                id: itemId,
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
        }),
        resolveScopedSupplier(session, supplierId, supplierName),
        resolveScopedItemGroup(session, groupId),
        resolveScopedTags(session, tagIds),
    ]);
    if (!item || (supplierId && !supplier) || (groupId && !group) || tags.length !== tagIds.length) {
        failCommand("inventory-item-not-found");
    }
    await prisma.inventoryItem.update({
        where: {
            id: item.id,
        },
        data: {
            clinicId: clinicId === "all" ? null : clinicId,
            supplierId: supplier?.id ?? null,
            groupId: group?.id ?? null,
            code: item.code,
            name,
            category: group?.name ?? category,
            unit,
            minimumStock,
            averageUnitCost,
            lotTracked: lotTrackedInput === "on",
            active: true,
        },
    });
    await syncInventoryItemTags(session, item.id, tags.map((tag) => tag.id));
    await prisma.auditLog.create({
        data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "inventory.item_updated",
            entityType: "InventoryItem",
            entityId: item.id,
            metadata: {
                code: item.code,
            } as Prisma.InputJsonValue,
        },
    });
}
