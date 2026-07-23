"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  optionalString,
  parseDateInVietnam,
  parseMoney,
  requiredString,
} from "@/lib/form-validation";
import { canMutateInventory } from "@/lib/inventory";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const movementTypes = [
  "PURCHASE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "CONSUMPTION",
  "ADJUSTMENT",
  "WASTE",
  "RETURN",
] as const;
const assetStatuses = ["ACTIVE", "MAINTENANCE", "RETIRED", "LOST"] as const;

export async function createInventorySupplierAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const name = requiredString(formData.get("name"));
  const phone = optionalString(formData.get("phone"));
  const email = optionalString(formData.get("email"));
  const address = optionalString(formData.get("address"));
  const returnSection =
    optionalString(formData.get("returnSection")) === "settings" ? "settings" : "procurement";

  if (!name) {
    redirect("/inventory?notice=inventory-missing");
  }

  try {
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
    } else {
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
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/inventory?notice=inventory-database");
  }

  revalidatePath("/inventory");
  redirect(`/inventory?section=${returnSection}&notice=inventory-supplier-saved`);
}

export async function createInventoryItemGroupAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const name = requiredString(formData.get("name"));
  const code = normalizedCode(name);

  if (!code || !name) {
    redirect("/inventory?section=settings&notice=inventory-missing");
  }

  try {
    const nextSortOrder =
      ((
        await prisma.inventoryItemGroup.aggregate({
          where: {
            organizationId: session.organizationId,
          },
          _max: {
            sortOrder: true,
          },
        })
      )._max.sortOrder ?? 0) + 10;

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
  } catch {
    redirect("/inventory?section=settings&notice=inventory-database");
  }

  revalidateInventoryViews();
  redirect("/inventory?section=settings&notice=inventory-group-saved");
}

export async function createInventoryTagAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const name = requiredString(formData.get("name"));
  const code = normalizedCode(name);

  if (!code || !name) {
    redirect("/inventory?section=settings&notice=inventory-missing");
  }

  try {
    await prisma.inventoryTag.upsert({
      where: {
        organizationId_code: {
          organizationId: session.organizationId,
          code,
        },
      },
      update: {
        name,
        color: optionalString(formData.get("color")),
        active: true,
      },
      create: {
        organizationId: session.organizationId,
        code,
        name,
        color: optionalString(formData.get("color")),
        active: true,
      },
    });
  } catch {
    redirect("/inventory?section=settings&notice=inventory-database");
  }

  revalidateInventoryViews();
  redirect("/inventory?section=settings&notice=inventory-tag-saved");
}

export async function deactivateInventoryItemGroupAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const groupId = requiredString(formData.get("groupId"));

  if (!groupId) {
    redirect("/inventory?section=settings&notice=inventory-missing");
  }

  try {
    await prisma.inventoryItemGroup.updateMany({
      where: {
        id: groupId,
        organizationId: session.organizationId,
      },
      data: {
        active: false,
      },
    });
  } catch {
    redirect("/inventory?section=settings&notice=inventory-database");
  }

  revalidateInventoryViews();
  redirect("/inventory?section=settings&notice=inventory-group-disabled");
}

export async function deactivateInventoryTagAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const tagId = requiredString(formData.get("tagId"));

  if (!tagId) {
    redirect("/inventory?section=settings&notice=inventory-missing");
  }

  try {
    await prisma.inventoryTag.updateMany({
      where: {
        id: tagId,
        organizationId: session.organizationId,
      },
      data: {
        active: false,
      },
    });
  } catch {
    redirect("/inventory?section=settings&notice=inventory-database");
  }

  revalidateInventoryViews();
  redirect("/inventory?section=settings&notice=inventory-tag-disabled");
}

export async function deactivateInventorySupplierAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const supplierId = requiredString(formData.get("supplierId"));

  if (!supplierId) {
    redirect("/inventory?section=settings&notice=inventory-missing");
  }

  try {
    await prisma.inventorySupplier.updateMany({
      where: {
        id: supplierId,
        organizationId: session.organizationId,
      },
      data: {
        active: false,
      },
    });
  } catch {
    redirect("/inventory?section=settings&notice=inventory-database");
  }

  revalidateInventoryViews();
  redirect("/inventory?section=settings&notice=inventory-supplier-disabled");
}

export async function createInventoryItemAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const name = requiredString(formData.get("name"));
  const category = requiredString(formData.get("category")) || "Consumable";
  const unit = requiredString(formData.get("unit")) || "unit";
  const minimumStock = parseMoney(formData.get("minimumStock")) ?? 0;
  const onHandQuantity = parseMoney(formData.get("onHandQuantity")) ?? 0;
  const averageUnitCost = parseMoney(formData.get("averageUnitCost"));
  const clinicId = normalizeClinicId(formData.get("clinicId"), session);
  const supplierId = optionalString(formData.get("supplierId"));
  const supplierName = optionalString(formData.get("supplierName"));
  const groupId = optionalString(formData.get("groupId"));
  const tagIds = normalizeTagIds(formData);

  if (!name || clinicId === "denied") {
    redirect("/inventory?notice=inventory-missing");
  }

  try {
    const [supplier, group, tags] = await Promise.all([
      resolveScopedSupplier(session, supplierId, supplierName),
      resolveScopedItemGroup(session, groupId),
      resolveScopedTags(session, tagIds),
    ]);

    if ((supplierId && !supplier) || (groupId && !group) || tags.length !== tagIds.length) {
      redirect("/inventory?notice=inventory-item-not-found");
    }

    const code = await uniqueInventoryItemCode(
      session.organizationId,
      normalizedCode(`${group?.name ?? category}-${name}`) || "ITEM",
    );

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
        sku: optionalString(formData.get("sku")),
        lotTracked: requiredString(formData.get("lotTracked")) === "on",
        active: true,
      },
      select: {
        id: true,
      },
    });

    await syncInventoryItemTags(session, item.id, tags.map((tag) => tag.id));
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/inventory?notice=inventory-database");
  }

  revalidateInventoryViews();
  redirect("/inventory?section=stock&notice=inventory-item-saved");
}

export async function updateInventoryItemAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const itemId = requiredString(formData.get("itemId"));
  const name = requiredString(formData.get("name"));
  const category = requiredString(formData.get("category")) || "Consumable";
  const unit = requiredString(formData.get("unit")) || "unit";
  const minimumStock = parseMoney(formData.get("minimumStock")) ?? 0;
  const averageUnitCost = parseMoney(formData.get("averageUnitCost"));
  const clinicId = normalizeClinicId(formData.get("clinicId"), session);
  const supplierId = optionalString(formData.get("supplierId"));
  const supplierName = optionalString(formData.get("supplierName"));
  const groupId = optionalString(formData.get("groupId"));
  const tagIds = normalizeTagIds(formData);

  if (!itemId || !name || clinicId === "denied") {
    redirect("/inventory?notice=inventory-missing");
  }

  try {
    const [item, supplier, group, tags] = await Promise.all([
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
          code: true,
        },
      }),
      resolveScopedSupplier(session, supplierId, supplierName),
      resolveScopedItemGroup(session, groupId),
      resolveScopedTags(session, tagIds),
    ]);

    if (!item || (supplierId && !supplier) || (groupId && !group) || tags.length !== tagIds.length) {
      redirect("/inventory?notice=inventory-item-not-found");
    }

    await prisma.inventoryItem.update({
      where: {
        id: item.id,
      },
      data: {
        clinicId: clinicId === "all" ? null : clinicId,
        supplierId: supplier?.id ?? null,
        groupId: group?.id ?? null,
        code: item.code,
        name,
        category: group?.name ?? category,
        unit,
        minimumStock,
        averageUnitCost,
        lotTracked: requiredString(formData.get("lotTracked")) === "on",
        active: true,
      },
    });

    await syncInventoryItemTags(session, item.id, tags.map((tag) => tag.id));

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "inventory.item_updated",
        entityType: "InventoryItem",
        entityId: item.id,
        metadata: {
          code: item.code,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/inventory?notice=inventory-database");
  }

  revalidateInventoryViews();
  redirect("/inventory?section=stock&notice=inventory-item-saved");
}

export async function updateEquipmentAssetAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const assetId = requiredString(formData.get("assetId"));
  const name = requiredString(formData.get("name"));
  const category = requiredString(formData.get("category")) || "Thiết bị";
  const status = normalizeAssetStatus(formData.get("status"));
  const clinicId = normalizeClinicId(formData.get("clinicId"), session);
  const purchasedAt = parseOptionalDate(formData.get("purchasedAt"));
  const warrantyEndsAt = parseOptionalDate(formData.get("warrantyEndsAt"));

  if (
    !assetId ||
    !name ||
    !status ||
    clinicId === "denied" ||
    purchasedAt === "invalid" ||
    warrantyEndsAt === "invalid"
  ) {
    redirect("/inventory?notice=inventory-missing");
  }

  try {
    const asset = await prisma.equipmentAsset.findFirst({
      where: {
        id: assetId,
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
        code: true,
      },
    });

    if (!asset) {
      redirect("/inventory?notice=inventory-item-not-found");
    }

    const code = asset.code;

    await prisma.equipmentAsset.update({
      where: {
        id: asset.id,
      },
      data: {
        clinicId: clinicId === "all" ? null : clinicId,
        code,
        name,
        category,
        serialNo: optionalString(formData.get("serialNo")),
        purchasedAt: purchasedAt ?? undefined,
        cost: parseMoney(formData.get("cost")),
        warrantyEndsAt: warrantyEndsAt ?? undefined,
        status,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "inventory.equipment_updated",
        entityType: "EquipmentAsset",
        entityId: asset.id,
        metadata: {
          code,
          status,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/inventory?notice=inventory-database");
  }

  revalidateInventoryViews();
  redirect("/inventory?notice=inventory-item-saved");
}

export async function recordInventoryMovementAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const itemId = requiredString(formData.get("itemId"));
  const type = normalizeMovementType(formData.get("type"));
  const quantity = parseMoney(formData.get("quantity"));
  const unitCost = parseMoney(formData.get("unitCost"));

  if (!itemId || !type || !quantity || quantity <= 0) {
    redirect("/inventory?notice=inventory-missing");
  }

  try {
    const item = await prisma.inventoryItem.findFirst({
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
      redirect("/inventory?notice=inventory-item-not-found");
    }

    const signedQuantity = signedMovementQuantity(type, quantity);
    const nextOnHandQuantity = Number(item.onHandQuantity) + signedQuantity;

    if (nextOnHandQuantity < 0) {
      redirect("/inventory?notice=inventory-negative-stock");
    }

    const movementClinicId = resolveInventoryClinicId(session, item.clinicId);
    if (!movementClinicId) {
      redirect("/inventory?notice=inventory-missing");
    }

    await prisma.$transaction(async (tx) => {
      await tx.inventoryMovement.create({
        data: {
          organizationId: session.organizationId,
          clinicId: movementClinicId,
          itemId: item.id,
          performedById: databaseActorId(session.userId),
          type,
          quantity,
          unitCost,
          referenceType: optionalString(formData.get("referenceType")),
          referenceId: optionalString(formData.get("referenceId")),
          note: optionalString(formData.get("note")),
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
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/inventory?notice=inventory-database");
  }

  revalidateInventoryViews();
  redirect("/inventory?notice=inventory-movement-recorded");
}

export async function createPurchaseOrderAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const supplierId = requiredString(formData.get("supplierId"));
  const itemId = requiredString(formData.get("itemId"));
  const quantity = parseMoney(formData.get("quantity"));
  const unitCost = parseMoney(formData.get("unitCost"));
  const clinicId = normalizeClinicId(formData.get("clinicId"), session);
  const expectedAt = parseDateInVietnam(formData.get("expectedAt"));

  if (
    !supplierId ||
    !itemId ||
    !quantity ||
    quantity <= 0 ||
    unitCost === null ||
    unitCost < 0 ||
    clinicId === "denied" ||
    expectedAt === "invalid"
  ) {
    redirect("/inventory?notice=inventory-po-missing");
  }

  try {
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
      redirect("/inventory?notice=inventory-item-not-found");
    }

    const scopedClinicId =
      clinicId === "all" ? item.clinicId ?? session.activeClinicId : clinicId;
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
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/inventory?notice=inventory-database");
  }

  revalidateInventoryViews();
  redirect("/inventory?notice=inventory-po-created");
}

export async function receivePurchaseOrderAction(formData: FormData) {
  const session = await requireViewSession("inventory");

  if (!canMutateInventory(session)) {
    redirect("/inventory?notice=inventory-denied");
  }

  const purchaseOrderId = requiredString(formData.get("purchaseOrderId"));
  const requestedReceiveQuantity = parseMoney(formData.get("receiveQuantity"));
  const lotNo = optionalString(formData.get("lotNo"));
  const expiresAt = parseDateInVietnam(formData.get("expiresAt"));

  if (
    !purchaseOrderId ||
    expiresAt === "invalid" ||
    (requestedReceiveQuantity !== null && requestedReceiveQuantity <= 0)
  ) {
    redirect("/inventory?notice=inventory-po-missing");
  }

  try {
    const order = await prisma.purchaseOrder.findFirst({
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
      redirect("/inventory?notice=inventory-po-missing");
    }

    await prisma.$transaction(async (tx) => {
      let remainingAfterReceive = 0;

      for (const line of order.lines) {
        const remainingLineQuantity =
          Number(line.quantity) - Number(line.receivedQuantity);
        const quantityToReceive =
          requestedReceiveQuantity === null
            ? remainingLineQuantity
            : Math.min(requestedReceiveQuantity, remainingLineQuantity);

        if (quantityToReceive <= 0) {
          remainingAfterReceive += Math.max(remainingLineQuantity, 0);
          continue;
        }

        const receivingClinicId = resolveInventoryClinicId(session, order.clinicId, line.item.clinicId);
        if (!receivingClinicId) {
          redirect("/inventory?notice=inventory-po-missing");
        }

        const lotRecord =
          lotNo || line.item.lotTracked
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
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/inventory?notice=inventory-database");
  }

  revalidateInventoryViews();
  redirect("/inventory?notice=inventory-po-received");
}

function signedMovementQuantity(type: (typeof movementTypes)[number], quantity: number) {
  if (type === "PURCHASE" || type === "TRANSFER_IN" || type === "RETURN") {
    return quantity;
  }

  if (type === "ADJUSTMENT") {
    return 0;
  }

  return -quantity;
}

function normalizeMovementType(value: FormDataEntryValue | null) {
  const parsed = requiredString(value);

  return movementTypes.find((type) => type === parsed) ?? null;
}

function normalizeAssetStatus(value: FormDataEntryValue | null) {
  const parsed = requiredString(value);

  return assetStatuses.find((status) => status === parsed) ?? null;
}

function parseOptionalDate(value: FormDataEntryValue | null) {
  if (!requiredString(value)) {
    return null;
  }

  return parseDateInVietnam(value);
}

function normalizeClinicId(value: FormDataEntryValue | null, session: AppSession) {
  const parsed = requiredString(value);

  if (!parsed || parsed === "all") {
    return canUseAllClinics(session) ? "all" : session.activeClinicId ?? "denied";
  }

  return session.clinicIds.includes(parsed) ? parsed : "denied";
}

function resolveInventoryClinicId(session: AppSession, ...clinicIds: Array<string | null | undefined>) {
  return clinicIds.find((clinicId): clinicId is string => Boolean(clinicId))
    ?? session.activeClinicId
    ?? session.clinicIds[0]
    ?? null;
}

function normalizedCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function normalizeTagIds(formData: FormData) {
  return Array.from(
    new Set(formData.getAll("tagIds").map((value) => requiredString(value)).filter(Boolean)),
  );
}

function resolveScopedItemGroup(session: AppSession, groupId: string | null) {
  if (!groupId) {
    return null;
  }

  return prisma.inventoryItemGroup.findFirst({
    where: {
      id: groupId,
      organizationId: session.organizationId,
      active: true,
    },
    select: {
      id: true,
      name: true,
    },
  });
}

function resolveScopedTags(session: AppSession, tagIds: string[]) {
  if (tagIds.length === 0) {
    return Promise.resolve([]);
  }

  return prisma.inventoryTag.findMany({
    where: {
      id: {
        in: tagIds,
      },
      organizationId: session.organizationId,
      active: true,
    },
    select: {
      id: true,
    },
  });
}

async function syncInventoryItemTags(session: AppSession, itemId: string, tagIds: string[]) {
  await prisma.$transaction([
    prisma.inventoryItemTag.deleteMany({
      where: {
        organizationId: session.organizationId,
        itemId,
        tagId: {
          notIn: tagIds,
        },
      },
    }),
    ...tagIds.map((tagId) =>
      prisma.inventoryItemTag.upsert({
        where: {
          itemId_tagId: {
            itemId,
            tagId,
          },
        },
        update: {},
        create: {
          organizationId: session.organizationId,
          itemId,
          tagId,
        },
      }),
    ),
  ]);
}

function findScopedSupplier(session: AppSession, supplierId: string) {
  return prisma.inventorySupplier.findFirst({
    where: {
      id: supplierId,
      organizationId: session.organizationId,
      active: true,
    },
    select: {
      id: true,
    },
  });
}

async function resolveScopedSupplier(
  session: AppSession,
  supplierId: string | null,
  supplierName: string | null,
) {
  if (supplierId) {
    return findScopedSupplier(session, supplierId);
  }

  const parsed = parseSupplierInput(supplierName);

  if (!parsed) {
    return null;
  }

  const existing = await prisma.inventorySupplier.findFirst({
    where: {
      organizationId: session.organizationId,
      active: true,
      OR: [
        {
          code: parsed.code,
        },
        {
          name: parsed.name,
        },
      ],
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return existing;
  }

  const code = await uniqueSupplierCode(session.organizationId, parsed.code);

  return prisma.inventorySupplier.create({
    data: {
      organizationId: session.organizationId,
      code,
      name: parsed.name,
      active: true,
    },
    select: {
      id: true,
    },
  });
}

function parseSupplierInput(value: string | null) {
  const name = value?.trim();

  if (!name) {
    return null;
  }

  const code = supplierCodeBase(name);

  if (!name || !code) {
    return null;
  }

  return { code, name };
}

function supplierCodeBase(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);

  return normalized || "NCC";
}

async function uniqueSupplierCode(organizationId: string, codeBase: string) {
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const code = `${codeBase.slice(0, 18 - suffix.length)}${suffix}`;
    const existing = await prisma.inventorySupplier.findUnique({
      where: {
        organizationId_code: {
          organizationId,
          code,
        },
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return code;
    }
  }

  return `${codeBase.slice(0, 10)}-${Date.now().toString().slice(-6)}`;
}

async function uniqueInventoryItemCode(organizationId: string, codeBase: string) {
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const code = `${codeBase.slice(0, 32 - suffix.length)}${suffix}`;
    const existing = await prisma.inventoryItem.findUnique({
      where: {
        organizationId_code: {
          organizationId,
          code,
        },
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return code;
    }
  }

  return `${codeBase.slice(0, 24)}-${Date.now().toString().slice(-6)}`;
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function revalidateInventoryViews() {
  revalidatePath("/inventory");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
}

async function nextPurchaseOrderNo(organizationId: string) {
  const count = await prisma.purchaseOrder.count({
    where: {
      organizationId,
    },
  });

  return `PO-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}
