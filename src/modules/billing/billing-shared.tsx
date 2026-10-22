"use client";
import { journeyServiceCatalogCode } from "@/lib/billing-presentation";




import { receiptMethodLabel } from "@/lib/billing-presentation";

import { padCodeNumber, patientCodeFor } from "@/lib/patient-presentation";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import { isCollectableInvoiceStatus } from "@/lib/billing-calculations";
import { formatVnd, type Appointment, type Invoice, type Patient } from "@/lib/data";
export type JourneyReceiptDraftStore = Record<string, {
    amount: string;
    method: JourneyCollectionMethod;
}>;
export type BillingJourneyServiceFilter = "all" | "needs_collection" | "has_invoice" | "partial_invoice" | "deposit" | "invoice_requested" | "no_invoice" | "complete" | "cancelled";
export type BillingPeriodFilter = "all" | "today" | "week" | "last_week" | "month" | "last_month";
export type BillingSection = "collection" | "invoices" | "receipts" | "balances" | "control";
export type BillingInvoiceFilter = "all" | "service_linked" | "standalone" | "open_balance" | "overdue" | "partial" | "paid" | "void";
export const billingJourneyServiceFilters: BillingJourneyServiceFilter[] = [
    "all",
    "needs_collection",
    "has_invoice",
    "partial_invoice",
    "deposit",
    "invoice_requested",
    "no_invoice",
    "complete",
    "cancelled",
];
export const statusText: Record<Language, Record<string, string>> = {
    vi: {
        Draft: "Nháp",
        Open: "Đang mở",
        Partial: "Thanh toán một phần",
        Paid: "Đã thanh toán",
        Overdue: "Quá hạn",
        Void: "Đã hủy",
        Cancelled: "Đã hủy",
        Planned: "Đã lên kế hoạch",
        "Planned (0%)": "Chưa bắt đầu",
        "In progress": "Đang thực hiện",
        "In progress (25%)": "Đang làm (25%)",
        "In progress (50%)": "Đang làm (50%)",
        "In progress (75%)": "Đang làm (75%)",
        Completed: "Hoàn tất",
    },
    en: {},
};
export function displayStatus(status: string, language: Language) {
    return statusText[language][status] ?? status;
}
export function StatusPill({ status }: {
    status: string;
}) {
    const { language } = useAppLanguage();
    return <BaseStatusPill label={displayStatus(status, language)} status={status}/>;
}
export function statementKindLabel(kind: string, language: Language) {
    const labels: Record<string, Record<Language, string>> = {
        CREDIT_BALANCE: { vi: "Điều chỉnh tiền dư", en: "Credit adjustment" },
        INVOICE: { vi: "Ghi nhận khoản phải thu", en: "Charge recorded" },
        PAYMENT: { vi: "Thanh toán hóa đơn", en: "Invoice payment" },
        RECEIPT: { vi: "Thu tiền", en: "Payment received" },
        SERVICE_CHARGE: { vi: "Dịch vụ cần thu", en: "Service charge" },
    };
    return labels[kind]?.[language] ?? displayStatus(kind, language);
}
export function statementBalanceLabel(balance: number, language: Language) {
    if (balance > 0) {
        return language === "vi"
            ? `Còn phải thu ${formatVnd(balance)}`
            : `Due ${formatVnd(balance)}`;
    }
    if (balance < 0) {
        return language === "vi"
            ? `Dư chưa phân bổ ${formatVnd(Math.abs(balance))}`
            : `Credit ${formatVnd(Math.abs(balance))}`;
    }
    return language === "vi" ? "Đã tất toán" : "Settled";
}
export function workspaceMessageText(message: string | null | undefined, language: Language) {
    if (!message || language !== "vi")
        return message;
    const viMessages: Record<string, string> = {
        "Chưa có dữ liệu trong phạm vi hiện tại.": "Chưa có bệnh nhân cần thu tiền trong phạm vi hiện tại.",
    };
    return viMessages[message] ?? message;
}
export function noticeText(notice: string | null, language: Language) {
    const notices: Record<string, Record<Language, string>> = {
        "billing-created": { vi: "Đã tạo hóa đơn.", en: "Invoice created." },
        "billing-payment-recorded": { vi: "Đã ghi nhận thanh toán.", en: "Payment recorded." },
        "billing-service-receipt-recorded": { vi: "Đã ghi nhận thu theo dịch vụ.", en: "Service collection recorded." },
        "billing-service-receipt-invoiced": { vi: "Đã ghi nhận thu và xuất hóa đơn.", en: "Service collection recorded and invoice issued." },
        "billing-service-invoice-issued": { vi: "Đã xuất hóa đơn từ khoản thu dịch vụ.", en: "Invoice issued from collected service funds." },
        "billing-adjusted": { vi: "Đã chỉnh số tiền hóa đơn.", en: "Invoice amount adjusted." },
        "billing-refund-recorded": { vi: "Đã ghi nhận hoàn tiền.", en: "Refund recorded." },
        "billing-plan-created": { vi: "Đã tạo nhắc thanh toán.", en: "Payment plan reminder created." },
        "billing-voided": { vi: "Đã hủy hóa đơn.", en: "Invoice voided." },
        "billing-denied": { vi: "Vai trò này không thể sửa thanh toán.", en: "This role cannot change billing records." },
        "billing-missing": { vi: "Cần chọn bệnh nhân và số tiền.", en: "Patient and amount are required." },
        "billing-bad-date": { vi: "Chọn hạn thanh toán hợp lệ.", en: "Select a valid due date." },
        "billing-bad-payment": { vi: "Nhập số tiền thanh toán hợp lệ.", en: "Enter a valid payment amount." },
        "billing-plan-missing": { vi: "Chọn bệnh nhân, số tiền và ngày nhắc.", en: "Select a patient, amount, and reminder date." },
        "billing-service-not-found": { vi: "Không tìm thấy dịch vụ điều trị trong phạm vi phòng khám này.", en: "The treatment service could not be found in this clinic scope." },
        "billing-no-credit-balance": { vi: "Không có tiền dư/chưa phân bổ.", en: "No unapplied patient balance is available." },
        "billing-no-invoiceable-amount": { vi: "Dịch vụ này không còn khoản thu chờ xuất hóa đơn.", en: "This service has no collected amount waiting for an invoice." },
        "billing-patient-not-found": { vi: "Không tìm thấy bệnh nhân trong phạm vi phòng khám này.", en: "The selected patient could not be found in this clinic scope." },
        "billing-invoice-not-found": { vi: "Không tìm thấy hóa đơn trong phạm vi phòng khám này.", en: "The invoice could not be found in this clinic scope." },
        "billing-database": { vi: "Chưa lưu được thay đổi thanh toán. Vui lòng thử lại sau.", en: "The billing change could not be saved. Check the data connection." },
    };
    return notice ? notices[notice]?.[language] ?? null : null;
}
export function useNoticeText(notice: string | null) {
    const { language } = useAppLanguage();
    return noticeText(notice, language);
}
export function vietnamDateKey(value: Date | string | number) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    return new Intl.DateTimeFormat("en-CA", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
    }).format(date);
}
export function vietnamDateParts(value: Date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
    }).formatToParts(value);
    const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return {
        day: getPart("day"),
        month: getPart("month"),
        year: getPart("year"),
    };
}
export function vietnamBillingPeriodRange(filter: BillingPeriodFilter, now = new Date()) {
    const todayKey = vietnamDateKey(now);
    const parts = vietnamDateParts(now);
    if (filter === "today") {
        return { endKey: todayKey, startKey: todayKey };
    }
    if (filter === "month" || filter === "last_month") {
        const monthIndex = parts.month - 1 + (filter === "last_month" ? -1 : 0);
        const startDate = new Date(Date.UTC(parts.year, monthIndex, 1));
        const endDate = new Date(Date.UTC(parts.year, monthIndex + 1, 0));
        return {
            endKey: endDate.toISOString().slice(0, 10),
            startKey: startDate.toISOString().slice(0, 10),
        };
    }
    const currentDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const dayOfWeek = currentDate.getUTCDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const startDate = new Date(currentDate);
    startDate.setUTCDate(currentDate.getUTCDate() + mondayOffset);
    if (filter === "last_week") {
        startDate.setUTCDate(startDate.getUTCDate() - 7);
    }
    const endDate = new Date(startDate);
    endDate.setUTCDate(startDate.getUTCDate() + 6);
    return {
        endKey: endDate.toISOString().slice(0, 10),
        startKey: startDate.toISOString().slice(0, 10),
    };
}
export function isDateKeyInRange(dateKey: string, range: {
    endKey: string;
    startKey: string;
}) {
    return Boolean(dateKey && dateKey >= range.startKey && dateKey <= range.endKey);
}
export function appointmentDateKey(appointment: Appointment) {
    return appointment.startsAt ? vietnamDateKey(appointment.startsAt) : vietnamDateKey(new Date());
}
export function appointmentIsCheckedIn(appointment: Appointment) {
    return ["Arrived", "In chair", "Completed"].includes(appointment.status);
}
export function isCollectableInvoice(invoice: Invoice) {
    return isCollectableInvoiceStatus(invoice.status);
}
export type JourneyReceiptMethod = "cash" | "card" | "bank_transfer";
export type JourneyCollectionMethod = JourneyReceiptMethod | "credit_balance";
export function isJourneyReceiptMethod(value: unknown): value is JourneyReceiptMethod {
    return value === "cash" || value === "card" || value === "bank_transfer";
}
export function isJourneyCollectionMethod(value: unknown): value is JourneyCollectionMethod {
    return isJourneyReceiptMethod(value) || value === "credit_balance";
}
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
export function journeyStableLedgerHash(value: string) {
    let hash = 0;
    for (const char of value) {
        hash = Math.imul(31, hash) + char.charCodeAt(0);
    }
    return String(hash >>> 0).padStart(10, "0");
}
export function journeyInvoiceIdForService(serviceId: string) {
    return `JRN-${journeyStableLedgerHash(serviceId)}`;
}
export function journeyReceiptIdForService(serviceId: string, collectedAt: number) {
    return `RCT-${journeyInvoiceIdForService(`${serviceId}-${collectedAt}`)}`;
}
export function journeyCreditAllocationIdForService(serviceId: string, allocatedAt: number) {
    return `CRA-${journeyInvoiceIdForService(`${serviceId}-${allocatedAt}`)}`;
}

export function collectionMethodLabel(method: JourneyCollectionMethod, language: Language) {
    if (method === "credit_balance") {
        return language === "vi" ? "Tiền dư/chưa phân bổ" : "Advance/unapplied";
    }
    return receiptMethodLabel(method, language);
}



export type JourneyServiceProgressEvent = {
    id: string;
    fromProgressPercent: number;
    toProgressPercent: number;
    progressDeltaPercent: number;
    performedByName: string;
    clinicalSupportName: string | null;
    assistantPrimaryName: string | null;
    assistantSecondaryName: string | null;
    note: string | null;
    occurredAt: string;
    occurredAtIso: string;
    totalCompensationAmount: number;
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
    source: "odontogram" | "plan" | "database";
};

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
export const billingText = {
    vi: {
        alert: "",
        allocateCredit: "Phân bổ tiền dư",
        allocationAmount: "Số tiền phân bổ",
        amountDue: "Còn phải thu",
        amountPaid: "Đã thu",
        amountTotal: "Tổng tiền",
        advancedTools: "Công cụ quản trị thanh toán",
        allocatedTotal: "Đã phân bổ",
        balance: "Tình trạng sau giao dịch",
        cancel: "Hủy",
        clearSearch: "Xóa tìm kiếm",
        collected: "Đã thu",
        collectionAmount: "Số tiền thu",
        collectionMethod: "Hình thức",
        collectionTitle: "Thu tiền theo dịch vụ điều trị",
        allocateAndInvoiceFromBalance: "Phân bổ & xuất hóa đơn",
        allocateFromBalance: "Phân bổ từ balance",
        patientBalanceTitle: "Balance bệnh nhân",
        patientReceiptTitle: "Ghi nhận tiền bệnh nhân nộp",
        complete: "Đã thu đủ",
        createInvoice: "Tạo hóa đơn",
        creditBalance: "Thu trước/chưa phân bổ",
        creditApplied: "Dùng từ tiền dư",
        creditAllocationHistory: "Lịch sử dùng tiền dư",
        tabBalances: "Công nợ & tiền dư",
        tabCollection: "Thu tiền",
        tabControl: "Kiểm soát",
        tabInvoices: "Hóa đơn",
        tabReceipts: "Phiếu thu",
        depositAllowed: "Có thể thu cọc",
        dueDate: "Hạn thanh toán",
        emptyInvoices: "Không có hóa đơn phù hợp",
        emptyServices: "Không có dịch vụ điều trị phù hợp",
        exportCsv: "Xuất CSV",
        filterAll: "Tất cả",
        filterCancelled: "Đã hủy",
        filterComplete: "Đã thu đủ",
        filterDeposit: "Đã cọc",
        filterHasInvoice: "Đã có hóa đơn",
        filterInvoiceRequested: "Chờ xuất hóa đơn",
        filterNeedsCollection: "Cần thu",
        filterNoInvoice: "Chưa hóa đơn",
        filterPartialInvoice: "Hóa đơn 1 phần",
        invoiceList: "Danh sách hóa đơn",
        invoiceComplete: "Đã đủ hóa đơn",
        invoiceCount: "hóa đơn",
        invoiceRequested: "Chờ xuất hóa đơn",
        invoiceStatus: "Hóa đơn",
        invoiceThisTime: "Hóa đơn lần này",
        invoiceTotal: "Hóa đơn dịch vụ đã xuất",
        minimumDue: "Cần thu tối thiểu",
        minimumDueHint: "Theo tiến độ Journey",
        openPatientBilling: "Mở thanh toán",
        patientBillingList: "Bệnh nhân cần theo dõi thanh toán",
        patientBillingEmpty: "Chưa có bệnh nhân có dịch vụ, hóa đơn hoặc phiếu thu trong phạm vi đang xem.",
        standaloneInvoiceTotal: "Hóa đơn độc lập/chưa gắn dịch vụ",
        issueInvoice: "Xuất hóa đơn",
        issueMissingInvoice: "Xuất phần chưa hóa đơn",
        issued: "Đã xuất",
        waitingForMoreCollection: "Chờ thu thêm",
        localInvoice: "Hóa đơn dịch vụ",
        manualInvoice: "Tạo hóa đơn thủ công",
        manualInvoiceHint: "Dùng cho khoản không đi từ dịch vụ điều trị.",
        metricScopeAll: "Số liệu tổng trong phạm vi phòng khám đang xem.",
        metricScopeFiltered: "Số liệu đang tính theo kết quả tìm kiếm hiện tại.",
        noInvoice: "Chưa xuất",
        noReceipts: "Chưa có phiếu thu trong phạm vi hiện tại",
        noUnappliedBalance: "Không có tiền dư/chưa phân bổ",
        openBalances: "Công nợ hóa đơn",
        overdueInvoices: "Hóa đơn quá hạn",
        paidAmount: "Số tiền trả",
        paidThroughInvoice: "Đã thu đến lần này",
        patient: "Bệnh nhân",
        partialInvoices: "Hóa đơn trả một phần",
        plannedDeposits: "Dịch vụ chưa bắt đầu đã cọc",
        print: "In",
        progress: "Tiến độ",
        receiptTotal: "Phiếu thu đã ghi nhận",
        recentReceipts: "Phiếu thu gần đây",
        recordCollection: "Thu thêm cho dịch vụ",
        recordDeposit: "Thu cọc",
        recordReceiptAndInvoice: "Ghi nhận thu và xuất hóa đơn",
        recordReceiptOnly: "Ghi nhận thu",
        recordServicePayment: "Thu thêm cho dịch vụ",
        recordPayment: "Ghi nhận",
        remainingAfterInvoice: "Còn lại sau lần này",
        remainingServices: "Dịch vụ đang làm còn phải thu",
        searchPlaceholder: "Tìm bệnh nhân, dịch vụ, răng, hóa đơn",
        searchSummary: "",
        serviceReady: "Cần thu theo tiến độ",
        serviceTitle: "Dịch vụ",
        backToPatients: "Danh sách bệnh nhân",
        statementCredit: "Tiền đã nhận",
        statementDebit: "Phát sinh cần thu",
        subtitle: "",
        title: "Thanh toán",
        unappliedBalance: "Tiền dư/chưa phân bổ",
        workflow: "Thanh toán",
    },
    en: {
        alert: "",
        allocateCredit: "Allocate credit",
        allocationAmount: "Allocation amount",
        amountDue: "Balance due",
        amountPaid: "Collected",
        amountTotal: "Total amount",
        advancedTools: "Billing administration tools",
        allocatedTotal: "Allocated",
        balance: "Balance after",
        cancel: "Void",
        clearSearch: "Clear search",
        collected: "Collected",
        collectionAmount: "Collection amount",
        collectionMethod: "Method",
        collectionTitle: "Treatment service collections",
        allocateAndInvoiceFromBalance: "Allocate & invoice",
        allocateFromBalance: "Allocate from balance",
        patientBalanceTitle: "Patient balance",
        patientReceiptTitle: "Record patient payment",
        complete: "Fully collected",
        createInvoice: "Create invoice",
        creditBalance: "Advance/unapplied",
        creditApplied: "Used from credit",
        creditAllocationHistory: "Credit usage history",
        tabBalances: "Balances & credit",
        tabCollection: "Collection",
        tabControl: "Control",
        tabInvoices: "Invoices",
        tabReceipts: "Receipts",
        depositAllowed: "Deposit allowed",
        dueDate: "Due date",
        emptyInvoices: "No matching invoices",
        emptyServices: "No matching treatment services",
        exportCsv: "Export CSV",
        filterAll: "All",
        filterCancelled: "Cancelled",
        filterComplete: "Fully collected",
        filterDeposit: "Deposited",
        filterHasInvoice: "Has invoice",
        filterInvoiceRequested: "Invoice requested",
        filterNeedsCollection: "Needs collection",
        filterNoInvoice: "No invoice",
        filterPartialInvoice: "Partial invoice",
        invoiceList: "Invoice list",
        invoiceComplete: "Fully invoiced",
        invoiceCount: "invoices",
        invoiceRequested: "Invoice requested",
        invoiceStatus: "Invoice",
        invoiceThisTime: "This invoice",
        invoiceTotal: "Issued service invoices",
        minimumDue: "Minimum due",
        minimumDueHint: "By Journey progress",
        openPatientBilling: "Open billing",
        patientBillingList: "Patients with billing activity",
        patientBillingEmpty: "No patients have services, invoices, or receipts in this scope.",
        standaloneInvoiceTotal: "Standalone/unlinked invoices",
        issueInvoice: "Issue invoice",
        issueMissingInvoice: "Issue uninvoiced part",
        issued: "Issued",
        waitingForMoreCollection: "Waiting for collection",
        localInvoice: "Service invoice",
        manualInvoice: "Create manual invoice",
        manualInvoiceHint: "Use for charges that do not originate from treatment services.",
        metricScopeAll: "Metrics cover the current clinic scope.",
        metricScopeFiltered: "Metrics are calculated from the current search results.",
        noInvoice: "Not issued",
        noReceipts: "No receipts in the current scope",
        noUnappliedBalance: "No unapplied balance",
        openBalances: "Open invoice balance",
        overdueInvoices: "Overdue invoices",
        paidAmount: "Payment amount",
        paidThroughInvoice: "Collected to this invoice",
        partialInvoices: "Partial invoices",
        patient: "Patient",
        plannedDeposits: "Planned services with deposits",
        print: "Print",
        progress: "Progress",
        receiptTotal: "Recorded receipts",
        recentReceipts: "Recent receipts",
        recordCollection: "Add service payment",
        recordDeposit: "Record deposit",
        recordReceiptAndInvoice: "Record collection and issue invoice",
        recordReceiptOnly: "Record collection",
        recordServicePayment: "Add service payment",
        recordPayment: "Record",
        remainingAfterInvoice: "Remaining after this invoice",
        remainingServices: "Started services still due",
        searchPlaceholder: "Search patient, service, tooth, invoice",
        searchSummary: "",
        serviceReady: "Collect by progress",
        serviceTitle: "Service",
        backToPatients: "Patient list",
        statementCredit: "Payment",
        statementDebit: "Charge",
        subtitle: "",
        title: "Billing",
        unappliedBalance: "Unapplied balance",
        workflow: "Billing",
    },
} as const;

export { padCodeNumber, stableNumberFromText, patientCodeFor, patientClassCodeFor } from "@/lib/patient-presentation";
export { serviceProgressPercent, serviceProgressIsCancelled, serviceProgressLabelFromPercent } from "@/lib/service-presentation";
export { normalizeSearchText } from "@/shared/search";

export { matchesChartSearch } from "@/shared/search";

export { receiptMethodLabel } from "@/lib/billing-presentation";

export { normalizeCodeText } from "@/lib/billing-presentation";

export { legacyServiceCatalogCodes } from "@/lib/billing-presentation";

export { serviceCatalogCodeFromName } from "@/lib/billing-presentation";

export { journeyServiceCatalogCode } from "@/lib/billing-presentation";
