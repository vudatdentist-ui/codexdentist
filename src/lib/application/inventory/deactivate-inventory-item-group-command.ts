import "server-only";
import { canMutateInventory } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
export async function deactivateInventoryItemGroupCommand(input: {
    groupId: string;
    session: AppSession;
}) {
    const { groupId, session } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    if (!groupId) {
        failCommand("inventory-missing");
    }
    await prisma.inventoryItemGroup.updateMany({
        where: {
            id: groupId,
            organizationId: session.organizationId,
        },
        data: {
            active: false,
        },
    });
}
