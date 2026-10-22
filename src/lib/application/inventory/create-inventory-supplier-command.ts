import "server-only";
import { canMutateInventory } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { uniqueSupplierCode, supplierCodeBase, } from "@/lib/application/inventory/support";
export async function createInventorySupplierCommand(input: {
    session: AppSession;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
}) {
    const { session, name, phone, email, address } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    if (!name) {
        failCommand("inventory-missing");
    }
    const existingByName = await prisma.inventorySupplier.findFirst({
        where: {
            organizationId: session.organizationId,
            name,
        },
        select: {
            id: true,
        },
    });
    if (existingByName) {
        await prisma.inventorySupplier.update({
            where: {
                id: existingByName.id,
            },
            data: {
                phone,
                email,
                address,
                active: true,
            },
        });
    }
    else {
        const code = await uniqueSupplierCode(session.organizationId, supplierCodeBase(name));
        await prisma.inventorySupplier.upsert({
            where: {
                organizationId_code: {
                    organizationId: session.organizationId,
                    code,
                },
            },
            update: {
                name,
                phone,
                email,
                address,
                active: true,
            },
            create: {
                organizationId: session.organizationId,
                code,
                name,
                phone,
                email,
                address,
                active: true,
            },
        });
    }
}
