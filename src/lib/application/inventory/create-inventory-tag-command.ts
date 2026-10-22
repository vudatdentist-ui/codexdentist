import "server-only";
import { canMutateInventory } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { normalizedCode, } from "@/lib/application/inventory/support";
export async function createInventoryTagCommand(input: {
    session: AppSession;
    colorInput: string | null;
    name: string;
}) {
    const { session, colorInput, name } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    const code = normalizedCode(name);
    if (!code || !name) {
        failCommand("inventory-missing");
    }
    await prisma.inventoryTag.upsert({
        where: {
            organizationId_code: {
                organizationId: session.organizationId,
                code,
            },
        },
        update: {
            name,
            color: colorInput,
            active: true,
        },
        create: {
            organizationId: session.organizationId,
            code,
            name,
            color: colorInput,
            active: true,
        },
    });
}
