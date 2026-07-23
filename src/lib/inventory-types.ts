export type InventoryClinicOption = {
  id: string;
  name: string;
};

export type InventorySupplierSummary = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
};

export type InventoryItemGroupSummary = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
};

export type InventoryTagSummary = {
  id: string;
  code: string;
  name: string;
  color: string | null;
  sortOrder: number;
  active: boolean;
};

export type InventoryItemSummary = {
  id: string;
  clinicId: string | null;
  supplierId: string | null;
  groupId: string | null;
  groupName: string | null;
  code: string;
  sku: string | null;
  name: string;
  category: string;
  unit: string;
  minimumStock: number;
  onHandQuantity: number;
  averageUnitCost: number | null;
  lotTracked: boolean;
  active: boolean;
  tags: InventoryTagSummary[];
};

export type InventoryMovementSummary = {
  id: string;
  clinicId: string | null;
  itemId: string;
  itemName: string;
  performedByName: string | null;
  type: "PURCHASE" | "TRANSFER_IN" | "TRANSFER_OUT" | "CONSUMPTION" | "ADJUSTMENT" | "WASTE" | "RETURN";
  quantity: number;
  unitCost: number | null;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
};

export type InventoryLotSummary = {
  id: string;
  clinicId: string | null;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemUnit: string;
  lotNo: string;
  expiresAt: string | null;
  receivedAt: string;
  quantityOnHand: number;
};

export type PurchaseOrderSummary = {
  id: string;
  clinicId: string | null;
  clinicName: string | null;
  supplierId: string;
  supplierName: string;
  poNo: string;
  status: string;
  orderedAt: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  totalAmount: number;
  lines: Array<{
    id: string;
    itemId: string;
    itemCode: string;
    itemName: string;
    quantity: number;
    unitCost: number;
    receivedQuantity: number;
  }>;
};

export type EquipmentAssetSummary = {
  id: string;
  clinicId: string | null;
  code: string;
  name: string;
  category: string;
  serialNo: string | null;
  purchasedAt: string | null;
  purchasedAtIso: string | null;
  cost: number | null;
  warrantyEndsAt: string | null;
  warrantyEndsAtIso: string | null;
  status: "ACTIVE" | "MAINTENANCE" | "RETIRED" | "LOST";
  nextMaintenanceAt: string | null;
  openMaintenanceCount: number;
};

export type MaintenanceTaskSummary = {
  id: string;
  clinicId: string | null;
  assetId: string;
  assetName: string;
  title: string;
  dueAt: string;
  completedAt: string | null;
  cost: number | null;
  notes: string | null;
};

export type InventoryWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  clinics: InventoryClinicOption[];
  suppliers: InventorySupplierSummary[];
  itemGroups: InventoryItemGroupSummary[];
  tags: InventoryTagSummary[];
  items: InventoryItemSummary[];
  movements: InventoryMovementSummary[];
  lots: InventoryLotSummary[];
  purchaseOrders: PurchaseOrderSummary[];
  equipmentAssets: EquipmentAssetSummary[];
  maintenanceTasks: MaintenanceTaskSummary[];
};
