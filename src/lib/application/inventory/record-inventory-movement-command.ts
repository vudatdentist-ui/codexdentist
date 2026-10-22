import { runSerializableTransaction } from "@/lib/transaction";
import "server-only";
import type { Prisma } from "@prisma/client";
import { databaseActorId, } from "@/lib/form-validation";
import { canMutateInventory } from "@/lib/inventory";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { allowedClinicIds, signedMovementQuantity, resolveInventoryClinicId, } from "@/lib/application/inventory/support";
export async function recordInventoryMovementCommand(input: {
    itemId: string;
    session: AppSession;
    type: "PURCHASE" | "TRANSFER_IN" | "TRANSFER_OUT" | "CONSUMPTION" | "ADJUSTMENT" | "WASTE" | "RETURN" | null;
    quantity: number | null;
    referenceTypeInput: string | null;
    referenceIdInput: string | null;
    noteInput: string | null;
    unitCost: number | null;
}) {
    const { itemId, session, type, quantity, referenceTypeInput, referenceIdInput, noteInput, unitCost } = input;
    if (!canMutateInventory(session)) {
        failCommand("inventory-denied");
    }
    if (!itemId || !type || !quantity || quantity <= 0) {
        failCommand("inventory-missing");
    }
    await runSerializableTransaction(async (tx) => {
        const item = await tx.inventoryItem.findFirst({
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
                onHandQuantity: true,
            },
        });
        if (!item) {
            failCommand("inventory-item-not-found");
        }
        const signedQuantity = signedMovementQuantity(type, quantity);
        const nextOnHandQuantity = Number(item.onHandQuantity) + signedQuantity;
        if (nextOnHandQuantity < 0) {
            failCommand("inventory-negative-stock");
        }
        const movementClinicId = resolveInventoryClinicId(session, item.clinicId);
        if (!movementClinicId) {
            failCommand("inventory-missing");
        }
        await tx.inventoryMovement.create({
            data: {
                organizationId: session.organizationId,
                clinicId: movementClinicId,
                itemId: item.id,
                performedById: databaseActorId(session.userId),
                type,
                quantity,
                unitCost,
                referenceType: referenceTypeInput,
                referenceId: referenceIdInput,
                note: noteInput,
            },
        });
        await tx.inventoryItem.update({
            where: {
                id: item.id,
            },
            data: {
                onHandQuantity: nextOnHandQuantity,
                averageUnitCost: unitCost ?? undefined,
            },
        });
        await tx.auditLog.create({
            data: {
                organizationId: session.organizationId,
                actorId: databaseActorId(session.userId),
                action: "inventory.movement_recorded",
                entityType: "InventoryItem",
                entityId: item.id,
                metadata: {
                    type,
                    quantity,
                } as Prisma.InputJsonValue,
            },
        });
    });
}
