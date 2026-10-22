import "server-only";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import { parseDateInVietnam, requiredString, } from "@/lib/form-validation";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
export async function uniqueSupplierCode(organizationId: string, codeBase: string) {
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
export function supplierCodeBase(value: string) {
    const normalized = value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 18);
    return normalized || "NCC";
}
export async function resolveScopedSupplier(session: AppSession, supplierId: string | null, supplierName: string | null) {
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
export function findScopedSupplier(session: AppSession, supplierId: string) {
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
export function parseSupplierInput(value: string | null) {
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
export function resolveScopedItemGroup(session: AppSession, groupId: string | null) {
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
export function resolveScopedTags(session: AppSession, tagIds: string[]) {
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
export async function uniqueInventoryItemCode(organizationId: string, codeBase: string) {
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
export function normalizedCode(value: string) {
    return value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
}
export async function syncInventoryItemTags(session: AppSession, itemId: string, tagIds: string[]) {
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
        ...tagIds.map((tagId) => prisma.inventoryItemTag.upsert({
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
        })),
    ]);
}
export function allowedClinicIds(session: AppSession) {
    if (canUseAllClinics(session)) {
        return accessibleClinicIds(session);
    }
    return session.activeClinicId ? [session.activeClinicId] : accessibleClinicIds(session);
}
export function signedMovementQuantity(type: (typeof movementTypes)[number], quantity: number) {
    if (type === "PURCHASE" || type === "TRANSFER_IN" || type === "RETURN") {
        return quantity;
    }
    if (type === "ADJUSTMENT") {
        return 0;
    }
    return -quantity;
}
export const movementTypes = [
    "PURCHASE",
    "TRANSFER_IN",
    "TRANSFER_OUT",
    "CONSUMPTION",
    "ADJUSTMENT",
    "WASTE",
    "RETURN",
] as const;
export function resolveInventoryClinicId(session: AppSession, ...clinicIds: Array<string | null | undefined>) {
    return clinicIds.find((clinicId): clinicId is string => Boolean(clinicId))
        ?? session.activeClinicId
        ?? accessibleClinicIds(session)[0]
        ?? null;
}
export async function nextPurchaseOrderNo(organizationId: string) {
    const count = await prisma.purchaseOrder.count({
        where: {
            organizationId,
        },
    });
    return `PO-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;
}
export const assetStatuses = ["ACTIVE", "MAINTENANCE", "RETIRED", "LOST"] as const;
export function normalizeMovementType(value: (string | File) | null) {
    const parsed = requiredString(value);
    return movementTypes.find((type) => type === parsed) ?? null;
}
export function normalizeAssetStatus(value: (string | File) | null) {
    const parsed = requiredString(value);
    return assetStatuses.find((status) => status === parsed) ?? null;
}
export function parseOptionalDate(value: (string | File) | null) {
    if (!requiredString(value)) {
        return null;
    }
    return parseDateInVietnam(value);
}
export function normalizeClinicId(value: (string | File) | null, session: AppSession) {
    const parsed = requiredString(value);
    if (!parsed || parsed === "all") {
        return canUseAllClinics(session) ? "all" : session.activeClinicId ?? "denied";
    }
    return accessibleClinicIds(session).includes(parsed) ? parsed : "denied";
}
