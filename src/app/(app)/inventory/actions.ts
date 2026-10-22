"use server";
import { normalizeMovementType, normalizeAssetStatus, parseOptionalDate, normalizeClinicId } from "@/lib/application/inventory/support";
import { ApplicationCommandError } from "@/lib/application/errors";
import { createInventorySupplierCommand } from "@/lib/application/inventory/create-inventory-supplier-command";
import { createInventoryItemGroupCommand } from "@/lib/application/inventory/create-inventory-item-group-command";
import { createInventoryTagCommand } from "@/lib/application/inventory/create-inventory-tag-command";
import { deactivateInventoryItemGroupCommand } from "@/lib/application/inventory/deactivate-inventory-item-group-command";
import { deactivateInventoryTagCommand } from "@/lib/application/inventory/deactivate-inventory-tag-command";
import { deactivateInventorySupplierCommand } from "@/lib/application/inventory/deactivate-inventory-supplier-command";
import { createInventoryItemCommand } from "@/lib/application/inventory/create-inventory-item-command";
import { updateInventoryItemCommand } from "@/lib/application/inventory/update-inventory-item-command";
import { updateEquipmentAssetCommand } from "@/lib/application/inventory/update-equipment-asset-command";
import { recordInventoryMovementCommand } from "@/lib/application/inventory/record-inventory-movement-command";
import { createPurchaseOrderCommand } from "@/lib/application/inventory/create-purchase-order-command";
import { receivePurchaseOrderCommand } from "@/lib/application/inventory/receive-purchase-order-command";
import { reportApplicationError } from "@/lib/error-reporting";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { optionalString, parseDateInVietnam, parseMoney, requiredString, } from "@/lib/form-validation";
export async function createInventorySupplierAction(formData: FormData) {
    const session = await requireViewSession("inventory");
    const name = requiredString(formData.get("name"));
    const phone = optionalString(formData.get("phone"));
    const email = optionalString(formData.get("email"));
    const address = optionalString(formData.get("address"));
    const returnSection = optionalString(formData.get("returnSection")) === "settings" ? "settings" : "procurement";
    try {
        await createInventorySupplierCommand({ session, name, phone, email, address });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
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
    const name = requiredString(formData.get("name"));
    try {
        await createInventoryItemGroupCommand({ session, name });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
        redirect("/inventory?section=settings&notice=inventory-database");
    }
    revalidateInventoryViews();
    redirect("/inventory?section=settings&notice=inventory-group-saved");
}
export async function createInventoryTagAction(formData: FormData) {
    const session = await requireViewSession("inventory");
    const name = requiredString(formData.get("name"));
    const colorInput = optionalString(formData.get("color"));
    try {
        await createInventoryTagCommand({ session, colorInput, name });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
        redirect("/inventory?section=settings&notice=inventory-database");
    }
    revalidateInventoryViews();
    redirect("/inventory?section=settings&notice=inventory-tag-saved");
}
export async function deactivateInventoryItemGroupAction(formData: FormData) {
    const session = await requireViewSession("inventory");
    const groupId = requiredString(formData.get("groupId"));
    try {
        await deactivateInventoryItemGroupCommand({ groupId, session });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
        redirect("/inventory?section=settings&notice=inventory-database");
    }
    revalidateInventoryViews();
    redirect("/inventory?section=settings&notice=inventory-group-disabled");
}
export async function deactivateInventoryTagAction(formData: FormData) {
    const session = await requireViewSession("inventory");
    const tagId = requiredString(formData.get("tagId"));
    try {
        await deactivateInventoryTagCommand({ tagId, session });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
        redirect("/inventory?section=settings&notice=inventory-database");
    }
    revalidateInventoryViews();
    redirect("/inventory?section=settings&notice=inventory-tag-disabled");
}
export async function deactivateInventorySupplierAction(formData: FormData) {
    const session = await requireViewSession("inventory");
    const supplierId = requiredString(formData.get("supplierId"));
    try {
        await deactivateInventorySupplierCommand({ supplierId, session });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
        redirect("/inventory?section=settings&notice=inventory-database");
    }
    revalidateInventoryViews();
    redirect("/inventory?section=settings&notice=inventory-supplier-disabled");
}
export async function createInventoryItemAction(formData: FormData) {
    const session = await requireViewSession("inventory");
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
    const skuInput = optionalString(formData.get("sku"));
    const lotTrackedInput = requiredString(formData.get("lotTracked"));
    try {
        await createInventoryItemCommand({ session, supplierId, supplierName, groupId, tagIds, category, name, clinicId, skuInput, lotTrackedInput, unit, minimumStock, onHandQuantity, averageUnitCost });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
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
    const lotTrackedInput = requiredString(formData.get("lotTracked"));
    try {
        await updateInventoryItemCommand({ itemId, session, supplierId, supplierName, groupId, tagIds, clinicId, category, lotTrackedInput, name, unit, minimumStock, averageUnitCost });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
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
    const assetId = requiredString(formData.get("assetId"));
    const name = requiredString(formData.get("name"));
    const category = requiredString(formData.get("category")) || "Thiết bị";
    const status = normalizeAssetStatus(formData.get("status"));
    const clinicId = normalizeClinicId(formData.get("clinicId"), session);
    const purchasedAt = parseOptionalDate(formData.get("purchasedAt"));
    const warrantyEndsAt = parseOptionalDate(formData.get("warrantyEndsAt"));
    const serialNoInput = optionalString(formData.get("serialNo"));
    const costInput = parseMoney(formData.get("cost"));
    try {
        await updateEquipmentAssetCommand({ assetId, session, clinicId, serialNoInput, purchasedAt, costInput, warrantyEndsAt, name, category, status });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
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
    const itemId = requiredString(formData.get("itemId"));
    const type = normalizeMovementType(formData.get("type"));
    const quantity = parseMoney(formData.get("quantity"));
    const unitCost = parseMoney(formData.get("unitCost"));
    const referenceTypeInput = optionalString(formData.get("referenceType"));
    const referenceIdInput = optionalString(formData.get("referenceId"));
    const noteInput = optionalString(formData.get("note"));
    try {
        await recordInventoryMovementCommand({ itemId, session, type, quantity, referenceTypeInput, referenceIdInput, noteInput, unitCost });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
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
    const supplierId = requiredString(formData.get("supplierId"));
    const itemId = requiredString(formData.get("itemId"));
    const quantity = parseMoney(formData.get("quantity"));
    const unitCost = parseMoney(formData.get("unitCost"));
    const clinicId = normalizeClinicId(formData.get("clinicId"), session);
    const expectedAt = parseDateInVietnam(formData.get("expectedAt"));
    try {
        await createPurchaseOrderCommand({ supplierId, session, itemId, clinicId, quantity, unitCost, expectedAt });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
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
    const purchaseOrderId = requiredString(formData.get("purchaseOrderId"));
    const requestedReceiveQuantity = parseMoney(formData.get("receiveQuantity"));
    const lotNo = optionalString(formData.get("lotNo"));
    const expiresAt = parseDateInVietnam(formData.get("expiresAt"));
    try {
        await receivePurchaseOrderCommand({ purchaseOrderId, session, requestedReceiveQuantity, lotNo, expiresAt });
    }
    catch (error) {
        if (error instanceof ApplicationCommandError)
            redirect(`/inventory?notice=${encodeURIComponent(error.code)}`);
        reportApplicationError("app/(app)/inventory/actions", error);
        if (isNextRedirect(error)) {
            throw error;
        }
        redirect("/inventory?notice=inventory-database");
    }
    revalidateInventoryViews();
    redirect("/inventory?notice=inventory-po-received");
}
function normalizeTagIds(formData: FormData) {
    return Array.from(new Set(formData.getAll("tagIds").map((value) => requiredString(value)).filter(Boolean)));
}
function revalidateInventoryViews() {
    revalidatePath("/inventory");
    revalidatePath("/reports");
    revalidatePath("/dashboard");
}
function isNextRedirect(error: unknown) {
    return (typeof error === "object" &&
        error !== null &&
        "digest" in error &&
        String((error as {
            digest?: unknown;
        }).digest).startsWith("NEXT_REDIRECT"));
}
