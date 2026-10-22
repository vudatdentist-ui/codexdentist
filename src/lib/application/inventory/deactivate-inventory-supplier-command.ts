import "server-only";
import { canMutateInventory } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
export async function deactivateInventorySupplierCommand(input: {
    supplierId: string;
    session: AppSession;
}) {
    const { supplierId, session } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    if (!supplierId) {
        failCommand("inventory-missing");
    }
    await prisma.inventorySupplier.updateMany({
        where: {
            id: supplierId,
            organizationId: session.organizationId,
        },
        data: {
            active: false,
        },
    });
}
