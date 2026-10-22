import "server-only";
import type { Prisma } from "@prisma/client";
import { databaseActorId, } from "@/lib/form-validation";
import { canMutateInventory } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { allowedClinicIds, nextPurchaseOrderNo, } from "@/lib/application/inventory/support";
export async function createPurchaseOrderCommand(input: {
    supplierId: string;
    session: AppSession;
    itemId: string;
    clinicId: string;
    quantity: number | null;
    unitCost: number | null;
    expectedAt: import("@/lib/form-validation").ParsedDate;
}) {
    const { supplierId, session, itemId, clinicId, quantity, unitCost, expectedAt } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    if (!supplierId ||
        !itemId ||
        !quantity ||
        quantity <= 0 ||
        unitCost === null ||
        unitCost < 0 ||
        clinicId === "denied" ||
        expectedAt === "invalid") {
        failCommand("inventory-po-missing");
    }
    const [supplier, item] = await Promise.all([
        prisma.inventorySupplier.findFirst({
            where: {
                id: supplierId,
                organizationId: session.organizationId,
                active: true,
            },
            select: {
                id: true,
            },
        }),
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
                clinicId: true,
            },
        }),
    ]);
    if (!supplier || !item) {
        failCommand("inventory-item-not-found");
    }
    const scopedClinicId = clinicId === "all" ? item.clinicId ?? session.activeClinicId : clinicId;
    const poNo = await nextPurchaseOrderNo(session.organizationId);
    const totalAmount = quantity * unitCost;
    const order = await prisma.purchaseOrder.create({
        data: {
            organizationId: session.organizationId,
            clinicId: scopedClinicId,
            supplierId: supplier.id,
            poNo,
            status: "ORDERED",
            orderedAt: new Date(),
            expectedAt,
            totalAmount,
            lines: {
                create: {
                    itemId: item.id,
                    quantity,
                    unitCost,
                    receivedQuantity: 0,
                },
            },
        },
        select: {
            id: true,
        },
    });
    await prisma.auditLog.create({
        data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "inventory.purchase_order_created",
            entityType: "PurchaseOrder",
            entityId: order.id,
            metadata: {
                poNo,
                itemId: item.id,
                quantity,
                totalAmount,
            } as Prisma.InputJsonValue,
        },
    });
}
