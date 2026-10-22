import type { Language } from "@/components/AppLanguage";
import { serviceCatalog as serviceLibrary } from "@/lib/service-catalog";
type JourneyReceiptMethod = "cash" | "card" | "bank_transfer";

export function receiptMethodLabel(method: JourneyReceiptMethod, language: Language) {
    if (language === "vi") {
        const labels: Record<JourneyReceiptMethod, string> = {
            bank_transfer: "Chuyển khoản",
            card: "Thẻ",
            cash: "Tiền mặt",
        };
        return labels[method];
    }
    const labels: Record<JourneyReceiptMethod, string> = {
        bank_transfer: "Bank transfer",
        card: "Card",
        cash: "Cash",
    };
    return labels[method];
}

export function normalizeCodeText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

export const legacyServiceCatalogCodes: Record<string, string> = {
    [normalizeCodeText("Cạo vôi và đánh bóng")]: "LCR",
    [normalizeCodeText("Scaling and polishing")]: "LCR",
    [normalizeCodeText("Phục hình mão sứ")]: "MSU",
    [normalizeCodeText("Ceramic crown restoration")]: "MSU",
    [normalizeCodeText("Chỉnh nha")]: "CHN",
    [normalizeCodeText("Orthodontics")]: "CHN",
};

export function serviceCatalogCodeFromName(serviceName: string) {
    const normalizedName = normalizeCodeText(serviceName);
    const legacyCode = legacyServiceCatalogCodes[normalizedName];
    if (legacyCode) {
        return legacyCode;
    }
    const match = serviceLibrary.find((service) => normalizeCodeText(service.name) === normalizedName ||
        normalizeCodeText(service.nameEn) === normalizedName);
    return match?.code ?? "SV";
}

export function journeyServiceCatalogCode(service: { catalogCode?: string; serviceCode?: string; serviceName: string }) {
    if (service.catalogCode) {
        return service.catalogCode;
    }
    if (service.serviceCode) {
        const match = service.serviceCode.match(/-([A-Z0-9]+)\d{2,}$/);
        if (match?.[1]) {
            return match[1];
        }
    }
    return serviceCatalogCodeFromName(service.serviceName);
}
