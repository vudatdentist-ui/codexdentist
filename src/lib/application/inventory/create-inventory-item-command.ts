import "server-only";
import { canMutateInventory } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { resolveScopedSupplier, resolveScopedItemGroup, resolveScopedTags, uniqueInventoryItemCode, normalizedCode, syncInventoryItemTags, } from "@/lib/application/inventory/support";
export async function createInventoryItemCommand(input: {
    session: AppSession;
    supplierId: string | null;
    supplierName: string | null;
    groupId: string | null;
    tagIds: string[];
    category: string;
    name: string;
    clinicId: string;
    skuInput: string | null;
    lotTrackedInput: string;
    unit: string;
    minimumStock: number;
    onHandQuantity: number;
    averageUnitCost: number | null;
}) {
    const { session, supplierId, supplierName, groupId, tagIds, category, name, clinicId, skuInput, lotTrackedInput, unit, minimumStock, onHandQuantity, averageUnitCost } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    if (!name || clinicId === "denied") {
        failCommand("inventory-missing");
    }
    const [supplier, group, tags] = await Promise.all([
        resolveScopedSupplier(session, supplierId, supplierName),
        resolveScopedItemGroup(session, groupId),
        resolveScopedTags(session, tagIds),
    ]);
    if ((supplierId && !supplier) || (groupId && !group) || tags.length !== tagIds.length) {
        failCommand("inventory-item-not-found");
    }
    const code = await uniqueInventoryItemCode(session.organizationId, normalizedCode(`${group?.name ?? category}-${name}`) || "ITEM");
    const item = await prisma.inventoryItem.create({
        data: {
            organizationId: session.organizationId,
            clinicId: clinicId === "all" ? null : clinicId,
            supplierId: supplier?.id ?? null,
            groupId: group?.id ?? null,
            code,
            name,
            category: group?.name ?? category,
            unit,
            minimumStock,
            onHandQuantity,
            averageUnitCost,
            sku: skuInput,
            lotTracked: lotTrackedInput === "on",
            active: true,
        },
        select: {
            id: true,
        },
    });
    await syncInventoryItemTags(session, item.id, tags.map((tag) => tag.id));
}
