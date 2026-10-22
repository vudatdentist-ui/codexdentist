"use client";
import { journeyServiceCatalogCode } from "@/lib/billing-presentation";




import { receiptMethodLabel } from "@/lib/billing-presentation";

import { padCodeNumber, patientCodeFor } from "@/lib/patient-presentation";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import { invoiceBalanceAmount, isCollectableInvoiceStatus } from "@/lib/billing-calculations";
import { type Invoice, type Patient } from "@/lib/data";
import { formatJourneyTimelineDay, journeyTimelineDayKey } from "@/lib/journey-timeline";
import type { ServiceStepSummary } from "@/lib/services-types";
import { type DentalServiceCatalogItem } from "@/lib/service-catalog";
export const statusText: Record<Language, Record<string, string>> = {
    vi: {
        "Active": "Đang hoạt động",
        "Inactive": "Ngừng hoạt động",
        "Accepted": "Đã chấp nhận",
        "All": "Tất cả",
        "Arrived": "Đã đến",
        "Billing": "Thanh toán",
        "Cancelled": "Đã hủy",
        "Clinical": "Khám",
        "Comment": "Bình luận",
        "Completed": "Hoàn tất",
        "Completed (100%)": "Hoàn tất (100%)",
        "Confirmed": "Đã xác nhận",
        "Declined": "Từ chối",
        "Draft": "Nháp",
        "File": "Tệp",
        "Files": "Hồ sơ",
        "Granted": "Đã đồng ý",
        "In chair": "Đang trên ghế",
        "In progress": "Đang thực hiện",
        "In Progress": "Đang thực hiện",
        "Locked": "Đã khóa",
        "No show": "Không đến",
        "None": "Không có",
        "Needs renewal": "Cần gia hạn",
        "Open": "Đang mở",
        "Overdue": "Quá hạn",
        "Paid": "Đã thanh toán",
        "Partial": "Thanh toán một phần",
        "Plan": "Kế hoạch",
        "Planned": "Đã lên kế hoạch",
        "Planned (0%)": "Đã lên kế hoạch (0%)",
        "Presented": "Đã trình bày",
        "Requested": "Đã yêu cầu",
        "Session": "Buổi hẹn",
        "Step 1 (20%)": "Bước 1 (20%)",
        "Step 2 (40%)": "Bước 2 (40%)",
        "Step 3 (55%)": "Bước 3 (55%)",
        "Step 4 (70%)": "Bước 4 (70%)",
        "Treatment": "Điều trị",
        "Void": "Đã hủy",
        "NEW": "Mới",
        "CONTACTED": "Đã liên hệ",
        "CONSULT_BOOKED": "Đã hẹn tư vấn",
        "VISITED": "Đã đến",
        "CONVERTED": "Đã chuyển đổi",
        "LOST": "Mất lead",
        "RECALL": "Recall",
        "CALL": "Gọi điện",
        "ZALO": "Zalo",
        "SMS": "SMS",
        "EMAIL": "Email",
        "NOTE": "Ghi chú",
        "TASK": "Công việc",
        "FOLLOW_UP": "Chăm sóc tiếp",
        "PHONE": "Điện thoại",
        "IN_APP": "Trong app",
        "PUSH": "Push",
        "PURCHASE": "Nhập mua",
        "CONSUMPTION": "Tiêu hao",
        "WASTE": "Hủy/hỏng",
        "TRANSFER_IN": "Chuyển vào",
        "TRANSFER_OUT": "Chuyển ra",
        "RETURN": "Hoàn trả",
        "SCHEDULED": "Đã xếp ca",
        "APPROVED": "Đã duyệt",
        "PAID": "Đã chi trả",
        "EARNED": "Đã phát sinh",
        "REQUESTED": "Đã yêu cầu",
        "REJECTED": "Từ chối",
        "CLOSED": "Đã đóng",
        "NORMAL": "Bình thường",
        "ASSIGNED": "Đã giao",
        "IN_PROGRESS": "Đang học",
        "COMPLETED": "Hoàn tất",
        "BOOK": "Sách",
        "ARTICLE": "Bài viết",
        "VIDEO": "Video",
        "COURSE": "Khóa học",
        "CHECKLIST": "Checklist",
        "POLICY": "Quy trình",
        "ORDERED": "Đã đặt",
        "RECEIVED": "Đã nhận",
        "LOW_STOCK": "Sắp hết",
        "DRAFT": "Nháp",
        "PUBLISHED": "Đã xuất bản",
        "SIGNED": "Đã ký",
        "DISPENSED": "Đã cấp thuốc",
        "SENT": "Đã gửi",
        "FAILED": "Lỗi gửi",
        "EXPIRED": "Hết hạn",
        "VOID": "Đã hủy",
        "CANCELLED": "Đã hủy",
        "INVOICE": "Hóa đơn",
        "PAYMENT": "Thanh toán",
        "RECEIPT": "Phiếu thu",
        "CREDIT_BALANCE": "Tiền dư",
        "crm": "CSKH",
        "billing": "Thanh toán",
        "inventory": "Kho",
        "hr": "Nhân sự",
        "schedule": "Lịch hẹn",
        "learning": "Đào tạo",
        "notification": "Thông báo",
        "high": "Cao",
        "medium": "Vừa",
        "low": "Thấp",
        "OPEN": "Đang mở",
        "DONE": "Hoàn tất",
        "ACTIVE": "Đang hoạt động",
        "INACTIVE": "Ngừng hoạt động",
        "MAINTENANCE": "Đang bảo trì",
        "RETIRED": "Ngừng sử dụng",
        "PARTIAL": "Một phần",
        "OK": "Trong ngưỡng",
        "WATCH": "Cần theo dõi",
        "OVER": "Vượt ngưỡng",
        "INFO": "Thông tin",
        "INCOME": "Thu",
        "EXPENSE": "Chi",
        "TRANSFER": "Chuyển khoản",
        "critical": "Nghiêm trọng",
        "watch": "Cần theo dõi",
        "info": "Thông tin",
    },
    en: {},
};
export function displayStatus(status: string, language: Language) {
    return statusText[language][status] ?? status;
}
export function statusClass(status: string) {
    return status.toLowerCase().replace(/\s+/g, "-");
}
export function StatusPill({ status }: {
    status: string;
}) {
    const { language } = useAppLanguage();
    return <BaseStatusPill label={displayStatus(status, language)} status={status}/>;
}
export function formatFileSize(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}
export function timelineFileKind(fileName: string | null | undefined, mimeType: string | null | undefined) {
    const lowerName = (fileName ?? "").toLowerCase();
    const lowerMime = (mimeType ?? "").toLowerCase();
    if (lowerMime.startsWith("image/")) {
        return "image";
    }
    if (lowerMime === "application/pdf" || lowerName.endsWith(".pdf")) {
        return "pdf";
    }
    if (lowerMime.startsWith("video/") || /\.(mp4|mov)$/.test(lowerName)) {
        return "video";
    }
    if (lowerMime.startsWith("model/") || /\.(3mf|glb|gltf|obj|ply|stl|zip)$/.test(lowerName)) {
        return "model3d";
    }
    return "document";
}
export function timelineFileKindLabel(kind: string | null | undefined, language: Language) {
    const labels: Record<string, Record<Language, string>> = {
        document: { en: "Document", vi: "Tài liệu" },
        image: { en: "Image", vi: "Ảnh" },
        model3d: { en: "3D file", vi: "File 3D" },
        pdf: { en: "PDF", vi: "PDF" },
        video: { en: "Video", vi: "Video" },
    };
    return kind ? labels[kind]?.[language] ?? kind : "";
}
export function noticeText(notice: string | null, language: Language) {
    const notices: Record<string, Record<Language, string>> = {
        "clinical-created": {
            vi: "Đã thêm thông tin khám và kế hoạch vào timeline.",
            en: "Exam information and treatment plan added to the timeline.",
        },
        "clinical-locked": { vi: "Đã hoàn tất ghi chú khám.", en: "Clinical note completed." },
        "journey-service-created": { vi: "Đã tạo dịch vụ điều trị trong timeline bệnh nhân.", en: "Treatment service created in the patient timeline." },
        "journey-discount-updated": { vi: "Đã cập nhật giảm giá dịch vụ.", en: "Service discount updated." },
        "journey-service-deleted": { vi: "Đã xóa dịch vụ điều trị.", en: "Treatment service deleted." },
        "journey-progress-recorded": { vi: "Đã ghi nhận tiến độ dịch vụ.", en: "Service progress recorded." },
        "journey-state-saved": {
            vi: "Đã lưu mục tiêu và kế hoạch điều trị.",
            en: "Treatment goals and plan saved.",
        },
        "journey-comment-created": { vi: "Đã lưu comment Journey.", en: "Journey comment saved." },
        "journey-denied": { vi: "Vai trò này không thể sửa timeline bệnh nhân.", en: "This role cannot change the patient timeline." },
        "journey-service-missing": { vi: "Chọn bệnh nhân, dịch vụ và đối tượng điều trị.", en: "Select a patient, service, and treatment target." },
        "journey-state-missing": { vi: "Chọn bệnh nhân trước khi lưu bệnh án.", en: "Select a patient before saving the journey record." },
        "journey-comment-missing": { vi: "Nhập comment trước khi lưu.", en: "Enter a comment before saving." },
        "journey-progress-missing": { vi: "Chọn tiến độ và nhân sự thực hiện.", en: "Select progress and the staff member who performed the service." },
        "journey-progress-regression": { vi: "Không thể giảm tiến độ từ workflow này.", en: "Service progress cannot be moved backward from this workflow." },
        "journey-service-delete-locked": { vi: "Dịch vụ đã có tiến độ, hóa đơn hoặc thu tiền nên không thể xóa trực tiếp.", en: "This service already has progress, invoice, or payment activity and cannot be deleted directly." },
        "journey-service-price-locked": { vi: "Dịch vụ đã có thu tiền hoặc hóa đơn nên không thể sửa giảm giá trực tiếp.", en: "This service already has payment or invoice activity, so discount cannot be changed directly." },
        "journey-database": { vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.", en: "The change could not be saved. Please try again." },
        "files-created": { vi: "Đã lưu tài liệu bệnh nhân.", en: "Patient file saved." },
        "files-governance-updated": { vi: "Đã cập nhật kiểm soát tài liệu bệnh nhân.", en: "Patient file controls updated." },
    };
    return notice ? notices[notice]?.[language] ?? null : null;
}
export function useNoticeText(notice: string | null) {
    const { language } = useAppLanguage();
    return noticeText(notice, language);
}
export function invoiceBalance(invoice: Invoice) {
    return invoiceBalanceAmount(invoice.amount, invoice.paidAmount);
}
export function isCollectableInvoice(invoice: Invoice) {
    return isCollectableInvoiceStatus(invoice.status);
}
export type JourneyReceiptMethod = "cash" | "card" | "bank_transfer";
export type JourneyReceipt = {
    id: string;
    serviceId: string;
    patientId: string;
    patient: string;
    clinicId: string;
    amount: number;
    method: JourneyReceiptMethod;
    collectedAt: number;
};
export type JourneyCreditAllocation = {
    id: string;
    toServiceId: string;
    patientId: string;
    patient: string;
    clinicId: string;
    amount: number;
    allocatedAt: number;
};

export function receiptMethodLabelForBilling(method: string, language: Language) {
    if (method === "cash" || method === "card" || method === "bank_transfer") {
        return receiptMethodLabel(method, language);
    }
    const labels: Record<string, Record<Language, string>> = {
        credit_balance: { vi: "Tiền dư/chưa phân bổ", en: "Credit balance" },
        service_receipt: { vi: "Phiếu thu dịch vụ", en: "Service receipt" },
    };
    return labels[method]?.[language] ?? method;
}
export const archTargets = [
    { id: "ARCH_UPPER", label: "HÀM TRÊN", labelEn: "UPPER ARCH" },
    { id: "ARCH_LOWER", label: "HÀM DƯỚI", labelEn: "LOWER ARCH" },
    { id: "ARCH_BOTH", label: "HAI HÀM", labelEn: "BOTH ARCHES" },
    { id: "TOOTH_GROUP", label: "NHÓM RĂNG", labelEn: "TOOTH GROUP" },
] as const;
export const archTargetIds: ReadonlySet<string> = new Set(archTargets.map((target) => target.id));
export function isArchTarget(target: string) {
    return archTargetIds.has(target);
}
export function isToothTarget(target: string) {
    return /^R\d{2}$/.test(target);
}
export function treatmentTargetLabel(target: string, language: Language = "vi") {
    const archTarget = archTargets.find((candidate) => candidate.id === target);
    if (!archTarget) {
        return target;
    }
    return language === "en" ? archTarget.labelEn : archTarget.label;
}
export function serviceTargetsFromSelection(targets: string[], language: Language) {
    const toothTargets = targets.filter(isToothTarget);
    const archTargetLabels = targets
        .filter((target) => isArchTarget(target) && target !== "TOOTH_GROUP")
        .map((target) => treatmentTargetLabel(target, language));
    if (targets.includes("TOOTH_GROUP")) {
        return toothTargets.length > 0 ? [toothTargets.join(", ")] : [];
    }
    return [
        ...archTargetLabels,
        ...toothTargets.map((target) => treatmentTargetLabel(target, language)),
    ];
}



export const serviceProgressOptions = [
    "Planned (0%)",
    "In progress",
    "Step 1 (20%)",
    "Step 2 (40%)",
    "Step 3 (55%)",
    "Step 4 (70%)",
    "Completed (100%)",
    "Cancelled",
];
export function serviceProgressPercentOptions(currentPercent: number, steps: ServiceStepSummary[] = []) {
    const stepPercents = steps
        .map((step) => step.defaultProgress)
        .filter((percent): percent is number => Number.isFinite(percent ?? NaN));
    return Array.from(new Set([
        0,
        ...(stepPercents.length > 0 ? stepPercents : [10, 20, 40, 55, 70]),
        100,
        Math.round(currentPercent),
    ])).sort((left, right) => left - right);
}
export type JourneyServiceProgressEvent = {
    id: string;
    fromProgressPercent: number;
    toProgressPercent: number;
    progressDeltaPercent: number;
    consultantName: string | null;
    performedByName: string;
    clinicalSupportName: string | null;
    assistantPrimaryName: string | null;
    assistantSecondaryName: string | null;
    note: string | null;
    occurredAt: string;
    occurredAtIso: string;
    totalCompensationAmount: number;
};
export type PendingProgressUpdate = {
    serviceId: string;
    clinicId: string;
    consultantId: string | null;
    serviceLabel: string;
    serviceName: string;
    fromProgressPercent: number;
    toProgressPercent: number;
    steps: ServiceStepSummary[];
};
export type JourneyServiceRow = {
    id: string;
    patientId: string;
    patientName?: string;
    clinicId?: string;
    serviceCode?: string;
    catalogItemId?: string;
    catalogCode?: string;
    createdAt?: number;
    createdBy?: string;
    createdById?: string;
    compensationRuleId?: string | null;
    compensationRuleName?: string | null;
    object: string;
    diagnosis: string;
    serviceName: string;
    progress: string;
    listPrice: number;
    discount: number;
    finalPrice: number;
    collectedAmount?: number;
    creditAllocatedAmount?: number;
    invoicedAmount?: number;
    invoiceNos?: string[];
    invoiceCreatedAt?: number;
    invoiceId?: string;
    invoiceIds?: string[];
    patientRequestedInvoice?: boolean;
    progressEvents?: JourneyServiceProgressEvent[];
    progressSteps?: ServiceStepSummary[];
    source: "odontogram" | "plan" | "database";
};
export type JourneyServiceCatalogOption = {
    id: string;
    code: string;
    category: DentalServiceCatalogItem["category"];
    name: string;
    nameEn: string;
    price: number;
    compensationRuleId?: string | null;
    compensationRuleName?: string | null;
};
export function serviceCatalogOptionName(service: Pick<JourneyServiceCatalogOption, "name" | "nameEn">, language: Language) {
    return language === "en" ? service.nameEn || service.name : service.name;
}

export function serviceSequenceFromInstanceCode(serviceCode: string | undefined, catalogCode: string) {
    if (!serviceCode) {
        return null;
    }
    const match = serviceCode.match(new RegExp(`${catalogCode}(\\d{2,})$`));
    return match?.[1] ? Number(match[1]) : null;
}
export function nextServiceSequence(services: JourneyServiceRow[], patientId: string, catalogCode: string) {
    let maxSequence = 0;
    services.forEach((service) => {
        if (service.patientId !== patientId ||
            journeyServiceCatalogCode(service) !== catalogCode) {
            return;
        }
        const parsedSequence = serviceSequenceFromInstanceCode(service.serviceCode, catalogCode);
        maxSequence = Math.max(maxSequence, parsedSequence ?? maxSequence + 1);
    });
    return maxSequence + 1;
}
export function createServiceInstanceCode(patient: Pick<Patient, "id" | "patientCode"> | null | undefined, catalogCode: string, sequence: number) {
    return `${patientCodeFor(patient)}-${catalogCode}${padCodeNumber(sequence, 2)}`;
}
export function formatServiceInstanceCode(serviceCode: string) {
    const [patientCode, servicePart] = serviceCode.split("-");
    return patientCode && servicePart ? `${patientCode} • ${servicePart}` : serviceCode;
}
export function displayServiceInstanceCode(service: JourneyServiceRow, patient: Pick<Patient, "id" | "patientCode"> | null | undefined) {
    const catalogCode = journeyServiceCatalogCode(service);
    const serviceCode = service.serviceCode ?? createServiceInstanceCode(patient, catalogCode, 1);
    return formatServiceInstanceCode(serviceCode);
}
export type JourneyTreatmentDraft = {
    goal: string;
    plan: string;
};
export type JourneyTreatmentDraftStore = Record<string, JourneyTreatmentDraft>;
export type JourneyComment = {
    id: string;
    patientId: string;
    author: string;
    body: string;
    createdAt: number;
    attachments?: JourneyTimelineAttachment[];
    imageName?: string;
    imageUrl?: string;
};
export type JourneyTimelineAttachment = {
    id: string;
    url: string;
    name: string | null;
    mimeType: string | null;
    fileKind?: string | null;
    previewUrl?: string | null;
    sizeBytes?: number | null;
    thumbnailUrl?: string | null;
};
export type JourneyTimelineEvent = {
    group: "Session" | "Clinical" | "Treatment" | "Billing" | "Files";
    id: string;
    kind: string;
    label: string;
    sortMs: number;
    status: string;
    title: string;
    detail: string;
    attachments?: JourneyTimelineAttachment[];
    fileUrl?: string;
    patientFileGovernance?: {
        fileId: string;
        retentionUntilIso: string | null;
        virusScanStatus: string;
    };
    imageName?: string;
    imageUrl?: string;
};
export type JourneyTimelineDayGroup = {
    id: string;
    label: string;
    events: JourneyTimelineEvent[];
};
export function groupJourneyTimelineEvents(events: JourneyTimelineEvent[], language: Language) {
    const groups = new Map<string, JourneyTimelineDayGroup>();
    for (const event of events) {
        const dayKey = journeyTimelineDayKey(event.sortMs);
        const current = groups.get(dayKey);
        if (current) {
            current.events.push(event);
            continue;
        }
        groups.set(dayKey, {
            id: dayKey,
            label: formatJourneyTimelineDay(event.sortMs, language),
            events: [event],
        });
    }
    return Array.from(groups.values());
}
export const journeyTimelineFilters = [
    "All",
    "Session",
    "Clinical",
    "Treatment",
    "Billing",
    "Files",
] as const;
export type JourneyTimelineFilter = (typeof journeyTimelineFilters)[number];

export function splitClinicalObjective(objective: string | null | undefined) {
    const fields = {
        objective: "",
        medicalHistory: "",
        temperature: "",
        bloodPressure: "",
        heartRate: "",
    };
    let remaining = objective?.trim() ?? "";
    const historyMatch = remaining.match(/(?:^|\n\n)Bệnh sử:\s*([\s\S]*?)(?=\n\nSinh hiệu:|$)/);
    if (historyMatch) {
        fields.medicalHistory = historyMatch[1].trim();
        remaining = remaining.replace(historyMatch[0], "").trim();
    }
    const vitalsMatch = remaining.match(/(?:^|\n\n)Sinh hiệu:\s*([\s\S]*?)$/);
    if (vitalsMatch) {
        const vitals = vitalsMatch[1];
        fields.temperature = vitals.match(/Nhiệt độ:\s*([^;\n]+)/)?.[1]?.trim() ?? "";
        fields.bloodPressure = vitals.match(/Huyết áp:\s*([^;\n]+)/)?.[1]?.trim() ?? "";
        fields.heartRate =
            vitals.match(/(?:Mạch|Nhịp tim):\s*([^;\n]+)/)?.[1]?.trim() ?? "";
        remaining = remaining.replace(vitalsMatch[0], "").trim();
    }
    fields.objective = remaining;
    return fields;
}
export function patientInitials(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "P";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return `${first}${last}`.toUpperCase();
}
export function journeyDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        dateStyle: "short",
    }).format(date);
}
export { padCodeNumber, stableNumberFromText, patientCodeFor, patientClassCodeFor } from "@/lib/patient-presentation";
export { serviceProgressIsCancelled, serviceProgressPercent, serviceProgressLabelFromPercent } from "@/lib/service-presentation";
export { normalizeSearchText } from "@/shared/search";
export { journeyText } from "./journey-copy";

export { matchesChartSearch } from "@/shared/search";

export { receiptMethodLabel } from "@/lib/billing-presentation";

export { normalizeCodeText } from "@/lib/billing-presentation";

export { legacyServiceCatalogCodes } from "@/lib/billing-presentation";

export { serviceCatalogCodeFromName } from "@/lib/billing-presentation";

export { journeyServiceCatalogCode } from "@/lib/billing-presentation";
