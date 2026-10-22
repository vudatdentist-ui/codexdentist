import { runSerializableTransaction } from "@/lib/transaction";
import "server-only";
import type { Prisma } from "@prisma/client";
import { databaseActorId, } from "@/lib/form-validation";
import { canMutateInventory } from "@/lib/inventory";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { allowedClinicIds, resolveInventoryClinicId, } from "@/lib/application/inventory/support";
export async function receivePurchaseOrderCommand(input: {
    purchaseOrderId: string;
    session: AppSession;
    requestedReceiveQuantity: number | null;
    lotNo: string | null;
    expiresAt: import("@/lib/form-validation").ParsedDate;
}) {
    const { purchaseOrderId, session, requestedReceiveQuantity, lotNo, expiresAt } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    if (!purchaseOrderId ||
        expiresAt === "invalid" ||
        (requestedReceiveQuantity !== null && requestedReceiveQuantity <= 0)) {
        failCommand("inventory-po-missing");
    }
    await runSerializableTransaction(async (tx) => {
        const order = await tx.purchaseOrder.findFirst({
            where: {
                id: purchaseOrderId,
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
            include: {
                lines: {
                    include: {
                        item: {
                            select: {
                                id: true,
                                clinicId: true,
                                lotTracked: true,
                            },
                        },
                    },
                },
            },
        });
        if (!order || order.status === "RECEIVED" || order.lines.length === 0) {
            failCommand("inventory-po-missing");
        }
        let remainingAfterReceive = 0;
        for (const line of order.lines) {
            const remainingLineQuantity = Number(line.quantity) - Number(line.receivedQuantity);
            const quantityToReceive = requestedReceiveQuantity === null
                ? remainingLineQuantity
                : Math.min(requestedReceiveQuantity, remainingLineQuantity);
            if (quantityToReceive <= 0) {
                remainingAfterReceive += Math.max(remainingLineQuantity, 0);
                continue;
            }
            const receivingClinicId = resolveInventoryClinicId(session, order.clinicId, line.item.clinicId);
            if (!receivingClinicId) {
                failCommand("inventory-po-missing");
            }
            const lotRecord = lotNo || line.item.lotTracked
                ? await tx.inventoryLot.upsert({
                    where: {
                        itemId_lotNo: {
                            itemId: line.itemId,
                            lotNo: lotNo ?? `${order.poNo}-${line.itemId.slice(-4)}`,
                        },
                    },
                    update: {
                        quantityOnHand: {
                            increment: quantityToReceive,
                        },
                        expiresAt,
                    },
                    create: {
                        organizationId: session.organizationId,
                        clinicId: receivingClinicId,
                        itemId: line.itemId,
                        lotNo: lotNo ?? `${order.poNo}-${line.itemId.slice(-4)}`,
                        expiresAt,
                        quantityOnHand: quantityToReceive,
                    },
                    select: {
                        id: true,
                    },
                })
                : null;
            await tx.inventoryMovement.create({
                data: {
                    organizationId: session.organizationId,
                    clinicId: receivingClinicId,
                    itemId: line.itemId,
                    lotId: lotRecord?.id ?? null,
                    performedById: databaseActorId(session.userId),
                    type: "PURCHASE",
                    quantity: quantityToReceive,
                    unitCost: Number(line.unitCost),
                    referenceType: "PurchaseOrder",
                    referenceId: order.id,
                    note: order.poNo,
                },
            });
            await tx.inventoryItem.update({
                where: {
                    id: line.itemId,
                },
                data: {
                    onHandQuantity: {
                        increment: quantityToReceive,
                    },
                    averageUnitCost: Number(line.unitCost),
                },
            });
            await tx.purchaseOrderLine.update({
                where: {
                    id: line.id,
                },
                data: {
                    receivedQuantity: {
                        increment: quantityToReceive,
                    },
                },
            });
            remainingAfterReceive += Math.max(remainingLineQuantity - quantityToReceive, 0);
        }
        await tx.purchaseOrder.update({
            where: {
                id: order.id,
            },
            data: {
                status: remainingAfterReceive > 0 ? "PARTIAL" : "RECEIVED",
                receivedAt: remainingAfterReceive > 0 ? null : new Date(),
            },
        });
        await tx.auditLog.create({
            data: {
                organizationId: session.organizationId,
                actorId: databaseActorId(session.userId),
                action: "inventory.purchase_order_received",
                entityType: "PurchaseOrder",
                entityId: order.id,
                metadata: {
                    poNo: order.poNo,
                    lotNo,
                } as Prisma.InputJsonValue,
            },
        });
    });
}
