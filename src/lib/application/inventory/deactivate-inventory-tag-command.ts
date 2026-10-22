import "server-only";
import { canMutateInventory } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
export async function deactivateInventoryTagCommand(input: {
    tagId: string;
    session: AppSession;
}) {
    const { tagId, session } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    if (!tagId) {
        failCommand("inventory-missing");
    }
    await prisma.inventoryTag.updateMany({
        where: {
            id: tagId,
            organizationId: session.organizationId,
        },
        data: {
            active: false,
        },
    });
}
