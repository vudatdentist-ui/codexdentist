"use client";

import { Activity, Building2, CalendarDays, CheckCircle2, ClipboardList, Inbox, Settings, Tag, WalletCards, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  createInventoryItemAction,
  createInventoryItemGroupAction,
  createInventorySupplierAction,
  createInventoryTagAction,
  createPurchaseOrderAction,
  deactivateInventoryItemGroupAction,
  deactivateInventorySupplierAction,
  deactivateInventoryTagAction,
  receivePurchaseOrderAction,
  recordInventoryMovementAction,
  updateEquipmentAssetAction,
  updateInventoryItemAction,
} from "@/app/(app)/inventory/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { MoneyInput } from "@/components/MoneyInput";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, MetricCard, PanelHeader, RecordTile, StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import { formatVnd, type Clinic } from "@/lib/data";
import type { InventoryWorkspace } from "@/lib/inventory-types";

const uiText: Record<Language, { allClinics: string }> = {
  vi: { allClinics: "T\u1ea5t c\u1ea3 chi nh\u00e1nh" },
  en: { allClinics: "All clinics" },
};

function workspaceMessageText(message: string | null | undefined, language: Language) {
  if (!message || language !== "vi") return message;

  const viMessages: Record<string, string> = {
    "Chưa tải được dữ liệu. Vui lòng thử lại sau.":
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
  };

  return viMessages[message] ?? message;
}

function noticeText(notice: string | null, language: Language) {
  const notices: Record<string, Record<Language, string>> = {
    "inventory-supplier-saved": { vi: "\u0110\u00e3 l\u01b0u nh\u00e0 cung c\u1ea5p.", en: "Supplier saved." },
    "inventory-item-saved": { vi: "\u0110\u00e3 l\u01b0u v\u1eadt t\u01b0.", en: "Inventory item saved." },
    "inventory-movement-recorded": { vi: "\u0110\u00e3 ghi nh\u1eadn bi\u1ebfn \u0111\u1ed9ng kho.", en: "Inventory movement recorded." },
    "inventory-po-created": { vi: "\u0110\u00e3 t\u1ea1o \u0111\u01a1n mua h\u00e0ng.", en: "Purchase order created." },
    "inventory-po-received": { vi: "\u0110\u00e3 nh\u1eadn h\u00e0ng v\u00e0o kho.", en: "Purchase order received into stock." },
    "inventory-equipment-updated": { vi: "\u0110\u00e3 c\u1eadp nh\u1eadt t\u00e0i s\u1ea3n.", en: "Equipment updated." },
    "inventory-group-saved": { vi: "\u0110\u00e3 l\u01b0u nh\u00f3m kho.", en: "Inventory group saved." },
    "inventory-group-disabled": { vi: "\u0110\u00e3 ng\u1eebng d\u00f9ng nh\u00f3m kho.", en: "Inventory group disabled." },
    "inventory-tag-saved": { vi: "\u0110\u00e3 l\u01b0u tag kho.", en: "Inventory tag saved." },
    "inventory-tag-disabled": { vi: "\u0110\u00e3 ng\u1eebng d\u00f9ng tag kho.", en: "Inventory tag disabled." },
    "inventory-supplier-disabled": { vi: "\u0110\u00e3 ng\u1eebng d\u00f9ng nh\u00e0 cung c\u1ea5p.", en: "Supplier disabled." },
    "inventory-denied": { vi: "T\u00e0i kho\u1ea3n n\u00e0y kh\u00f4ng th\u1ec3 thay \u0111\u1ed5i kho.", en: "This role cannot change inventory." },
    "inventory-missing": { vi: "\u0110i\u1ec1n \u0111\u1ee7 tr\u01b0\u1eddng kho b\u1eaft bu\u1ed9c.", en: "Complete the required inventory fields." },
    "inventory-po-missing": { vi: "Ch\u1ecdn nh\u00e0 cung c\u1ea5p, v\u1eadt t\u01b0, s\u1ed1 l\u01b0\u1ee3ng, gi\u00e1 v\u00e0 ng\u00e0y d\u1ef1 ki\u1ebfn.", en: "Select supplier, item, quantity, cost, and expected date." },
    "inventory-item-not-found": { vi: "Kh\u00f4ng t\u00ecm th\u1ea5y v\u1eadt t\u01b0.", en: "The inventory item could not be found." },
    "inventory-negative-stock": { vi: "Bi\u1ebfn \u0111\u1ed9ng kho kh\u00f4ng \u0111\u01b0\u1ee3c l\u00e0m t\u1ed3n kho \u00e2m.", en: "Stock movement cannot reduce on-hand quantity below zero." },
    "inventory-database": { vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.", en: "The change could not be saved. Please try again." },
  };

  return notice ? notices[notice]?.[language] ?? null : null;
}

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();
  return noticeText(notice, language);
}

function displayStatus(status: string, language: Language) {
  const viStatus: Record<string, string> = {
    PURCHASE: "Nh\u1eadp mua",
    TRANSFER_IN: "Chuy\u1ec3n v\u00e0o",
    TRANSFER_OUT: "Chuy\u1ec3n ra",
    CONSUMPTION: "Ti\u00eau hao",
    ADJUSTMENT: "\u0110i\u1ec1u ch\u1ec9nh",
    WASTE: "H\u1ee7y hao",
    RETURN: "Tr\u1ea3 h\u00e0ng",
    DRAFT: "Nh\u00e1p",
    ORDERED: "\u0110\u00e3 \u0111\u1eb7t",
    PARTIAL: "M\u1ed9t ph\u1ea7n",
    RECEIVED: "\u0110\u00e3 nh\u1eadn",
    CANCELLED: "\u0110\u00e3 h\u1ee7y",
    ACTIVE: "\u0110ang ho\u1ea1t \u0111\u1ed9ng",
    MAINTENANCE: "\u0110ang b\u1ea3o tr\u00ec",
    RETIRED: "Ng\u1eebng s\u1eed d\u1ee5ng",
    LOST: "Th\u1ea5t l\u1ea1c",
  };

  return language === "vi" ? viStatus[status] ?? status : status;
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();
  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}

function supplierOptionLabel(supplier: { code: string; name: string }) {
  return supplier.name;
}

type InventorySectionKey = "stock" | "operations" | "procurement" | "equipment" | "settings";
type InventoryItemRecord = NonNullable<InventoryWorkspace>["items"][number];
const inventoryExpandedBlocksStorageKey = "codexdentist.inventory.expandedBlocks";

function readStoredInventoryBlocks() {
  if (typeof window === "undefined") {
    return new Set<string>();
  }

  try {
    const raw = window.localStorage.getItem(inventoryExpandedBlocksStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is string => typeof value === "string"))
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function storeInventoryBlocks(blocks: Set<string>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      inventoryExpandedBlocksStorageKey,
      JSON.stringify(Array.from(blocks)),
    );
  } catch {
    // Ignore storage failures; collapse state is a convenience only.
  }
}

function inventorySectionFromParam(value: string | null): InventorySectionKey {
  return value === "operations" || value === "procurement" || value === "equipment" || value === "settings"
    ? value
    : "stock";
}

function normalizedInventoryCategory(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function inventoryGroupForCategory(category: string, language: Language) {
  const normalized = normalizedInventoryCategory(category);
  const vi = language === "vi";

  if (normalized.includes("noi nha")) return vi ? "Nội nha" : "Endodontics";
  if (normalized.includes("phau thuat") || normalized.includes("implant")) {
    return vi ? "Phẫu thuật & Implant" : "Surgery & implant";
  }
  if (
    normalized.includes("chinh nha") ||
    normalized.includes("phuc hinh") ||
    normalized.includes("lay dau")
  ) {
    return vi ? "Chỉnh nha & phục hình" : "Ortho & prosthetics";
  }
  if (normalized.includes("thuoc") || normalized.includes("gay te")) {
    return vi ? "Thuốc & gây tê" : "Medication & anesthesia";
  }
  if (normalized.includes("vo trung") || normalized.includes("kiem soat nhiem khuan")) {
    return vi ? "Vô trùng & kiểm soát nhiễm khuẩn" : "Sterilization & infection control";
  }
  if (normalized.includes("bao tri") || normalized.includes("ky thuat so")) {
    return vi ? "Thiết bị & công cụ" : "Equipment & tools";
  }
  if (normalized.includes("vat lieu") || normalized.includes("du phong") || normalized.includes("nha chu")) {
    return vi ? "Vật liệu điều trị" : "Treatment materials";
  }

  return vi ? "Vật tư tiêu hao" : "Consumables";
}

function inventoryGroupSortValue(group: string, language: Language, configuredOrder: Map<string, number>) {
  const configured = configuredOrder.get(group);

  if (configured != null) {
    return configured;
  }

  const order =
    language === "vi"
      ? [
          "Vật tư tiêu hao",
          "Vật liệu điều trị",
          "Nội nha",
          "Phẫu thuật & Implant",
          "Chỉnh nha & phục hình",
          "Thuốc & gây tê",
          "Vô trùng & kiểm soát nhiễm khuẩn",
          "Thiết bị & công cụ",
        ]
      : [
          "Consumables",
          "Treatment materials",
          "Endodontics",
          "Surgery & implant",
          "Ortho & prosthetics",
          "Medication & anesthesia",
          "Sterilization & infection control",
          "Equipment & tools",
        ];

  const index = order.indexOf(group);
  return index >= 0 ? index : order.length;
}

function InventorySupplierPicker({
  defaultSupplierId = "",
  disabled,
  label,
  placeholder,
  suppliers,
}: {
  defaultSupplierId?: string | null;
  disabled: boolean;
  label: string;
  placeholder: string;
  suppliers: Array<{ id: string; code: string; name: string }>;
}) {
  const defaultSupplier = suppliers.find((supplier) => supplier.id === defaultSupplierId);
  const [typedValue, setTypedValue] = useState(defaultSupplier ? supplierOptionLabel(defaultSupplier) : "");
  const [selectedSupplierId, setSelectedSupplierId] = useState(defaultSupplier?.id ?? "");

  const matchSupplier = (value: string) => {
    const normalizedValue = value.trim().toLowerCase();
    const supplier = suppliers.find(
      (option) =>
        supplierOptionLabel(option).toLowerCase() === normalizedValue ||
        option.name.toLowerCase() === normalizedValue ||
        option.code.toLowerCase() === normalizedValue,
    );

    setSelectedSupplierId(supplier?.id ?? "");
  };

  return (
    <label>
      {label}
      <input name="supplierId" type="hidden" value={selectedSupplierId} readOnly />
      <input name="supplierName" type="hidden" value={typedValue.trim()} readOnly />
      <input
        autoComplete="off"
        disabled={disabled}
        list="inventory-supplier-options"
        onBlur={(event) => matchSupplier(event.target.value)}
        onChange={(event) => {
          setTypedValue(event.target.value);
          matchSupplier(event.target.value);
        }}
        placeholder={placeholder}
        value={typedValue}
      />
    </label>
  );
}

export function InventoryPanel({
  inventoryWorkspace,
  visibleClinics,
}: {
  inventoryWorkspace?: InventoryWorkspace | null;
  visibleClinics: Clinic[];
}) {
  const { language } = useAppLanguage();
  const searchParams = useSearchParams();
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const canMutate = inventoryWorkspace?.canMutate ?? false;
  const visibleClinicIds = useMemo(
    () => new Set(visibleClinics.map((clinic) => clinic.id)),
    [visibleClinics],
  );
  const clinics = (inventoryWorkspace?.clinics ?? []).filter((clinic) =>
    visibleClinicIds.has(clinic.id),
  );
  const suppliers = (inventoryWorkspace?.suppliers ?? []).filter((supplier) => supplier.active);
  const itemGroups = (inventoryWorkspace?.itemGroups ?? []).filter((group) => group.active);
  const inventoryTags = (inventoryWorkspace?.tags ?? []).filter((tag) => tag.active);
  const matchesInventoryScope = (clinicId: string | null) =>
    !clinicId || visibleClinicIds.has(clinicId);
  const items = (inventoryWorkspace?.items ?? []).filter((item) =>
    item.active && matchesInventoryScope(item.clinicId),
  );
  const movements = (inventoryWorkspace?.movements ?? []).filter((movement) =>
    matchesInventoryScope(movement.clinicId),
  );
  const lots = (inventoryWorkspace?.lots ?? []).filter((lot) =>
    matchesInventoryScope(lot.clinicId),
  );
  const purchaseOrders = (inventoryWorkspace?.purchaseOrders ?? []).filter((order) =>
    matchesInventoryScope(order.clinicId),
  );
  const equipmentAssets = (inventoryWorkspace?.equipmentAssets ?? []).filter((asset) =>
    asset.status !== "RETIRED" && asset.status !== "LOST" && matchesInventoryScope(asset.clinicId),
  );
  const maintenanceTasks = (inventoryWorkspace?.maintenanceTasks ?? []).filter((task) =>
    matchesInventoryScope(task.clinicId),
  );
  const [inventoryModal, setInventoryModal] = useState<
    | "item"
    | "supplier"
    | "movement"
    | "purchaseOrder"
    | "receive"
    | "editItem"
    | "editEquipment"
    | "itemGroup"
    | "tag"
    | null
  >(null);
  const [inventorySection, setInventorySection] = useState<InventorySectionKey>(() =>
    inventorySectionFromParam(searchParams.get("section")),
  );

  useEffect(() => {
    setInventorySection(inventorySectionFromParam(searchParams.get("section")));
  }, [searchParams]);
  const [editingInventoryItemId, setEditingInventoryItemId] = useState("");
  const [editingEquipmentAssetId, setEditingEquipmentAssetId] = useState("");
  const [expandedInventoryBlocks, setExpandedInventoryBlocks] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpandedInventoryBlocks(readStoredInventoryBlocks());
  }, []);

  const isInventoryBlockExpanded = (blockKey: string) => expandedInventoryBlocks.has(blockKey);
  const toggleInventoryBlock = (blockKey: string) => {
    setExpandedInventoryBlocks((current) => {
      const next = new Set(current);

      if (next.has(blockKey)) {
        next.delete(blockKey);
      } else {
          next.add(blockKey);
      }

      storeInventoryBlocks(next);
      return next;
    });
  };
  const openPurchaseOrders = purchaseOrders.filter((order) => order.status !== "RECEIVED");
  const lowStock = items.filter((item) => item.minimumStock > 0 && item.onHandQuantity <= item.minimumStock);
  const outOfStock = items.filter((item) => item.minimumStock > 0 && item.onHandQuantity <= 0);
  const expiringLots = lots
    .filter((lot) => Boolean(lot.expiresAt) && lot.quantityOnHand > 0)
    .sort((left, right) =>
      String(left.expiresAt).localeCompare(String(right.expiresAt)),
    )
    .slice(0, 8);
  const inventoryValue = items.reduce(
    (total, item) => total + item.onHandQuantity * (item.averageUnitCost ?? 0),
    0,
  );
  const itemCategories = Array.from(
    new Set([...itemGroups.map((group) => group.name), ...items.map((item) => item.category)]),
  ).sort((a, b) => a.localeCompare(b));
  const configuredGroupOrder = new Map(itemGroups.map((group, index) => [group.name, index]));
  const groupedInventory = Array.from(
    items.reduce((groups, item) => {
      const groupName = item.groupName ?? inventoryGroupForCategory(item.category, language);
      const current = groups.get(groupName) ?? [];
      current.push(item);
      groups.set(groupName, current);
      return groups;
    }, new Map<string, InventoryItemRecord[]>()),
  )
    .map(([groupName, groupItems]) => {
      const categories = Array.from(new Set(groupItems.map((item) => item.category))).sort((a, b) =>
        a.localeCompare(b),
      );
      const groupTags = Array.from(
        new Set(groupItems.flatMap((item) => item.tags.map((tag) => tag.name))),
      ).sort((a, b) => a.localeCompare(b));
      const groupLowStock = groupItems.filter(
        (item) => item.minimumStock > 0 && item.onHandQuantity <= item.minimumStock,
      );
      const groupValue = groupItems.reduce(
        (total, item) => total + item.onHandQuantity * (item.averageUnitCost ?? 0),
        0,
      );

      return { categories, groupItems, groupLowStock, groupName, groupTags, groupValue };
    })
    .sort((left, right) => {
      const orderDelta =
        inventoryGroupSortValue(left.groupName, language, configuredGroupOrder) -
        inventoryGroupSortValue(right.groupName, language, configuredGroupOrder);

      return orderDelta || left.groupName.localeCompare(right.groupName);
    });
  const unitOptions = Array.from(new Set(items.map((item) => item.unit))).sort((a, b) =>
    a.localeCompare(b),
  );
  const editingInventoryItem = items.find((item) => item.id === editingInventoryItemId) ?? null;
  const editingEquipmentAsset =
    equipmentAssets.find((asset) => asset.id === editingEquipmentAssetId) ?? null;
  const labels =
    language === "vi"
      ? {
          heading: "Kho vật tư, thiết bị và bảo trì",
          cancel: "Hủy",
          close: "Đóng",
          supplier: "Nhà cung cấp",
          item: "Vật tư",
          movement: "Biến động kho",
          lowStock: "Sắp hết",
          outOfStock: "Hết hàng",
          expiring: "Lô cần theo dõi hạn",
          expiryDate: "Hạn dùng",
          remaining: "Còn lại",
          equipment: "Thiết bị",
          maintenance: "Bảo trì đến hạn",
          inventoryValue: "Giá trị tồn kho",
          edit: "Chỉnh sửa",
          editItem: "Chỉnh sửa vật tư",
          editEquipment: "Chỉnh sửa thiết bị",
          status: "Trạng thái",
          serialNo: "Số serial",
          purchasedAt: "Ngày mua",
          warrantyEndsAt: "Hết bảo hành",
          code: "Mã",
          name: "Tên",
          category: "Nhóm",
          group: "Nhóm chính",
          tag: "Tag",
          tags: "Tags",
          addGroup: "Thêm nhóm",
          addTag: "Thêm tag",
          settingsTab: "Cài đặt",
          settings: "Cài đặt kho",
          disable: "Ngừng dùng",
          sortOrder: "Thứ tự",
          color: "Màu",
          unit: "Đơn vị",
          min: "Tồn tối thiểu",
          onHand: "Tồn kho",
          quantity: "Số lượng",
          save: "Lưu",
          empty: "Chưa có dữ liệu kho",
          eyebrow: "Kho",
          clinic: "Phòng khám",
          cost: "Giá vốn",
          phone: "Điện thoại",
          email: "Email",
          none: "Không có",
          itemAction: "Quản lý",
          supplierAction: "Nhà cung cấp",
          movementAction: "Kho",
          movementConfirm:
            "Bạn chắc chắn muốn ghi nhận biến động làm giảm tồn kho? Kiểm tra đúng vật tư, số lượng và ghi chú trước khi lưu.",
          movementType: "Loại biến động",
          unitCost: "Giá vốn/đơn vị",
          note: "Ghi chú",
          defaultCategory: "Tiêu hao",
          defaultUnit: "",
          categoryPlaceholder: "Nhập hoặc chọn nhóm",
          unitPlaceholder: "Nhập hoặc chọn đơn vị",
          supplierPlaceholder: "Chọn NCC hoặc nhập tên mới",
          lotTracked: "Theo dõi số lô / hạn dùng",
          lotTrackedHint: "Dùng cho thuốc, vật liệu và hàng cần truy xuất nguồn gốc.",
          addItem: "Thêm vật tư",
          addSupplier: "Thêm NCC",
          receive: "Nhận hàng",
          createPo: "Tạo đơn nhập",
          noAlerts: "Không có cảnh báo",
          stockByCategory: "Tồn kho theo nhóm",
          recentOperations: "Vận hành gần đây",
          overview: "Tổng quan cần xử lý",
          orderSuggestion: "Cần đặt thêm",
          stockStatusOk: "Đủ hàng",
          expand: "Mở",
          collapse: "Thu gọn",
          subgroups: "Tag",
          stockTab: "Tồn kho",
          operationsTab: "Lô & hạn dùng",
          procurementTab: "Nhập hàng",
          equipmentTab: "Thiết bị",
        }
      : {
          heading: "Inventory, equipment, and maintenance",
          cancel: "Cancel",
          close: "Close",
          supplier: "Supplier",
          item: "Item",
          movement: "Stock movement",
          lowStock: "Low stock",
          outOfStock: "Out of stock",
          expiring: "Lots to watch",
          expiryDate: "Expiry",
          remaining: "Remaining",
          equipment: "Equipment",
          maintenance: "Maintenance due",
          inventoryValue: "Inventory value",
          edit: "Edit",
          editItem: "Edit item",
          editEquipment: "Edit equipment",
          status: "Status",
          serialNo: "Serial no",
          purchasedAt: "Purchased date",
          warrantyEndsAt: "Warranty ends",
          code: "Code",
          name: "Name",
          category: "Category",
          group: "Primary group",
          tag: "Tag",
          tags: "Tags",
          addGroup: "Add group",
          addTag: "Add tag",
          settingsTab: "Settings",
          settings: "Inventory settings",
          disable: "Disable",
          sortOrder: "Sort order",
          color: "Color",
          unit: "Unit",
          min: "Minimum",
          onHand: "On hand",
          quantity: "Quantity",
          save: "Save",
          empty: "No inventory records yet",
          eyebrow: "Inventory",
          clinic: "Clinic",
          cost: "Cost",
          phone: "Phone",
          email: "Email",
          none: "None",
          itemAction: "Manage",
          supplierAction: "Vendor",
          movementAction: "Stock",
          movementConfirm:
            "Record this stock-decreasing movement? Verify the item, quantity, and note before saving.",
          movementType: "Movement type",
          unitCost: "Unit cost",
          note: "Note",
          defaultCategory: "Consumable",
          defaultUnit: "",
          categoryPlaceholder: "Type or choose a category",
          unitPlaceholder: "Type or choose a unit",
          supplierPlaceholder: "Choose a supplier or type a new one",
          lotTracked: "Track lot / expiry",
          lotTrackedHint: "Use for medications, materials, and traceable stock.",
          addItem: "Add item",
          addSupplier: "Add supplier",
          receive: "Receive",
          createPo: "Create PO",
          noAlerts: "No alerts",
          stockByCategory: "Stock by category",
          recentOperations: "Recent operations",
          overview: "Work to handle",
          orderSuggestion: "Suggested order",
          stockStatusOk: "In stock",
          expand: "Expand",
          collapse: "Collapse",
          subgroups: "Tags",
          stockTab: "Stock",
          operationsTab: "Lots & expiry",
          procurementTab: "Purchasing",
          equipmentTab: "Equipment",
        };
  const inventoryAdvancedLabels =
    language === "vi"
      ? {
          expiresAt: "Hạn dùng",
          expectedAt: "Ngày dự kiến",
          lot: "Lô/hạn dùng",
          lotNo: "Số lô",
          purchaseOrder: "Đơn nhập hàng",
          receivePo: "Nhận hàng",
        }
      : {
          expiresAt: "Expiry",
          expectedAt: "Expected date",
          lot: "Lots/expiry",
          lotNo: "Lot no",
          purchaseOrder: "Purchase order",
          receivePo: "Receive",
        };
  const inventorySectionTabs = [
    { key: "stock", label: labels.stockTab, count: items.length },
    { key: "procurement", label: labels.procurementTab, count: openPurchaseOrders.length },
    { key: "operations", label: labels.operationsTab, count: expiringLots.length },
    { key: "equipment", label: labels.equipmentTab, count: equipmentAssets.length },
    { key: "settings", label: labels.settingsTab, count: itemGroups.length + inventoryTags.length + suppliers.length },
  ] as const;
  const actionButtons = (() => {
    switch (inventorySection) {
      case "procurement":
        return (
          <>
            <button className="primary-button" type="button" disabled={!canMutate} onClick={() => setInventoryModal("purchaseOrder")}>
              <WalletCards size={16} />
              {labels.createPo}
            </button>
            <button className="secondary-button" type="button" disabled={!canMutate || openPurchaseOrders.length === 0} onClick={() => setInventoryModal("receive")}>
              <CheckCircle2 size={16} />
              {labels.receive}
            </button>
            <button className="secondary-button" type="button" disabled={!canMutate} onClick={() => setInventoryModal("supplier")}>
              <Building2 size={16} />
              {labels.addSupplier}
            </button>
          </>
        );
      case "operations":
        return (
          <button className="primary-button" type="button" disabled={!canMutate} onClick={() => setInventoryModal("movement")}>
            <Activity size={16} />
            {labels.movement}
          </button>
        );
      case "equipment":
        return null;
      case "settings":
        return (
          <>
            <button className="primary-button" type="button" disabled={!canMutate} onClick={() => setInventoryModal("itemGroup")}>
              <ClipboardList size={16} />
              {labels.addGroup}
            </button>
            <button className="secondary-button" type="button" disabled={!canMutate} onClick={() => setInventoryModal("tag")}>
              <Tag size={16} />
              {labels.addTag}
            </button>
            <button className="secondary-button" type="button" disabled={!canMutate} onClick={() => setInventoryModal("supplier")}>
              <Building2 size={16} />
              {labels.addSupplier}
            </button>
          </>
        );
      case "stock":
      default:
        return (
          <>
            <button className="primary-button" type="button" disabled={!canMutate} onClick={() => setInventoryModal("item")}>
              <ClipboardList size={16} />
              {labels.addItem}
            </button>
            <button className="secondary-button" type="button" disabled={!canMutate} onClick={() => setInventoryModal("movement")}>
              <Activity size={16} />
              {labels.movement}
            </button>
          </>
        );
    }
  })();

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h2>{labels.heading}</h2>
        </div>
        <div className="service-action-row">
          {actionButtons}
        </div>
      </div>

      {(inventoryWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(inventoryWorkspace?.message, language)}
        </div>
      )}

      <datalist id="inventory-category-options">
        {itemCategories.map((category) => (
          <option value={category} key={category} />
        ))}
      </datalist>
      <datalist id="inventory-unit-options">
        {unitOptions.map((unit) => (
          <option value={unit} key={unit} />
        ))}
      </datalist>
      <datalist id="inventory-supplier-options">
        {suppliers.map((supplier) => (
          <option value={supplierOptionLabel(supplier)} key={supplier.id} />
        ))}
      </datalist>

      <div className="metric-grid inventory-metric-grid">
        <MetricCard label={labels.item} value={String(items.length)} tone="blue" />
        <MetricCard label={labels.lowStock} value={String(lowStock.length)} tone="teal" />
        <MetricCard label={labels.outOfStock} value={String(outOfStock.length)} tone="amber" />
        <MetricCard label={labels.supplier} value={String(suppliers.length)} tone="green" />
        <MetricCard label={inventoryAdvancedLabels.purchaseOrder} value={String(openPurchaseOrders.length)} tone="violet" />
        <MetricCard label={labels.equipment} value={String(equipmentAssets.length)} tone="blue" />
        <MetricCard label={labels.maintenance} value={String(maintenanceTasks.length)} tone="teal" />
        <MetricCard label={labels.inventoryValue} value={formatVnd(inventoryValue)} tone="green" />
      </div>

      <nav className="inventory-section-tabs" aria-label={labels.heading}>
        {inventorySectionTabs.map((tab) => (
          <button
            className={inventorySection === tab.key ? "active" : ""}
            key={tab.key}
            type="button"
            onClick={() => setInventorySection(tab.key)}
          >
            {tab.label}
            <span>{tab.count}</span>
          </button>
        ))}
      </nav>

      {inventorySection === "stock" && (
        <>
          <section className="inventory-alert-grid inventory-stock-alert-grid">
            <section className="panel">
              <button
                aria-label={`${isInventoryBlockExpanded("lowStock") ? labels.collapse : labels.expand} ${labels.lowStock}`}
                className="inventory-collapsible-header"
                type="button"
                onClick={() => toggleInventoryBlock("lowStock")}
              >
                <PanelHeader icon={Inbox} title={labels.lowStock} action={`${lowStock.length}`} />
              </button>
              {isInventoryBlockExpanded("lowStock") && (
                <div className="inventory-compact-list">
                  {lowStock.length > 0 ? (
                    lowStock.slice(0, 8).map((item) => (
                      <div className="inventory-alert-row warning" key={item.id}>
                        <strong>{item.name}</strong>
                        <span>{item.tags.length > 0 ? item.tags.map((tag) => tag.name).join(", ") : item.category}</span>
                        <small>{item.onHandQuantity}/{item.minimumStock} {item.unit}</small>
                      </div>
                    ))
                  ) : (
                    <EmptyState label={labels.noAlerts} />
                  )}
                </div>
              )}
            </section>

            <section className="panel">
              <button
                aria-label={`${isInventoryBlockExpanded("expiringLots") ? labels.collapse : labels.expand} ${labels.expiring}`}
                className="inventory-collapsible-header"
                type="button"
                onClick={() => toggleInventoryBlock("expiringLots")}
              >
                <PanelHeader icon={CalendarDays} title={labels.expiring} action={`${expiringLots.length}`} />
              </button>
              {isInventoryBlockExpanded("expiringLots") && (
                <div className="inventory-compact-list">
                  {expiringLots.length > 0 ? (
                    expiringLots.map((lot) => (
                      <div className="inventory-alert-row" key={lot.id}>
                        <strong>{lot.itemName}</strong>
                        <span>{labels.expiryDate}: {lot.expiresAt ?? "-"}</span>
                        <small>{labels.remaining}: {lot.quantityOnHand} {lot.itemUnit}</small>
                      </div>
                    ))
                  ) : (
                    <EmptyState label={labels.noAlerts} />
                  )}
                </div>
              )}
            </section>
          </section>

          <section className="panel">
            <button
              aria-label={`${isInventoryBlockExpanded("stockByCategory") ? labels.collapse : labels.expand} ${labels.stockByCategory}`}
              className="inventory-collapsible-header"
              type="button"
              onClick={() => toggleInventoryBlock("stockByCategory")}
            >
              <PanelHeader icon={ClipboardList} title={labels.stockByCategory} action={`${groupedInventory.length}`} />
            </button>
            {isInventoryBlockExpanded("stockByCategory") && (
              <div className="inventory-category-list">
                {groupedInventory.map(({ categories, groupItems, groupLowStock, groupName, groupTags, groupValue }) => {
                  const groupBlockKey = `group:${groupName}`;
                  const groupExpanded = isInventoryBlockExpanded(groupBlockKey);

                  return (
                  <article className="inventory-category-card" key={groupName}>
                    <button
                      aria-label={`${groupExpanded ? labels.collapse : labels.expand} ${groupName}`}
                      className="inventory-category-head inventory-category-toggle"
                      type="button"
                      onClick={() => toggleInventoryBlock(groupBlockKey)}
                    >
                      <div>
                        <strong>{groupName}</strong>
                        <small>
                          {labels.subgroups}: {groupTags.length > 0 ? groupTags.join(", ") : categories.join(", ")}
                        </small>
                      </div>
                      <span>{groupItems.length}</span>
                    </button>
                    {groupExpanded && (
                      <>
                        <div className="inventory-group-summary">
                          <span>{formatVnd(groupValue)}</span>
                          <span>
                            {groupLowStock.length > 0
                              ? `${labels.lowStock}: ${groupLowStock.length}`
                              : labels.stockStatusOk}
                          </span>
                        </div>
                        <div className="inventory-item-table">
                          {groupItems.map((item) => (
                            <div
                              className={
                                item.minimumStock > 0 && item.onHandQuantity <= item.minimumStock
                                  ? "inventory-item-row low"
                                  : "inventory-item-row"
                              }
                              key={item.id}
                            >
                              <div>
                                <strong>{item.name}</strong>
                                <span>
                                  {item.tags.length > 0 ? item.tags.map((tag) => tag.name).join(", ") : item.category}
                                </span>
                              </div>
                              <small>{item.onHandQuantity} {item.unit}</small>
                              <small>{formatVnd(item.averageUnitCost ?? 0)}</small>
                              <button
                                className="inventory-edit-button"
                                type="button"
                                disabled={!canMutate}
                                title={labels.editItem}
                                onClick={() => {
                                  setEditingInventoryItemId(item.id);
                                  setInventoryModal("editItem");
                                }}
                              >
                                <Settings size={15} />
                                {labels.edit}
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </article>
                  );
                })}
                {items.length === 0 && <EmptyState label={labels.empty} />}
              </div>
            )}
          </section>
        </>
      )}

      <section className="content-grid service-management-grid inventory-inline-forms">
        <section className="panel">
          <PanelHeader icon={ClipboardList} title={labels.item} action={labels.itemAction} />
          <form action={createInventoryItemAction} className="staff-form">
            <label>
              {labels.clinic}
              <select name="clinicId" disabled={!canMutate}>
                <option value="all">{uiText[language].allClinics}</option>
                {clinics.map((clinic) => (
                  <option value={clinic.id} key={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.name}
              <input name="name" disabled={!canMutate} required />
            </label>
            <label>
              {labels.category}
              <input
                name="category"
                defaultValue={labels.defaultCategory}
                disabled={!canMutate}
                list="inventory-category-options"
                placeholder={labels.categoryPlaceholder}
              />
            </label>
            <label>
              {labels.unit}
              <input
                name="unit"
                disabled={!canMutate}
                list="inventory-unit-options"
                placeholder={labels.unitPlaceholder}
              />
            </label>
            <label>
              {labels.min}
              <input name="minimumStock" inputMode="numeric" defaultValue="0" disabled={!canMutate} />
            </label>
            <label>
              {labels.onHand}
              <input name="onHandQuantity" inputMode="numeric" defaultValue="0" disabled={!canMutate} />
            </label>
            <label>
              {labels.cost}
              <MoneyInput name="averageUnitCost" disabled={!canMutate} />
            </label>
            <InventorySupplierPicker
              disabled={!canMutate}
              label={labels.supplier}
              placeholder={labels.supplierPlaceholder}
              suppliers={suppliers}
            />
            <button className="primary-button" type="submit" disabled={!canMutate}>
              <ClipboardList size={16} />
              {labels.save}
            </button>
          </form>
        </section>

        <section className="panel">
          <PanelHeader icon={Building2} title={labels.supplier} action={labels.supplierAction} />
          <form action={createInventorySupplierAction} className="staff-form">
            <label>
              {labels.name}
              <input name="name" disabled={!canMutate} required />
            </label>
            <label>
              {labels.phone}
              <input name="phone" disabled={!canMutate} />
            </label>
            <label>
              {labels.email}
              <input name="email" type="email" disabled={!canMutate} />
            </label>
            <button className="primary-button" type="submit" disabled={!canMutate}>
              <Building2 size={16} />
              {labels.save}
            </button>
          </form>
        </section>

        <section className="panel">
          <PanelHeader icon={Activity} title={labels.movement} action={labels.movementAction} />
          <form action={recordInventoryMovementAction} className="staff-form">
            <label>
              {labels.item}
              <select name="itemId" disabled={!canMutate || items.length === 0} required>
                {items.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name} ({item.onHandQuantity} {item.unit})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.movementType}
              <select name="type" disabled={!canMutate}>
                <option value="PURCHASE">{displayStatus("PURCHASE", language)}</option>
                <option value="CONSUMPTION">{displayStatus("CONSUMPTION", language)}</option>
                <option value="WASTE">{displayStatus("WASTE", language)}</option>
                <option value="TRANSFER_IN">{displayStatus("TRANSFER_IN", language)}</option>
                <option value="TRANSFER_OUT">{displayStatus("TRANSFER_OUT", language)}</option>
                <option value="RETURN">{displayStatus("RETURN", language)}</option>
              </select>
            </label>
            <label>
              {labels.quantity}
              <input name="quantity" inputMode="numeric" disabled={!canMutate} required />
            </label>
            <label>
              {labels.unitCost}
              <MoneyInput name="unitCost" disabled={!canMutate} />
            </label>
            <label className="clinical-wide">
              {labels.note}
              <textarea name="note" disabled={!canMutate} />
            </label>
            <button className="primary-button" type="submit" disabled={!canMutate || items.length === 0}>
              <Activity size={16} />
              {labels.movement}
            </button>
          </form>
        </section>
      </section>

      <section className="content-grid service-management-grid inventory-inline-forms">
        <section className="panel">
          <PanelHeader icon={WalletCards} title={inventoryAdvancedLabels.purchaseOrder} action="PO" />
          <form action={createPurchaseOrderAction} className="staff-form">
            <label>
              {labels.clinic}
              <select name="clinicId" disabled={!canMutate}>
                <option value="all">{uiText[language].allClinics}</option>
                {clinics.map((clinic) => (
                  <option value={clinic.id} key={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.supplier}
              <select name="supplierId" disabled={!canMutate || suppliers.length === 0} required>
                {suppliers.map((supplier) => (
                  <option value={supplier.id} key={supplier.id}>
                    {supplierOptionLabel(supplier)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.item}
              <select name="itemId" disabled={!canMutate || items.length === 0} required>
                {items.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.quantity}
              <input name="quantity" inputMode="numeric" disabled={!canMutate} required />
            </label>
            <label>
              {labels.unitCost}
              <MoneyInput name="unitCost" disabled={!canMutate} required />
            </label>
            <label>
              {inventoryAdvancedLabels.expectedAt}
              <input name="expectedAt" type="date" disabled={!canMutate} />
            </label>
            <button
              className="primary-button"
              type="submit"
              disabled={!canMutate || suppliers.length === 0 || items.length === 0}
            >
              <WalletCards size={16} />
              {inventoryAdvancedLabels.purchaseOrder}
            </button>
          </form>
        </section>

        <section className="panel">
          <PanelHeader icon={CheckCircle2} title={inventoryAdvancedLabels.receivePo} action={inventoryAdvancedLabels.lot} />
          <form action={receivePurchaseOrderAction} className="staff-form">
            <label>
              {inventoryAdvancedLabels.purchaseOrder}
              <select name="purchaseOrderId" disabled={!canMutate || openPurchaseOrders.length === 0} required>
                {openPurchaseOrders.map((order) => (
                  <option value={order.id} key={order.id}>
                    {order.poNo} - {order.supplierName} - {formatVnd(order.totalAmount)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {inventoryAdvancedLabels.lotNo}
              <input name="lotNo" disabled={!canMutate} />
            </label>
            <label>
              {labels.quantity}
              <input name="receiveQuantity" inputMode="numeric" disabled={!canMutate} />
            </label>
            <label>
              {inventoryAdvancedLabels.expiresAt}
              <input name="expiresAt" type="date" disabled={!canMutate} />
            </label>
            <button
              className="primary-button"
              type="submit"
              disabled={!canMutate || openPurchaseOrders.length === 0}
            >
              <CheckCircle2 size={16} />
              {inventoryAdvancedLabels.receivePo}
            </button>
          </form>
        </section>
      </section>

      {inventorySection === "operations" && (
        <section className="content-grid service-management-grid">
          <section className="panel">
            <PanelHeader icon={Activity} title={labels.movement} action={`${movements.length}`} />
            <div className="record-grid">
              {movements.length > 0 ? (
                movements.slice(0, 12).map((movement) => (
                  <RecordTile
                    key={movement.id}
                    title={`${displayStatus(movement.type, language)} · ${movement.itemName}`}
                    value={`${movement.quantity} · ${movement.performedByName ?? "-"} · ${movement.createdAt}`}
                  />
                ))
              ) : (
                <EmptyState label={labels.empty} />
              )}
            </div>
          </section>

          <section className="panel">
            <PanelHeader icon={ClipboardList} title={inventoryAdvancedLabels.lot} action={`${lots.length}`} />
            <div className="record-grid">
              {lots.length > 0 ? (
                lots.slice(0, 12).map((lot) => (
                  <RecordTile
                    key={lot.id}
                    title={`${lot.itemName} · ${lot.lotNo}`}
                    value={`${lot.quantityOnHand} · ${lot.expiresAt ?? "-"}`}
                  />
                ))
              ) : (
                <EmptyState label={labels.empty} />
              )}
            </div>
          </section>
        </section>
      )}

      {inventorySection === "procurement" && (
        <section className="content-grid service-management-grid">
          <section className="panel">
            <PanelHeader icon={Building2} title={labels.supplier} action={`${suppliers.length}`} />
            <div className="record-grid">
              {suppliers.length > 0 ? (
                suppliers.map((supplier) => (
                  <RecordTile
                    key={supplier.id}
                    title={supplierOptionLabel(supplier).replace(" - ", " · ")}
                    value={`${supplier.phone ?? labels.none} · ${supplier.email ?? labels.none}`}
                  />
                ))
              ) : (
                <EmptyState label={labels.empty} />
              )}
            </div>
          </section>

          <section className="panel">
            <PanelHeader icon={WalletCards} title={inventoryAdvancedLabels.purchaseOrder} action={`${purchaseOrders.length}`} />
            <div className="invoice-list">
              {purchaseOrders.length > 0 ? (
                purchaseOrders.slice(0, 10).map((order) => (
                  <div className="invoice-row billing-invoice-row" key={order.id}>
                    <div>
                      <strong>{order.poNo}</strong>
                      <span>
                        {order.supplierName} · {formatVnd(order.totalAmount)}
                      </span>
                      <small>
                        {order.lines
                          .map((line) => `${line.itemCode} ${line.receivedQuantity}/${line.quantity}`)
                          .join(", ")}
                      </small>
                    </div>
                    <StatusPill status={order.status} />
                  </div>
                ))
              ) : (
                <EmptyState label={labels.empty} />
              )}
            </div>
          </section>
        </section>
      )}

      {inventorySection === "settings" && (
        <section className="content-grid service-management-grid inventory-settings-grid">
          <section className="panel">
            <PanelHeader icon={ClipboardList} title={labels.group} action={`${itemGroups.length}`} />
            <div className="inventory-settings-list">
              {itemGroups.length > 0 ? (
                itemGroups.map((group) => (
                  <article className="inventory-settings-card" key={group.id}>
                    <div>
                      <strong>{group.name}</strong>
                    </div>
                    <form action={deactivateInventoryItemGroupAction}>
                      <input name="groupId" type="hidden" value={group.id} />
                      <button className="inventory-edit-button" type="submit" disabled={!canMutate}>
                        {labels.disable}
                      </button>
                    </form>
                  </article>
                ))
              ) : (
                <EmptyState label={labels.empty} />
              )}
            </div>
          </section>

          <section className="panel">
            <PanelHeader icon={Tag} title={labels.tags} action={`${inventoryTags.length}`} />
            <div className="inventory-settings-list">
              {inventoryTags.length > 0 ? (
                inventoryTags.map((tag) => (
                  <article className="inventory-settings-card" key={tag.id}>
                    <div>
                      <strong>
                        <span className="inventory-tag-dot" style={{ background: tag.color ?? "#64748b" }} />
                        {tag.name}
                      </strong>
                    </div>
                    <form action={deactivateInventoryTagAction}>
                      <input name="tagId" type="hidden" value={tag.id} />
                      <button className="inventory-edit-button" type="submit" disabled={!canMutate}>
                        {labels.disable}
                      </button>
                    </form>
                  </article>
                ))
              ) : (
                <EmptyState label={labels.empty} />
              )}
            </div>
          </section>

          <section className="panel">
            <PanelHeader icon={Building2} title={labels.supplier} action={`${suppliers.length}`} />
            <div className="inventory-settings-list">
              {suppliers.length > 0 ? (
                suppliers.map((supplier) => (
                  <article className="inventory-settings-card" key={supplier.id}>
                    <div>
                      <strong>{supplierOptionLabel(supplier).replace(" - ", " · ")}</strong>
                      <small>{supplier.phone ?? labels.none} · {supplier.email ?? labels.none}</small>
                    </div>
                    <form action={deactivateInventorySupplierAction}>
                      <input name="supplierId" type="hidden" value={supplier.id} />
                      <button className="inventory-edit-button" type="submit" disabled={!canMutate}>
                        {labels.disable}
                      </button>
                    </form>
                  </article>
                ))
              ) : (
                <EmptyState label={labels.empty} />
              )}
            </div>
          </section>
        </section>
      )}

      {inventorySection === "equipment" && (
        <section className="content-grid service-management-grid inventory-main-grid">
          <section className="panel">
            <PanelHeader icon={Settings} title={labels.equipment} action={`${equipmentAssets.length}`} />
            <div className="inventory-equipment-grid">
              {equipmentAssets.length > 0 ? (
                equipmentAssets.map((asset) => (
                  <article className="inventory-equipment-card" key={asset.id}>
                    <div>
                      <strong>{asset.name}</strong>
                      <span>{asset.category}</span>
                      <small>{asset.serialNo ?? "-"}</small>
                    </div>
                    <StatusPill status={asset.status} />
                    <button
                      className="inventory-edit-button"
                      type="button"
                      disabled={!canMutate}
                      title={labels.editEquipment}
                      onClick={() => {
                        setEditingEquipmentAssetId(asset.id);
                        setInventoryModal("editEquipment");
                      }}
                    >
                      <Settings size={15} />
                      {labels.edit}
                    </button>
                    <small>{labels.maintenance}: {asset.nextMaintenanceAt ?? "-"}</small>
                  </article>
                ))
              ) : (
                <EmptyState label={labels.empty} />
              )}
            </div>
          </section>

          <section className="panel">
            <PanelHeader icon={Settings} title={labels.maintenance} action={`${maintenanceTasks.length}`} />
            <div className="inventory-compact-list">
              {maintenanceTasks.length > 0 ? (
                maintenanceTasks.slice(0, 8).map((task) => (
                  <div className="inventory-alert-row maintenance" key={task.id}>
                    <strong>{task.assetName}</strong>
                    <span>{task.title}</span>
                    <small>{task.dueAt}</small>
                  </div>
                ))
              ) : (
                <EmptyState label={labels.noAlerts} />
              )}
            </div>
          </section>
        </section>
      )}

      {inventoryModal && (
        <div
          aria-label={labels.heading}
          aria-modal="true"
          className="progress-modal-backdrop"
          onClick={() => setInventoryModal(null)}
          role="dialog"
        >
          <div className="progress-modal inventory-modal" onClick={(event) => event.stopPropagation()}>
            <div className="progress-modal-header">
              <div>
                <span>{labels.eyebrow}</span>
                <h3>
                  {inventoryModal === "item"
                    ? labels.addItem
                    : inventoryModal === "supplier"
                      ? labels.addSupplier
                      : inventoryModal === "itemGroup"
                        ? labels.addGroup
                        : inventoryModal === "tag"
                          ? labels.addTag
                      : inventoryModal === "movement"
                        ? labels.movement
                        : inventoryModal === "purchaseOrder"
                          ? labels.createPo
                          : inventoryModal === "editItem"
                            ? labels.editItem
                            : inventoryModal === "editEquipment"
                              ? labels.editEquipment
                              : labels.receive}
                </h3>
              </div>
              <button className="icon-button" type="button" onClick={() => setInventoryModal(null)} aria-label={labels.close}>
                <X size={16} />
              </button>
            </div>

            {inventoryModal === "item" && (
              <form action={createInventoryItemAction} className="staff-form modal-form-grid">
                <label>
                  {labels.clinic}
                  <select name="clinicId" disabled={!canMutate}>
                    <option value="all">{uiText[language].allClinics}</option>
                    {clinics.map((clinic) => (
                      <option value={clinic.id} key={clinic.id}>{clinic.name}</option>
                    ))}
                  </select>
                </label>
                <label>{labels.name}<input name="name" disabled={!canMutate} required /></label>
                <input name="category" type="hidden" value={labels.defaultCategory} readOnly />
                <label>
                  {labels.group}
                  <select name="groupId" disabled={!canMutate || itemGroups.length === 0}>
                    <option value="">{labels.categoryPlaceholder}</option>
                    {itemGroups.map((group) => (
                      <option value={group.id} key={group.id}>{group.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {labels.unit}
                  <input
                    name="unit"
                    disabled={!canMutate}
                    list="inventory-unit-options"
                    placeholder={labels.unitPlaceholder}
                  />
                </label>
                <label>{labels.min}<input name="minimumStock" inputMode="numeric" defaultValue="0" disabled={!canMutate} /></label>
                <label>{labels.onHand}<input name="onHandQuantity" inputMode="numeric" defaultValue="0" disabled={!canMutate} /></label>
                <label>{labels.cost}<MoneyInput name="averageUnitCost" disabled={!canMutate} /></label>
                <InventorySupplierPicker
                  disabled={!canMutate}
                  label={labels.supplier}
                  placeholder={labels.supplierPlaceholder}
                  suppliers={suppliers}
                />
                <div className="inventory-tag-picker clinical-wide">
                  <span>{labels.tags}</span>
                  <div>
                    {inventoryTags.map((tag) => (
                      <label key={tag.id}>
                        <input name="tagIds" type="checkbox" value={tag.id} disabled={!canMutate} />
                        {tag.name}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="inventory-check-card clinical-wide">
                  <input name="lotTracked" type="checkbox" disabled={!canMutate} />
                  <span>
                    <strong>{labels.lotTracked}</strong>
                    <small>{labels.lotTrackedHint}</small>
                  </span>
                </label>
                <div className="progress-modal-actions">
                  <button className="secondary-button" type="button" onClick={() => setInventoryModal(null)}>{labels.cancel}</button>
                  <button className="primary-button" type="submit" disabled={!canMutate}>{labels.save}</button>
                </div>
              </form>
            )}

            {inventoryModal === "editItem" && editingInventoryItem && (
              <form action={updateInventoryItemAction} className="staff-form modal-form-grid">
                <input name="itemId" type="hidden" value={editingInventoryItem.id} />
                <label>
                  {labels.clinic}
                  <select name="clinicId" defaultValue={editingInventoryItem.clinicId ?? "all"} disabled={!canMutate}>
                    <option value="all">{uiText[language].allClinics}</option>
                    {clinics.map((clinic) => (
                      <option value={clinic.id} key={clinic.id}>{clinic.name}</option>
                    ))}
                  </select>
                </label>
                <label>{labels.name}<input name="name" defaultValue={editingInventoryItem.name} disabled={!canMutate} required /></label>
                <input name="category" type="hidden" value={editingInventoryItem.category} readOnly />
                <label>
                  {labels.group}
                  <select name="groupId" defaultValue={editingInventoryItem.groupId ?? ""} disabled={!canMutate || itemGroups.length === 0}>
                    <option value="">{labels.categoryPlaceholder}</option>
                    {itemGroups.map((group) => (
                      <option value={group.id} key={group.id}>{group.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {labels.unit}
                  <input
                    name="unit"
                    defaultValue={editingInventoryItem.unit}
                    disabled={!canMutate}
                    list="inventory-unit-options"
                    placeholder={labels.unitPlaceholder}
                  />
                </label>
                <label>{labels.min}<input name="minimumStock" inputMode="numeric" defaultValue={editingInventoryItem.minimumStock} disabled={!canMutate} /></label>
                <label>{labels.cost}<MoneyInput name="averageUnitCost" defaultValue={editingInventoryItem.averageUnitCost ?? ""} disabled={!canMutate} /></label>
                <InventorySupplierPicker
                  defaultSupplierId={editingInventoryItem.supplierId}
                  disabled={!canMutate}
                  label={labels.supplier}
                  placeholder={labels.supplierPlaceholder}
                  suppliers={suppliers}
                />
                <div className="inventory-tag-picker clinical-wide">
                  <span>{labels.tags}</span>
                  <div>
                    {inventoryTags.map((tag) => (
                      <label key={tag.id}>
                        <input
                          name="tagIds"
                          type="checkbox"
                          value={tag.id}
                          defaultChecked={editingInventoryItem.tags.some((itemTag) => itemTag.id === tag.id)}
                          disabled={!canMutate}
                        />
                        {tag.name}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="inventory-check-card clinical-wide">
                  <input name="lotTracked" type="checkbox" defaultChecked={editingInventoryItem.lotTracked} disabled={!canMutate} />
                  <span>
                    <strong>{labels.lotTracked}</strong>
                    <small>{labels.lotTrackedHint}</small>
                  </span>
                </label>
                <div className="progress-modal-actions">
                  <button className="secondary-button" type="button" onClick={() => setInventoryModal(null)}>{labels.cancel}</button>
                  <button className="primary-button" type="submit" disabled={!canMutate}>{labels.save}</button>
                </div>
              </form>
            )}

            {inventoryModal === "supplier" && (
              <form action={createInventorySupplierAction} className="staff-form modal-form-grid" onSubmit={() => setInventoryModal(null)}>
                <input name="returnSection" type="hidden" value={inventorySection === "settings" ? "settings" : "procurement"} />
                <label>{labels.name}<input name="name" disabled={!canMutate} required /></label>
                <label>{labels.phone}<input name="phone" disabled={!canMutate} /></label>
                <label>{labels.email}<input name="email" type="email" disabled={!canMutate} /></label>
                <div className="progress-modal-actions">
                  <button className="secondary-button" type="button" onClick={() => setInventoryModal(null)}>{labels.cancel}</button>
                  <button className="primary-button" type="submit" disabled={!canMutate}>{labels.save}</button>
                </div>
              </form>
            )}

            {inventoryModal === "itemGroup" && (
              <form action={createInventoryItemGroupAction} className="staff-form modal-form-grid" onSubmit={() => setInventoryModal(null)}>
                <label>{labels.name}<input name="name" disabled={!canMutate} required /></label>
                <div className="progress-modal-actions">
                  <button className="secondary-button" type="button" onClick={() => setInventoryModal(null)}>{labels.cancel}</button>
                  <button className="primary-button" type="submit" disabled={!canMutate}>{labels.save}</button>
                </div>
              </form>
            )}

            {inventoryModal === "tag" && (
              <form action={createInventoryTagAction} className="staff-form modal-form-grid" onSubmit={() => setInventoryModal(null)}>
                <label>{labels.name}<input name="name" placeholder={language === "vi" ? "Nội nha" : "Endodontics"} disabled={!canMutate} required /></label>
                <label>{labels.color}<input name="color" type="color" defaultValue="#64748b" disabled={!canMutate} /></label>
                <div className="progress-modal-actions">
                  <button className="secondary-button" type="button" onClick={() => setInventoryModal(null)}>{labels.cancel}</button>
                  <button className="primary-button" type="submit" disabled={!canMutate}>{labels.save}</button>
                </div>
              </form>
            )}

            {inventoryModal === "movement" && (
              <form
                action={recordInventoryMovementAction}
                className="staff-form modal-form-grid"
                onSubmit={(event) => {
                  const type = new FormData(event.currentTarget).get("type");
                  const decreasesStock =
                    type === "CONSUMPTION" || type === "WASTE" || type === "TRANSFER_OUT";

                  if (decreasesStock && !window.confirm(labels.movementConfirm)) {
                    event.preventDefault();
                    return;
                  }

                  setInventoryModal(null);
                }}
              >
                <label>
                  {labels.item}
                  <select name="itemId" disabled={!canMutate || items.length === 0} required>
                    {items.map((item) => (
                      <option value={item.id} key={item.id}>{item.name} ({item.onHandQuantity} {item.unit})</option>
                    ))}
                  </select>
                </label>
                <label>
                  {labels.movementType}
                  <select name="type" disabled={!canMutate}>
                    <option value="PURCHASE">{displayStatus("PURCHASE", language)}</option>
                    <option value="CONSUMPTION">{displayStatus("CONSUMPTION", language)}</option>
                    <option value="WASTE">{displayStatus("WASTE", language)}</option>
                    <option value="TRANSFER_IN">{displayStatus("TRANSFER_IN", language)}</option>
                    <option value="TRANSFER_OUT">{displayStatus("TRANSFER_OUT", language)}</option>
                    <option value="RETURN">{displayStatus("RETURN", language)}</option>
                  </select>
                </label>
                <label>{labels.quantity}<input name="quantity" inputMode="numeric" disabled={!canMutate} required /></label>
                <label>{labels.unitCost}<MoneyInput name="unitCost" disabled={!canMutate} /></label>
                <label className="clinical-wide">{labels.note}<textarea name="note" disabled={!canMutate} /></label>
                <div className="progress-modal-actions">
                  <button className="secondary-button" type="button" onClick={() => setInventoryModal(null)}>{labels.cancel}</button>
                  <button className="primary-button" type="submit" disabled={!canMutate || items.length === 0}>{labels.movement}</button>
                </div>
              </form>
            )}

            {inventoryModal === "purchaseOrder" && (
              <form action={createPurchaseOrderAction} className="staff-form modal-form-grid" onSubmit={() => setInventoryModal(null)}>
                <label>
                  {labels.clinic}
                  <select name="clinicId" disabled={!canMutate}>
                    <option value="all">{uiText[language].allClinics}</option>
                    {clinics.map((clinic) => (
                      <option value={clinic.id} key={clinic.id}>{clinic.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {labels.supplier}
                  <select name="supplierId" disabled={!canMutate || suppliers.length === 0} required>
                    {suppliers.map((supplier) => (
                      <option value={supplier.id} key={supplier.id}>{supplierOptionLabel(supplier)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {labels.item}
                  <select name="itemId" disabled={!canMutate || items.length === 0} required>
                    {items.map((item) => (
                      <option value={item.id} key={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <label>{labels.quantity}<input name="quantity" inputMode="numeric" disabled={!canMutate} required /></label>
                <label>{labels.unitCost}<MoneyInput name="unitCost" disabled={!canMutate} required /></label>
                <label>{inventoryAdvancedLabels.expectedAt}<input name="expectedAt" type="date" disabled={!canMutate} /></label>
                <div className="progress-modal-actions">
                  <button className="secondary-button" type="button" onClick={() => setInventoryModal(null)}>{labels.cancel}</button>
                  <button className="primary-button" type="submit" disabled={!canMutate || suppliers.length === 0 || items.length === 0}>{labels.createPo}</button>
                </div>
              </form>
            )}

            {inventoryModal === "receive" && (
              <form action={receivePurchaseOrderAction} className="staff-form modal-form-grid" onSubmit={() => setInventoryModal(null)}>
                <label>
                  {inventoryAdvancedLabels.purchaseOrder}
                  <select name="purchaseOrderId" disabled={!canMutate || openPurchaseOrders.length === 0} required>
                    {openPurchaseOrders.map((order) => (
                      <option value={order.id} key={order.id}>{order.poNo} - {order.supplierName} - {formatVnd(order.totalAmount)}</option>
                    ))}
                  </select>
                </label>
                <label>{inventoryAdvancedLabels.lotNo}<input name="lotNo" disabled={!canMutate} /></label>
                <label>{labels.quantity}<input name="receiveQuantity" inputMode="numeric" disabled={!canMutate} /></label>
                <label>{inventoryAdvancedLabels.expiresAt}<input name="expiresAt" type="date" disabled={!canMutate} /></label>
                <div className="progress-modal-actions">
                  <button className="secondary-button" type="button" onClick={() => setInventoryModal(null)}>{labels.cancel}</button>
                  <button className="primary-button" type="submit" disabled={!canMutate || openPurchaseOrders.length === 0}>{labels.receive}</button>
                </div>
              </form>
            )}

            {inventoryModal === "editEquipment" && editingEquipmentAsset && (
              <form action={updateEquipmentAssetAction} className="staff-form modal-form-grid" onSubmit={() => setInventoryModal(null)}>
                <input name="assetId" type="hidden" value={editingEquipmentAsset.id} />
                <label>
                  {labels.clinic}
                  <select name="clinicId" defaultValue={editingEquipmentAsset.clinicId ?? "all"} disabled={!canMutate}>
                    <option value="all">{uiText[language].allClinics}</option>
                    {clinics.map((clinic) => (
                      <option value={clinic.id} key={clinic.id}>{clinic.name}</option>
                    ))}
                  </select>
                </label>
                <label>{labels.name}<input name="name" defaultValue={editingEquipmentAsset.name} disabled={!canMutate} required /></label>
                <label>{labels.category}<input name="category" defaultValue={editingEquipmentAsset.category} disabled={!canMutate} /></label>
                <label>{labels.serialNo}<input name="serialNo" defaultValue={editingEquipmentAsset.serialNo ?? ""} disabled={!canMutate} /></label>
                <label>{labels.cost}<MoneyInput name="cost" defaultValue={editingEquipmentAsset.cost ?? ""} disabled={!canMutate} /></label>
                <label>{labels.purchasedAt}<input name="purchasedAt" type="date" defaultValue={editingEquipmentAsset.purchasedAtIso ?? ""} disabled={!canMutate} /></label>
                <label>{labels.warrantyEndsAt}<input name="warrantyEndsAt" type="date" defaultValue={editingEquipmentAsset.warrantyEndsAtIso ?? ""} disabled={!canMutate} /></label>
                <label>
                  {labels.status}
                  <select name="status" defaultValue={editingEquipmentAsset.status} disabled={!canMutate}>
                    <option value="ACTIVE">{displayStatus("ACTIVE", language)}</option>
                    <option value="MAINTENANCE">{displayStatus("MAINTENANCE", language)}</option>
                    <option value="RETIRED">{displayStatus("RETIRED", language)}</option>
                    <option value="LOST">{displayStatus("LOST", language)}</option>
                  </select>
                </label>
                <div className="progress-modal-actions">
                  <button className="secondary-button" type="button" onClick={() => setInventoryModal(null)}>{labels.cancel}</button>
                  <button className="primary-button" type="submit" disabled={!canMutate}>{labels.save}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

