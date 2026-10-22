import "server-only";
import { canMutateInventory } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { normalizedCode, } from "@/lib/application/inventory/support";
export async function createInventoryItemGroupCommand(input: {
    session: AppSession;
    name: string;
}) {
    const { session, name } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    const code = normalizedCode(name);
    if (!code || !name) {
        failCommand("inventory-missing");
    }
    const nextSortOrder = ((await prisma.inventoryItemGroup.aggregate({
        where: {
            organizationId: session.organizationId,
        },
        _max: {
            sortOrder: true,
        },
    }))._max.sortOrder ?? 0) + 10;
    await prisma.inventoryItemGroup.upsert({
        where: {
            organizationId_code: {
                organizationId: session.organizationId,
                code,
            },
        },
        update: {
            name,
            active: true,
        },
        create: {
            organizationId: session.organizationId,
            code,
            name,
            sortOrder: nextSortOrder,
            active: true,
        },
    });
}
