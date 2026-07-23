import "server-only";

import { defaultDataSeedEnabled } from "@/lib/env";
import { canUseAllClinics, hasAnyRole, type AppRole, type RoleSource } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type {
  EquipmentAssetSummary,
  InventoryItemGroupSummary,
  InventoryItemSummary,
  InventoryLotSummary,
  MaintenanceTaskSummary,
  InventoryMovementSummary,
  PurchaseOrderSummary,
  InventorySupplierSummary,
  InventoryTagSummary,
  InventoryWorkspace,
} from "@/lib/inventory-types";
import type { AppSession } from "@/lib/session";

const mutableInventoryRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "FRONT_DESK",
];

const defaultInventoryGroups = [
  { code: "CONSUMABLES", name: "Vật tư tiêu hao", sortOrder: 10 },
  { code: "EQUIPMENT", name: "Thiết bị", sortOrder: 20 },
  { code: "INSTRUMENTS", name: "Dụng cụ", sortOrder: 30 },
  { code: "MEDICATIONS", name: "Thuốc tê và thuốc", sortOrder: 40 },
] as const;

const defaultInventoryTags = [
  { code: "TONG_QUAT", name: "Tổng quát", color: "#15803d", sortOrder: 10 },
  { code: "NOI_NHA", name: "Nội nha", color: "#b45309", sortOrder: 20 },
  { code: "CHINH_NHA", name: "Chỉnh nha", color: "#4f46e5", sortOrder: 30 },
  { code: "PHAU_THUAT", name: "Phẫu thuật", color: "#be123c", sortOrder: 40 },
  { code: "IMPLANT", name: "Implant", color: "#a16207", sortOrder: 50 },
  { code: "PHUC_HINH", name: "Phục hình", color: "#9333ea", sortOrder: 60 },
  { code: "NHA_CHU", name: "Nha chu", color: "#0f766e", sortOrder: 70 },
  { code: "NHA_TRE_EM", name: "Nha trẻ em", color: "#2563eb", sortOrder: 80 },
] as const;

const defaultInventorySeedItems = [
  {
    code: "VT-BONG-CUON",
    name: "Bông cuộn nha khoa",
    category: "Vật tư tiêu hao",
    unit: "gói",
    minimumStock: 10,
    onHandQuantity: 30,
    averageUnitCost: 52000,
    lotTracked: false,
    groupCode: "CONSUMABLES",
    tagCodes: [],
  },
  {
    code: "VT-GAC-VT-5X5",
    name: "Gạc vô trùng 5x5",
    category: "Vật tư tiêu hao",
    unit: "hộp",
    minimumStock: 10,
    onHandQuantity: 24,
    averageUnitCost: 62000,
    lotTracked: true,
    groupCode: "CONSUMABLES",
    tagCodes: ["PHAU_THUAT"],
  },
  {
    code: "VT-COC-GIAY",
    name: "Cốc giấy nha khoa",
    category: "Vật tư tiêu hao",
    unit: "cây",
    minimumStock: 8,
    onHandQuantity: 18,
    averageUnitCost: 45000,
    lotTracked: false,
    groupCode: "CONSUMABLES",
    tagCodes: [],
  },
  {
    code: "VT-ONG-HUT-NB",
    name: "Ống hút nước bọt",
    category: "Vật tư tiêu hao",
    unit: "túi",
    minimumStock: 12,
    onHandQuantity: 32,
    averageUnitCost: 38000,
    lotTracked: false,
    groupCode: "CONSUMABLES",
    tagCodes: [],
  },
  {
    code: "VT-YEM-BENH-NHAN",
    name: "Yếm nha khoa chống thấm",
    category: "Vật tư tiêu hao",
    unit: "túi",
    minimumStock: 10,
    onHandQuantity: 28,
    averageUnitCost: 68000,
    lotTracked: false,
    groupCode: "CONSUMABLES",
    tagCodes: [],
  },
  {
    code: "TB-GHE-NHA-KHOA",
    name: "Ghế nha khoa",
    category: "Thiết bị",
    unit: "bộ",
    minimumStock: 0,
    onHandQuantity: 3,
    averageUnitCost: 180000000,
    lotTracked: false,
    groupCode: "EQUIPMENT",
    tagCodes: [],
  },
  {
    code: "TB-MAY-HUT",
    name: "Máy hút trung tâm",
    category: "Thiết bị",
    unit: "máy",
    minimumStock: 0,
    onHandQuantity: 1,
    averageUnitCost: 92000000,
    lotTracked: false,
    groupCode: "EQUIPMENT",
    tagCodes: [],
  },
  {
    code: "TB-MAY-HAP-23L",
    name: "Nồi hấp tiệt trùng 23L",
    category: "Thiết bị",
    unit: "máy",
    minimumStock: 0,
    onHandQuantity: 1,
    averageUnitCost: 125000000,
    lotTracked: false,
    groupCode: "EQUIPMENT",
    tagCodes: [],
  },
  {
    code: "TB-MOTOR-NOI-NHA",
    name: "Máy motor nội nha",
    category: "Thiết bị",
    unit: "máy",
    minimumStock: 0,
    onHandQuantity: 2,
    averageUnitCost: 32000000,
    lotTracked: false,
    groupCode: "EQUIPMENT",
    tagCodes: ["NOI_NHA"],
  },
  {
    code: "DC-CAN-DAO",
    name: "Cán dao phẫu thuật",
    category: "Dụng cụ",
    unit: "cái",
    minimumStock: 3,
    onHandQuantity: 8,
    averageUnitCost: 120000,
    lotTracked: false,
    groupCode: "INSTRUMENTS",
    tagCodes: ["PHAU_THUAT"],
  },
  {
    code: "DC-CAY-BOC-TACH",
    name: "Cây bóc tách",
    category: "Dụng cụ",
    unit: "cây",
    minimumStock: 3,
    onHandQuantity: 6,
    averageUnitCost: 380000,
    lotTracked: false,
    groupCode: "INSTRUMENTS",
    tagCodes: ["PHAU_THUAT"],
  },
  {
    code: "DC-GUONG-KHAM",
    name: "Gương khám nha khoa",
    category: "Dụng cụ",
    unit: "cây",
    minimumStock: 10,
    onHandQuantity: 24,
    averageUnitCost: 65000,
    lotTracked: false,
    groupCode: "INSTRUMENTS",
    tagCodes: ["TONG_QUAT"],
  },
  {
    code: "DC-THAM-TRAM",
    name: "Thám trâm nha khoa",
    category: "Dụng cụ",
    unit: "cây",
    minimumStock: 8,
    onHandQuantity: 18,
    averageUnitCost: 85000,
    lotTracked: false,
    groupCode: "INSTRUMENTS",
    tagCodes: ["TONG_QUAT"],
  },
  {
    code: "TH-LIDO-2-EPI",
    name: "Lidocaine 2% có Epinephrine",
    category: "Thuốc tê và thuốc",
    unit: "ống",
    minimumStock: 50,
    onHandQuantity: 150,
    averageUnitCost: 8500,
    lotTracked: true,
    groupCode: "MEDICATIONS",
    tagCodes: [],
  },
  {
    code: "TH-ARTICAINE",
    name: "Articaine 4% có Epinephrine",
    category: "Thuốc tê và thuốc",
    unit: "ống",
    minimumStock: 30,
    onHandQuantity: 90,
    averageUnitCost: 14500,
    lotTracked: true,
    groupCode: "MEDICATIONS",
    tagCodes: [],
  },
  {
    code: "TH-PARACETAMOL",
    name: "Paracetamol 500mg",
    category: "Thuốc tê và thuốc",
    unit: "vỉ",
    minimumStock: 10,
    onHandQuantity: 40,
    averageUnitCost: 18000,
    lotTracked: true,
    groupCode: "MEDICATIONS",
    tagCodes: [],
  },
  {
    code: "TH-AMOXICILLIN",
    name: "Amoxicillin 500mg",
    category: "Thuốc tê và thuốc",
    unit: "vỉ",
    minimumStock: 10,
    onHandQuantity: 25,
    averageUnitCost: 42000,
    lotTracked: true,
    groupCode: "MEDICATIONS",
    tagCodes: [],
  },
] as const;

export async function getInventoryWorkspace(
  session: AppSession,
): Promise<InventoryWorkspace> {
  try {
    if (defaultDataSeedEnabled()) {
      await ensureInventorySeed(session);
    }

    await ensureInventoryTaxonomySeed(session);

    const clinicIds = allowedClinicIds(session);

    const [
      clinics,
      suppliers,
      itemGroups,
      tags,
      items,
      movements,
      lots,
      purchaseOrders,
      equipmentAssets,
      maintenanceTasks,
    ] = await Promise.all([
      prisma.clinic.findMany({
        where: {
          organizationId: session.organizationId,
          id: {
            in: clinicIds,
          },
        },
        select: {
          id: true,
          name: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.inventorySupplier.findMany({
        where: {
          organizationId: session.organizationId,
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.inventoryItemGroup.findMany({
        where: {
          organizationId: session.organizationId,
        },
        orderBy: [
          {
            sortOrder: "asc",
          },
          {
            name: "asc",
          },
        ],
      }),
      prisma.inventoryTag.findMany({
        where: {
          organizationId: session.organizationId,
        },
        orderBy: [
          {
            sortOrder: "asc",
          },
          {
            name: "asc",
          },
        ],
      }),
      prisma.inventoryItem.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        include: {
          group: {
            select: {
              name: true,
            },
          },
          tagLinks: {
            include: {
              tag: true,
            },
            orderBy: {
              tag: {
                sortOrder: "asc",
              },
            },
          },
        },
        orderBy: {
          code: "asc",
        },
      }),
      prisma.inventoryMovement.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        include: {
          item: {
            select: {
              name: true,
            },
          },
          performedBy: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 100,
      }),
      prisma.inventoryLot.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        include: {
          item: {
            select: {
              code: true,
              name: true,
              unit: true,
            },
          },
        },
        orderBy: [
          {
            expiresAt: "asc",
          },
          {
            receivedAt: "desc",
          },
        ],
        take: 100,
      }),
      prisma.purchaseOrder.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        include: {
          clinic: {
            select: {
              name: true,
            },
          },
          supplier: {
            select: {
              name: true,
            },
          },
          lines: {
            include: {
              item: {
                select: {
                  code: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 80,
      }),
      prisma.equipmentAsset.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        include: {
          maintenanceTasks: {
            where: {
              completedAt: null,
            },
            orderBy: {
              dueAt: "asc",
            },
            take: 3,
          },
        },
        orderBy: [
          {
            status: "asc",
          },
          {
            code: "asc",
          },
        ],
        take: 80,
      }),
      prisma.maintenanceTask.findMany({
        where: {
          organizationId: session.organizationId,
          completedAt: null,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        include: {
          asset: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          dueAt: "asc",
        },
        take: 80,
      }),
    ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableInventoryRoles),
      message: null,
      clinics,
      suppliers: suppliers.map(toSupplierSummary),
      itemGroups: itemGroups.map(toItemGroupSummary),
      tags: tags.map(toTagSummary),
      items: items.map(toItemSummary),
      movements: movements.map(toMovementSummary),
      lots: lots.map(toLotSummary),
      purchaseOrders: purchaseOrders.map(toPurchaseOrderSummary),
      equipmentAssets: equipmentAssets.map(toEquipmentAssetSummary),
      maintenanceTasks: maintenanceTasks.map(toMaintenanceTaskSummary),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "inventory");
    return {
      source: "demo",
      canMutate: false,
      message:
        "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
      clinics: [],
      suppliers: [],
      itemGroups: [],
      tags: [],
      items: [],
      movements: [],
      lots: [],
      purchaseOrders: [],
      equipmentAssets: [],
      maintenanceTasks: [],
    };
  }
}

export function canMutateInventory(source: RoleSource) {
  return hasAnyRole(source, mutableInventoryRoles);
}

export async function ensureInventoryTaxonomySeed(session: AppSession) {
  await Promise.all([
    Promise.all(
      defaultInventoryGroups.map((group) =>
        prisma.inventoryItemGroup.upsert({
          where: {
            organizationId_code: {
              organizationId: session.organizationId,
              code: group.code,
            },
          },
          update: {},
          create: {
            organizationId: session.organizationId,
            ...group,
            active: true,
          },
        }),
      ),
    ),
    Promise.all(
      defaultInventoryTags.map((tag) =>
        prisma.inventoryTag.upsert({
          where: {
            organizationId_code: {
              organizationId: session.organizationId,
              code: tag.code,
            },
          },
          update: {},
          create: {
            organizationId: session.organizationId,
            ...tag,
            active: true,
          },
        }),
      ),
    ),
  ]);
}

export async function ensureInventorySeed(session: AppSession) {
  await ensureInventoryTaxonomySeed(session);

  const clinicId = session.activeClinicId ?? session.clinicIds[0] ?? null;
  const [itemGroups, inventoryTags] = await Promise.all([
    prisma.inventoryItemGroup.findMany({
      where: {
        organizationId: session.organizationId,
      },
      select: {
        id: true,
        code: true,
      },
    }),
    prisma.inventoryTag.findMany({
      where: {
        organizationId: session.organizationId,
      },
      select: {
        id: true,
        code: true,
      },
    }),
  ]);
  const itemGroupByCode = new Map(itemGroups.map((group) => [group.code, group.id]));
  const tagByCode = new Map(inventoryTags.map((tag) => [tag.code, tag.id]));
  for (const item of defaultInventorySeedItems) {
    const { groupCode, tagCodes, ...itemData } = item;
    const groupId = itemGroupByCode.get(groupCode) ?? null;
    const createdItem = await prisma.inventoryItem.upsert({
      where: {
        organizationId_code: {
          organizationId: session.organizationId,
          code: item.code,
        },
      },
      update: {
        groupId,
      },
      create: {
        organizationId: session.organizationId,
        clinicId,
        supplierId: null,
        groupId,
        ...itemData,
        active: true,
      },
      select: {
        id: true,
        code: true,
      },
    });

    for (const tagCode of tagCodes) {
      const tagId = tagByCode.get(tagCode);

      if (tagId) {
        await prisma.inventoryItemTag.upsert({
          where: {
            itemId_tagId: {
              itemId: createdItem.id,
              tagId,
            },
          },
          update: {},
          create: {
            organizationId: session.organizationId,
            itemId: createdItem.id,
            tagId,
          },
        });
      }
    }

    if (item.lotTracked) {
      await prisma.inventoryLot.upsert({
        where: {
          itemId_lotNo: {
            itemId: createdItem.id,
            lotNo: `LOT-${createdItem.code}-01`,
          },
        },
        update: {},
        create: {
          organizationId: session.organizationId,
          clinicId,
          itemId: createdItem.id,
          lotNo: `LOT-${createdItem.code}-01`,
          expiresAt: dateMonthsFromNow(18),
          quantityOnHand: itemData.onHandQuantity,
        },
      });
    }
  }
}


function toItemGroupSummary(group: {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
}): InventoryItemGroupSummary {
  return group;
}

function toTagSummary(tag: {
  id: string;
  code: string;
  name: string;
  color: string | null;
  sortOrder: number;
  active: boolean;
}): InventoryTagSummary {
  return tag;
}

function toSupplierSummary(supplier: {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
}): InventorySupplierSummary {
  return supplier;
}

function toItemSummary(item: {
  id: string;
  clinicId: string | null;
  supplierId: string | null;
  groupId: string | null;
  code: string;
  sku: string | null;
  name: string;
  category: string;
  unit: string;
  minimumStock: unknown;
  onHandQuantity: unknown;
  averageUnitCost: unknown;
  lotTracked: boolean;
  active: boolean;
  group: {
    name: string;
  } | null;
  tagLinks: Array<{
    tag: {
      id: string;
      code: string;
      name: string;
      color: string | null;
      sortOrder: number;
      active: boolean;
    };
  }>;
}): InventoryItemSummary {
  const { group, tagLinks, ...summary } = item;

  return {
    ...summary,
    groupName: group?.name ?? null,
    minimumStock: Number(item.minimumStock),
    onHandQuantity: Number(item.onHandQuantity),
    averageUnitCost: item.averageUnitCost == null ? null : Number(item.averageUnitCost),
    tags: tagLinks.map((link) => toTagSummary(link.tag)),
  };
}

function toMovementSummary(movement: {
  id: string;
  clinicId: string | null;
  itemId: string;
  type: string;
  quantity: unknown;
  unitCost: unknown;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: Date;
  item: {
    name: string;
  };
  performedBy: {
    fullName: string;
  } | null;
}): InventoryMovementSummary {
  return {
    id: movement.id,
    clinicId: movement.clinicId,
    itemId: movement.itemId,
    itemName: movement.item.name,
    performedByName: movement.performedBy?.fullName ?? null,
    type: movement.type as InventoryMovementSummary["type"],
    quantity: Number(movement.quantity),
    unitCost: movement.unitCost == null ? null : Number(movement.unitCost),
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    note: movement.note,
    createdAt: vietnamDateTime(movement.createdAt),
  };
}

function toLotSummary(lot: {
  id: string;
  clinicId: string | null;
  itemId: string;
  lotNo: string;
  expiresAt: Date | null;
  receivedAt: Date;
  quantityOnHand: unknown;
  item: {
    code: string;
    name: string;
    unit: string;
  };
}): InventoryLotSummary {
  return {
    id: lot.id,
    clinicId: lot.clinicId,
    itemId: lot.itemId,
    itemCode: lot.item.code,
    itemName: lot.item.name,
    itemUnit: lot.item.unit,
    lotNo: lot.lotNo,
    expiresAt: lot.expiresAt ? vietnamDate(lot.expiresAt) : null,
    receivedAt: vietnamDate(lot.receivedAt),
    quantityOnHand: Number(lot.quantityOnHand),
  };
}

function toPurchaseOrderSummary(order: {
  id: string;
  clinicId: string | null;
  poNo: string;
  status: string;
  orderedAt: Date | null;
  expectedAt: Date | null;
  receivedAt: Date | null;
  totalAmount: unknown;
  supplierId: string;
  supplier: {
    name: string;
  };
  clinic: {
    name: string;
  } | null;
  lines: Array<{
    id: string;
    itemId: string;
    quantity: unknown;
    unitCost: unknown;
    receivedQuantity: unknown;
    item: {
      code: string;
      name: string;
    };
  }>;
}): PurchaseOrderSummary {
  return {
    id: order.id,
    clinicId: order.clinicId,
    clinicName: order.clinic?.name ?? null,
    supplierId: order.supplierId,
    supplierName: order.supplier.name,
    poNo: order.poNo,
    status: order.status,
    orderedAt: order.orderedAt ? vietnamDate(order.orderedAt) : null,
    expectedAt: order.expectedAt ? vietnamDate(order.expectedAt) : null,
    receivedAt: order.receivedAt ? vietnamDate(order.receivedAt) : null,
    totalAmount: Number(order.totalAmount),
    lines: order.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      itemCode: line.item.code,
      itemName: line.item.name,
      quantity: Number(line.quantity),
      unitCost: Number(line.unitCost),
      receivedQuantity: Number(line.receivedQuantity),
    })),
  };
}

function toEquipmentAssetSummary(asset: {
  id: string;
  clinicId: string | null;
  code: string;
  name: string;
  category: string;
  serialNo: string | null;
  purchasedAt: Date | null;
  cost: unknown;
  warrantyEndsAt: Date | null;
  status: string;
  maintenanceTasks: Array<{
    dueAt: Date;
  }>;
}): EquipmentAssetSummary {
  return {
    id: asset.id,
    clinicId: asset.clinicId,
    code: asset.code,
    name: asset.name,
    category: asset.category,
    serialNo: asset.serialNo,
    purchasedAt: asset.purchasedAt ? vietnamDate(asset.purchasedAt) : null,
    purchasedAtIso: asset.purchasedAt ? dateInputValue(asset.purchasedAt) : null,
    cost: asset.cost == null ? null : Number(asset.cost),
    warrantyEndsAt: asset.warrantyEndsAt ? vietnamDate(asset.warrantyEndsAt) : null,
    warrantyEndsAtIso: asset.warrantyEndsAt ? dateInputValue(asset.warrantyEndsAt) : null,
    status: normalizeAssetStatus(asset.status),
    nextMaintenanceAt: asset.maintenanceTasks[0]?.dueAt
      ? vietnamDate(asset.maintenanceTasks[0].dueAt)
      : null,
    openMaintenanceCount: asset.maintenanceTasks.length,
  };
}

function toMaintenanceTaskSummary(task: {
  id: string;
  clinicId: string | null;
  assetId: string;
  title: string;
  dueAt: Date;
  completedAt: Date | null;
  cost: unknown;
  notes: string | null;
  asset: {
    name: string;
  };
}): MaintenanceTaskSummary {
  return {
    id: task.id,
    clinicId: task.clinicId,
    assetId: task.assetId,
    assetName: task.asset.name,
    title: task.title,
    dueAt: vietnamDate(task.dueAt),
    completedAt: task.completedAt ? vietnamDate(task.completedAt) : null,
    cost: task.cost == null ? null : Number(task.cost),
    notes: task.notes,
  };
}

function normalizeAssetStatus(status: string): EquipmentAssetSummary["status"] {
  if (status === "MAINTENANCE" || status === "RETIRED" || status === "LOST") {
    return status;
  }

  return "ACTIVE";
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function vietnamDateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function vietnamDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function dateMonthsFromNow(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);

  return date;
}

function dateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}
