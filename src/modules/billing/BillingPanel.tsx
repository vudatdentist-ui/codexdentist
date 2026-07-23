"use client";

import { Bell, CreditCard, Download, FileText, Printer, Search, UsersRound, WalletCards } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import {
  adjustInvoiceAmountAction,
  createInvoiceAction,
  createPaymentPlanAction,
  createPaymentPlanReminderAction,
  issueServiceInvoiceAction,
  recordPatientReceiptAction,
  recordInvoiceRefundAction,
  recordPaymentAction,
  recordServiceReceiptAction,
  recordServiceReceiptAndInvoiceAction,
  voidInvoiceAction,
} from "@/app/(app)/billing/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { MoneyInput } from "@/components/MoneyInput";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, MetricCard, PanelHeader, RecordTile, StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import {
  cappedPaidAmount,
  invoiceBalanceAmount,
  isCollectableInvoiceStatus,
  serviceAppliedAmount as calculateServiceAppliedAmount,
  serviceBillableCollectedAmount as calculateServiceBillableCollectedAmount,
  serviceRemainingInvoiceCapacity as calculateServiceRemainingInvoiceCapacity,
  serviceUninvoicedAmount as calculateServiceUninvoicedAmount,
} from "@/lib/billing-calculations";
import { formatVnd, type Appointment, type Clinic, type Invoice, type Patient } from "@/lib/data";
import type { BillingWorkspace } from "@/lib/billing-types";
import {
  serviceCatalog as serviceLibrary,
  type DentalServiceCatalogItem,
} from "@/lib/service-catalog";

type JourneyReceiptDraftStore = Record<
  string,
  {
    amount: string;
    method: JourneyCollectionMethod;
  }
>;

type BillingJourneyServiceFilter =
  | "all"
  | "needs_collection"
  | "has_invoice"
  | "partial_invoice"
  | "deposit"
  | "invoice_requested"
  | "no_invoice"
  | "complete"
  | "cancelled";

type BillingPeriodFilter = "all" | "today" | "week" | "last_week" | "month" | "last_month";
type BillingSection = "collection" | "invoices" | "receipts" | "balances" | "control";
type BillingInvoiceFilter =
  | "all"
  | "service_linked"
  | "standalone"
  | "open_balance"
  | "overdue"
  | "partial"
  | "paid"
  | "void";

const billingJourneyServiceFilters: BillingJourneyServiceFilter[] = [
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

const statusText: Record<Language, Record<string, string>> = {
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

function displayStatus(status: string, language: Language) {
  return statusText[language][status] ?? status;
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();
  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}

function statementKindLabel(kind: string, language: Language) {
  const labels: Record<string, Record<Language, string>> = {
    CREDIT_BALANCE: { vi: "Điều chỉnh tiền dư", en: "Credit adjustment" },
    INVOICE: { vi: "Ghi nhận khoản phải thu", en: "Charge recorded" },
    PAYMENT: { vi: "Thanh toán hóa đơn", en: "Invoice payment" },
    RECEIPT: { vi: "Thu tiền", en: "Payment received" },
    SERVICE_CHARGE: { vi: "Dịch vụ cần thu", en: "Service charge" },
  };

  return labels[kind]?.[language] ?? displayStatus(kind, language);
}

function statementBalanceLabel(balance: number, language: Language) {
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

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  return null;
}

function workspaceMessageText(message: string | null | undefined, language: Language) {
  if (!message || language !== "vi") return message;

  const viMessages: Record<string, string> = {
    "Chưa có dữ liệu trong phạm vi hiện tại.":
      "Chưa có bệnh nhân cần thu tiền trong phạm vi hiện tại.",
  };

  return viMessages[message] ?? message;
}

function noticeText(notice: string | null, language: Language) {
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

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();
  return noticeText(notice, language);
}

function vietnamDateKey(value: Date | string | number) {
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

function vietnamDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
  }).formatToParts(value);
  const getPart = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    day: getPart("day"),
    month: getPart("month"),
    year: getPart("year"),
  };
}

function vietnamBillingPeriodRange(filter: BillingPeriodFilter, now = new Date()) {
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

function isDateKeyInRange(dateKey: string, range: { endKey: string; startKey: string }) {
  return Boolean(dateKey && dateKey >= range.startKey && dateKey <= range.endKey);
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);

  if (!year || !month || !day) {
    return "";
  }

  return vietnamDateKey(new Date(Date.UTC(year, month - 1, day + days, 12)));
}

function dateKeyToNoonDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);

  if (!year || !month || !day) {
    return new Date();
  }

  return new Date(year, month - 1, day, 12);
}

function startOfCalendarMonth(dateKey: string) {
  const [year, month] = dateKey.split("-").map(Number);

  if (!year || !month) {
    return new Date();
  }

  return new Date(year, month - 1, 1, 12);
}

function staffCalendarDayLabel(dateKey: string, language: Language) {
  const [year, month, day] = dateKey.split("-").map(Number);

  if (!year || !month || !day) {
    return dateKey;
  }

  const weekdayIndex = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  const weekday =
    language === "vi"
      ? ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][weekdayIndex]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayIndex];

  return `${weekday} ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

function staffCalendarMonthTag(date: Date, language: Language) {
  const months =
    language === "vi"
      ? [
          "Thg 1",
          "Thg 2",
          "Thg 3",
          "Thg 4",
          "Thg 5",
          "Thg 6",
          "Thg 7",
          "Thg 8",
          "Thg 9",
          "Thg 10",
          "Thg 11",
          "Thg 12",
        ]
      : [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];

  return months[date.getMonth()] ?? "";
}

function appointmentDateKey(appointment: Appointment) {
  return appointment.startsAt ? vietnamDateKey(appointment.startsAt) : vietnamDateKey(new Date());
}

function appointmentIsCheckedIn(appointment: Appointment) {
  return ["Arrived", "In chair", "Completed"].includes(appointment.status);
}

function invoiceBalance(invoice: Invoice) {
  return invoiceBalanceAmount(invoice.amount, invoice.paidAmount);
}

function isCollectableInvoice(invoice: Invoice) {
  return isCollectableInvoiceStatus(invoice.status);
}

type JourneyReceiptMethod = "cash" | "card" | "bank_transfer";
type JourneyCollectionMethod = JourneyReceiptMethod | "credit_balance";

function isJourneyReceiptMethod(value: unknown): value is JourneyReceiptMethod {
  return value === "cash" || value === "card" || value === "bank_transfer";
}

function isJourneyCollectionMethod(value: unknown): value is JourneyCollectionMethod {
  return isJourneyReceiptMethod(value) || value === "credit_balance";
}

type JourneyReceipt = {
  id: string;
  serviceId: string;
  patientId: string;
  patient: string;
  clinicId: string;
  amount: number;
  method: JourneyReceiptMethod;
  collectedAt: number;
};

type JourneyCreditAllocation = {
  id: string;
  toServiceId: string;
  patientId: string;
  patient: string;
  clinicId: string;
  amount: number;
  allocatedAt: number;
};

function vietnamTodayDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function vietnamDateKeyFromIso(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function vietnamMonthKeyFromIso(value: string | null | undefined) {
  return vietnamDateKeyFromIso(value).slice(0, 7);
}

function vietnamInputDateTime(value: string | null) {
  if (!value) {
    return {
      date: "",
      time: "",
    };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      date: "",
      time: "",
    };
  }

  return {
    date: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date),
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date),
  };
}

function journeyStableLedgerHash(value: string) {
  let hash = 0;

  for (const char of value) {
    hash = Math.imul(31, hash) + char.charCodeAt(0);
  }

  return String(hash >>> 0).padStart(10, "0");
}

function journeyInvoiceIdForService(serviceId: string) {
  return `JRN-${journeyStableLedgerHash(serviceId)}`;
}

function journeyInvoiceIdForServiceLedger(serviceId: string, ledgerId: string) {
  return `JRN-${journeyStableLedgerHash(`${serviceId}-${ledgerId}`)}`;
}

function journeyReceiptIdForService(serviceId: string, collectedAt: number) {
  return `RCT-${journeyInvoiceIdForService(`${serviceId}-${collectedAt}`)}`;
}

function journeyCreditAllocationIdForService(serviceId: string, allocatedAt: number) {
  return `CRA-${journeyInvoiceIdForService(`${serviceId}-${allocatedAt}`)}`;
}

function isStoredJourneyInvoice(value: unknown): value is Invoice {
  if (!value || typeof value !== "object") {
    return false;
  }

  const invoice = value as Partial<Invoice>;

  return (
    typeof invoice.id === "string" &&
    typeof invoice.patient === "string" &&
    typeof invoice.patientId === "string" &&
    typeof invoice.clinicId === "string" &&
    typeof invoice.amount === "number" &&
    (invoice.paidAmount === undefined || typeof invoice.paidAmount === "number") &&
    typeof invoice.status === "string" &&
    typeof invoice.due === "string"
  );
}

function isStoredJourneyReceipt(value: unknown): value is JourneyReceipt {
  if (!value || typeof value !== "object") {
    return false;
  }

  const receipt = value as Partial<JourneyReceipt>;

  return (
    typeof receipt.id === "string" &&
    typeof receipt.serviceId === "string" &&
    typeof receipt.patientId === "string" &&
    typeof receipt.patient === "string" &&
    typeof receipt.clinicId === "string" &&
    typeof receipt.amount === "number" &&
    (receipt.method === "cash" ||
      receipt.method === "card" ||
      receipt.method === "bank_transfer") &&
    typeof receipt.collectedAt === "number"
  );
}

function isStoredJourneyCreditAllocation(
  value: unknown,
): value is JourneyCreditAllocation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const allocation = value as Partial<JourneyCreditAllocation>;

  return (
    typeof allocation.id === "string" &&
    typeof allocation.toServiceId === "string" &&
    typeof allocation.patientId === "string" &&
    typeof allocation.patient === "string" &&
    typeof allocation.clinicId === "string" &&
    typeof allocation.amount === "number" &&
    typeof allocation.allocatedAt === "number"
  );
}

function receiptMethodLabel(method: JourneyReceiptMethod, language: Language) {
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

function collectionMethodLabel(method: JourneyCollectionMethod, language: Language) {
  if (method === "credit_balance") {
    return language === "vi" ? "Tiền dư/chưa phân bổ" : "Advance/unapplied";
  }

  return receiptMethodLabel(method, language);
}

function padCodeNumber(value: number, digits: number) {
  return String(Math.max(Math.trunc(value), 0)).padStart(digits, "0");
}

function stableNumberFromText(value: string, max: number) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % max;
  }

  return hash + 1;
}

function patientCodeFor(patient: Pick<Patient, "id" | "patientCode"> | null | undefined) {
  if (!patient) {
    return "PT000000";
  }

  if (patient.patientCode) {
    return patient.patientCode;
  }

  const numericId = patient.id.match(/\d+/g)?.join("");
  const sequence = numericId
    ? Number(numericId.slice(-6))
    : stableNumberFromText(patient.id, 999999);

  return `PT${padCodeNumber(sequence || 0, 6)}`;
}

function patientClassCodeFor(patient: Pick<Patient, "age" | "flags">) {
  const flags = patient.flags.map((flag) => flag.toLowerCase());

  if (patient.age > 0 && patient.age < 16) {
    return "PE";
  }

  if (flags.some((flag) => flag.includes("pediatric") || flag.includes("guardian"))) {
    return "PE";
  }

  return "AD";
}

function normalizeCodeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const legacyServiceCatalogCodes: Record<string, string> = {
  [normalizeCodeText("Cạo vôi và đánh bóng")]: "LCR",
  [normalizeCodeText("Scaling and polishing")]: "LCR",
  [normalizeCodeText("Phục hình mão sứ")]: "MSU",
  [normalizeCodeText("Ceramic crown restoration")]: "MSU",
  [normalizeCodeText("Chỉnh nha")]: "CHN",
  [normalizeCodeText("Orthodontics")]: "CHN",
};

function serviceCatalogCodeFromName(serviceName: string) {
  const normalizedName = normalizeCodeText(serviceName);
  const legacyCode = legacyServiceCatalogCodes[normalizedName];

  if (legacyCode) {
    return legacyCode;
  }

  const match = serviceLibrary.find(
    (service) =>
      normalizeCodeText(service.name) === normalizedName ||
      normalizeCodeText(service.nameEn) === normalizedName,
  );

  return match?.code ?? "SV";
}

function serviceProgressPercent(progress: string) {
  const explicitPercent = progress.match(/\((\d+)%\)/);

  if (explicitPercent) {
    return Number(explicitPercent[1]);
  }

  const progressPercent: Record<string, number> = {
    Accepted: 0,
    Cancelled: 0,
    Completed: 100,
    Declined: 0,
    Draft: 0,
    "In progress": 10,
    "In Progress": 10,
    Planned: 0,
    Presented: 0,
  };

  return progressPercent[progress] ?? 0;
}

function serviceProgressIsCancelled(progress: string) {
  return progress === "Cancelled";
}

function serviceProgressLabelFromPercent(percent: number, status?: string) {
  if (status === "CANCELLED") {
    return "Cancelled";
  }

  if (percent <= 0) {
    return "Planned (0%)";
  }

  if (percent >= 100 || status === "COMPLETED") {
    return "Completed (100%)";
  }

  if (percent <= 10) {
    return "In progress";
  }

  const roundedPercent = Math.round(percent);
  const knownStepLabels: Record<number, string> = {
    20: "Step 1 (20%)",
    40: "Step 2 (40%)",
    55: "Step 3 (55%)",
    70: "Step 4 (70%)",
  };

  return knownStepLabels[roundedPercent] ?? `Step (${roundedPercent}%)`;
}

function serviceProgressPercentOptions(currentPercent: number) {
  return Array.from(
    new Set([0, 10, 20, 40, 55, 70, 100, Math.round(currentPercent)]),
  ).sort((left, right) => left - right);
}

type JourneyServiceProgressEvent = {
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

type PendingProgressUpdate = {
  serviceId: string;
  serviceLabel: string;
  serviceName: string;
  fromProgressPercent: number;
  toProgressPercent: number;
};

type JourneyServiceRow = {
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

type JourneyServiceCatalogOption = {
  id: string;
  code: string;
  category: DentalServiceCatalogItem["category"];
  name: string;
  nameEn: string;
  price: number;
  compensationRuleId?: string | null;
  compensationRuleName?: string | null;
};

function serviceCatalogOptionName(
  service: Pick<JourneyServiceCatalogOption, "name" | "nameEn">,
  language: Language,
) {
  return language === "en" ? service.nameEn || service.name : service.name;
}

function journeyServiceCatalogCode(service: Pick<JourneyServiceRow, "catalogCode" | "serviceCode" | "serviceName">) {
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

function serviceSequenceFromInstanceCode(serviceCode: string | undefined, catalogCode: string) {
  if (!serviceCode) {
    return null;
  }

  const match = serviceCode.match(new RegExp(`${catalogCode}(\\d{2,})$`));

  return match?.[1] ? Number(match[1]) : null;
}

function nextServiceSequence(
  services: JourneyServiceRow[],
  patientId: string,
  catalogCode: string,
) {
  let maxSequence = 0;

  services.forEach((service) => {
    if (
      service.patientId !== patientId ||
      journeyServiceCatalogCode(service) !== catalogCode
    ) {
      return;
    }

    const parsedSequence = serviceSequenceFromInstanceCode(
      service.serviceCode,
      catalogCode,
    );

    maxSequence = Math.max(maxSequence, parsedSequence ?? maxSequence + 1);
  });

  return maxSequence + 1;
}

function createServiceInstanceCode(
  patient: Pick<Patient, "id" | "patientCode"> | null | undefined,
  catalogCode: string,
  sequence: number,
) {
  return `${patientCodeFor(patient)}-${catalogCode}${padCodeNumber(sequence, 2)}`;
}

function formatServiceInstanceCode(serviceCode: string) {
  const [patientCode, servicePart] = serviceCode.split("-");

  return patientCode && servicePart ? `${patientCode} • ${servicePart}` : serviceCode;
}

function displayServiceInstanceCode(
  service: JourneyServiceRow,
  patient: Pick<Patient, "id" | "patientCode"> | null | undefined,
) {
  const catalogCode = journeyServiceCatalogCode(service);
  const serviceCode =
    service.serviceCode ?? createServiceInstanceCode(patient, catalogCode, 1);

  return formatServiceInstanceCode(serviceCode);
}

function createdAtFromJourneyServiceId(serviceId: string) {
  const match = serviceId.match(/-(\d{12,})(?:-\d+)?$/);

  return match?.[1] ? Number(match[1]) : Date.now();
}

function withGeneratedJourneyServiceCodes(
  services: JourneyServiceRow[],
  patientsById: Map<string, Patient>,
) {
  const runningSequences = new Map<string, number>();

  return services.map((service) => {
    const patient = patientsById.get(service.patientId);
    const catalogCode = journeyServiceCatalogCode(service);
    const key = `${service.patientId}:${catalogCode}`;
    const parsedSequence = serviceSequenceFromInstanceCode(
      service.serviceCode,
      catalogCode,
    );
    const sequence = parsedSequence ?? (runningSequences.get(key) ?? 0) + 1;

    runningSequences.set(key, Math.max(runningSequences.get(key) ?? 0, sequence));

    return {
      ...service,
      catalogCode,
      serviceCode:
        service.serviceCode ??
        createServiceInstanceCode(patient, catalogCode, sequence),
      createdAt: service.createdAt ?? createdAtFromJourneyServiceId(service.id),
    };
  });
}

const billingText = {
  vi: {
    alert:
      "",
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
    alert:
      "",
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

function normalizeSearchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function matchesChartSearch(
  query: string,
  values: Array<string | number | null | undefined>,
) {
  if (!query) {
    return true;
  }

  return values.some((value) => normalizeSearchText(value).includes(query));
}

export function BillingPanel({
  actorName,
  billingSearch,
  billingWorkspace,
  journeyInvoiceIds,
  journeyReceipts,
  onCreateJourneyReceipt,
  onIssueJourneyInvoiceForService,
  onRecordJourneyInvoicePayment,
  onVoidJourneyInvoice,
  visibleClinicIds,
  visibleAppointments,
  visibleClinics,
  visibleInvoices,
  visiblePatients,
}: {
  actorName: string;
  billingSearch: string;
  billingWorkspace?: BillingWorkspace | null;
  journeyInvoiceIds: Set<string>;
  journeyReceipts: JourneyReceipt[];
  onCreateJourneyReceipt: (receipt: JourneyReceipt) => void;
  onIssueJourneyInvoiceForService: (input: {
    clinicId: string;
    patient: string;
    patientId: string;
    amount: number;
    creditAllocationId?: string;
    invoiceId?: string;
    issuedAt?: number;
    receiptId?: string;
    serviceCode?: string;
    serviceId: string;
    paidAmountOverride?: number;
  }) => string;
  onRecordJourneyInvoicePayment: (invoiceId: string, amount: number) => void;
  onVoidJourneyInvoice: (invoiceId: string) => void;
  visibleClinicIds: Set<string>;
  visibleAppointments: Appointment[];
  visibleClinics: Clinic[];
  visibleInvoices: Invoice[];
  visiblePatients: Patient[];
}) {
  const searchParams = useSearchParams();
  const { language } = useAppLanguage();
  const bt = billingText[language];
  const requestedBillingPatientId = searchParams.get("patientId") ?? "";
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const canMutate = billingWorkspace?.canMutate ?? false;
  const [billingJourneyServices, setBillingJourneyServices] = useState<JourneyServiceRow[]>(
    [],
  );
  const [receiptDrafts, setReceiptDrafts] = useState<JourneyReceiptDraftStore>({});
  const [journeyCreditAllocations, setJourneyCreditAllocations] = useState<
    JourneyCreditAllocation[]
  >([]);
  const [journeyServiceFilter, setJourneyServiceFilter] =
    useState<BillingJourneyServiceFilter>("all");
  const [billingClinicFilter, setBillingClinicFilter] = useState("all");
  const [billingPeriodFilter, setBillingPeriodFilter] =
    useState<BillingPeriodFilter>("all");
  const [billingInvoiceFilter, setBillingInvoiceFilter] =
    useState<BillingInvoiceFilter>("all");
  const [billingSection, setBillingSection] =
    useState<BillingSection>("collection");
  const [selectedBillingPatientId, setSelectedBillingPatientId] = useState(
    requestedBillingPatientId,
  );
  const billingDatabaseOnly = billingWorkspace?.source === "database";
  const billingClinicOptions = visibleClinics.filter((clinic) =>
    visibleClinicIds.has(clinic.id),
  );
  const activeBillingClinicIds = useMemo(
    () =>
      billingClinicFilter === "all" || !visibleClinicIds.has(billingClinicFilter)
        ? new Set(visibleClinicIds)
        : new Set([billingClinicFilter]),
    [billingClinicFilter, visibleClinicIds],
  );
  const billingPeriodRange =
    billingPeriodFilter === "all"
      ? null
      : vietnamBillingPeriodRange(billingPeriodFilter);
  const activeBillingAppointments = visibleAppointments.filter((appointment) =>
    activeBillingClinicIds.has(appointment.clinicId),
  );
  const periodAppointments = billingPeriodRange
    ? activeBillingAppointments.filter((appointment) =>
        isDateKeyInRange(appointmentDateKey(appointment), billingPeriodRange),
      )
    : activeBillingAppointments;
  const checkedInTodayPatientIds = new Set(
    activeBillingAppointments
      .filter(
        (appointment) =>
          appointmentIsCheckedIn(appointment) &&
          isDateKeyInRange(appointmentDateKey(appointment), vietnamBillingPeriodRange("today")),
      )
      .map((appointment) => appointment.patientId),
  );
  const periodAppointmentPatientIds = new Set(
    periodAppointments
      .filter((appointment) =>
        billingPeriodFilter === "today"
          ? appointmentIsCheckedIn(appointment)
          : appointment.status !== "Cancelled" && appointment.status !== "No-show",
      )
      .map((appointment) => appointment.patientId),
  );
  const billingPeriodPatientIds =
    billingPeriodFilter === "today"
      ? checkedInTodayPatientIds
      : periodAppointmentPatientIds;
  const patientMatchesBillingClinic = (patient: Patient) =>
    activeBillingClinicIds.has(patient.clinicId);
  const patientMatchesBillingPeriod = (patientId: string) =>
    billingPeriodFilter === "all" || billingPeriodPatientIds.has(patientId);
  const scopedBillingPatients = visiblePatients.filter(
    (patient) =>
      patientMatchesBillingClinic(patient) && patientMatchesBillingPeriod(patient.id),
  );
  const effectiveBillingPatientId = scopedBillingPatients.some(
    (patient) => patient.id === selectedBillingPatientId,
  )
    ? selectedBillingPatientId
    : "";
  const selectedBillingPatient =
    scopedBillingPatients.find((patient) => patient.id === effectiveBillingPatientId) ??
    null;
  const visiblePatientIdsForForm = new Set(scopedBillingPatients.map((patient) => patient.id));
  const formPatients =
    billingWorkspace?.patients.filter(
      (patient) =>
        activeBillingClinicIds.has(patient.clinicId) &&
        visiblePatientIdsForForm.has(patient.id),
    ) ??
    [];
  const formReady = Boolean(canMutate && formPatients.length);
  const dueDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const visiblePatientIds = useMemo(
    () =>
      new Set(
        visiblePatients
          .filter((patient) => activeBillingClinicIds.has(patient.clinicId))
          .filter(
            (patient) =>
              !effectiveBillingPatientId || patient.id === effectiveBillingPatientId,
          )
          .map((patient) => patient.id),
      ),
    [activeBillingClinicIds, effectiveBillingPatientId, visiblePatients],
  );
  const visiblePatientsById = useMemo(
    () => new Map(visiblePatients.map((patient) => [patient.id, patient])),
    [visiblePatients],
  );
  const databaseServiceBillingById = useMemo(
    () =>
      new Map(
        (billingWorkspace?.treatmentServices ?? []).map((service) => [
          service.id,
          {
            collectedAmount: service.collectedAmount,
            creditAllocatedAmount: service.creditAllocatedAmount,
            invoicedAmount: service.invoicedAmount,
          },
        ]),
      ),
    [billingWorkspace?.treatmentServices],
  );
  const databaseJourneyServices: JourneyServiceRow[] =
    billingWorkspace?.treatmentServices
      .filter(
        (service) =>
          visiblePatientIds.has(service.patientId) &&
          activeBillingClinicIds.has(service.clinicId),
      )
      .map((service) => ({
        id: service.id,
        patientId: service.patientId,
        patientName: service.patientName,
        clinicId: service.clinicId,
        serviceCode: service.serviceCode,
        catalogCode: service.catalogCode,
        createdAt: Date.parse(service.createdAt) || undefined,
        object: service.teeth.join(", ") || service.targetSummary || "",
        diagnosis: service.targetSummary ?? "",
        serviceName: service.serviceName,
        progress: serviceProgressLabelFromPercent(
          service.currentProgressPercent,
          service.status,
        ),
        listPrice: service.finalPrice,
        discount: 0,
        finalPrice: service.finalPrice,
        collectedAmount: service.collectedAmount,
        creditAllocatedAmount: service.creditAllocatedAmount,
        invoicedAmount: service.invoicedAmount,
        invoiceIds: service.invoiceNos,
        invoiceNos: service.invoiceNos,
        source: "database" as const,
      })) ?? [];
  const localJourneyServices = billingDatabaseOnly
    ? []
    : billingJourneyServices.filter((service) => {
        const patient = visiblePatientsById.get(service.patientId);

        return (
          service.source === "odontogram" &&
          visiblePatientIds.has(service.patientId) &&
          (!patient || activeBillingClinicIds.has(patient.clinicId))
        );
      });
  const journeyServices = [...databaseJourneyServices, ...localJourneyServices];
  const billingVisibleInvoices = visibleInvoices.filter((invoice) =>
    activeBillingClinicIds.has(invoice.clinicId),
  );
  const serviceMatchesBillingPeriod = (service: JourneyServiceRow) => {
    if (billingPeriodFilter === "all") {
      return true;
    }

    if (billingPeriodFilter === "today") {
      return checkedInTodayPatientIds.has(service.patientId);
    }

    const createdAtKey = service.createdAt ? vietnamDateKey(service.createdAt) : "";

    return (
      billingPeriodPatientIds.has(service.patientId) ||
      Boolean(billingPeriodRange && isDateKeyInRange(createdAtKey, billingPeriodRange))
    );
  };
  const invoiceMatchesBillingPeriod = (invoice: Invoice) => {
    if (billingPeriodFilter === "all") {
      return true;
    }

    if (billingPeriodFilter === "today") {
      return Boolean(invoice.patientId && checkedInTodayPatientIds.has(invoice.patientId));
    }

    const issuedAtKey =
      typeof invoice.issuedAtMs === "number" ? vietnamDateKey(invoice.issuedAtMs) : "";
    const dueDateKey = vietnamDateKey(invoice.due);

    return (
      Boolean(invoice.patientId && billingPeriodPatientIds.has(invoice.patientId)) ||
      Boolean(billingPeriodRange && isDateKeyInRange(issuedAtKey, billingPeriodRange)) ||
      Boolean(billingPeriodRange && isDateKeyInRange(dueDateKey, billingPeriodRange))
    );
  };
  const receiptMatchesBillingPeriod = (receipt: {
    collectedAt?: number;
    patientId: string;
    receivedAt?: string;
  }) => {
    if (billingPeriodFilter === "all") {
      return true;
    }

    if (billingPeriodFilter === "today") {
      return checkedInTodayPatientIds.has(receipt.patientId);
    }

    const collectedAtKey =
      typeof receipt.collectedAt === "number" ? vietnamDateKey(receipt.collectedAt) : "";
    const receivedAtKey = receipt.receivedAt ? vietnamDateKey(receipt.receivedAt) : "";

    return (
      billingPeriodPatientIds.has(receipt.patientId) ||
      Boolean(billingPeriodRange && isDateKeyInRange(collectedAtKey, billingPeriodRange)) ||
      Boolean(billingPeriodRange && isDateKeyInRange(receivedAtKey, billingPeriodRange))
    );
  };
  const periodJourneyServices = journeyServices.filter(serviceMatchesBillingPeriod);
  const periodInvoices = billingVisibleInvoices.filter(invoiceMatchesBillingPeriod);
  const visibleJourneyReceipts = journeyReceipts.filter(
    (receipt) =>
      visiblePatientIds.has(receipt.patientId) &&
      activeBillingClinicIds.has(receipt.clinicId) &&
      receiptMatchesBillingPeriod(receipt),
  );
  const visibleDatabaseReceipts =
    billingWorkspace?.receipts.filter(
      (receipt) =>
        visiblePatientIds.has(receipt.patientId) &&
        activeBillingClinicIds.has(receipt.clinicId) &&
        receiptMatchesBillingPeriod(receipt),
    ) ?? [];
  const visibleCreditBalances =
    billingWorkspace?.creditBalances.filter(
      (balance) =>
        visiblePatientIds.has(balance.patientId) &&
        activeBillingClinicIds.has(balance.clinicId) &&
        patientMatchesBillingPeriod(balance.patientId),
    ) ?? [];
  const serviceCollectedAmount = (serviceId: string) =>
    databaseServiceBillingById.get(serviceId)?.collectedAmount ??
    journeyReceipts
      .filter((receipt) => receipt.serviceId === serviceId)
      .reduce((total, receipt) => total + receipt.amount, 0);
  const serviceCreditAllocationAmount = (serviceId: string) =>
    databaseServiceBillingById.get(serviceId)?.creditAllocatedAmount ??
    journeyCreditAllocations
      .filter((allocation) => allocation.toServiceId === serviceId)
      .reduce((total, allocation) => total + allocation.amount, 0);
  const serviceAppliedAmount = (serviceId: string) =>
    calculateServiceAppliedAmount(
      serviceCollectedAmount(serviceId),
      serviceCreditAllocationAmount(serviceId),
    );
  const serviceIsStarted = (service: JourneyServiceRow) =>
    !serviceProgressIsCancelled(service.progress) &&
    serviceProgressPercent(service.progress) > 0;
  const journeyServicesById = new Map(journeyServices.map((service) => [service.id, service]));
  const journeyServicesByInvoiceId = new Map<string, JourneyServiceRow>();
  const journeyInvoicesByServiceId = new Map<string, Invoice[]>();

  billingVisibleInvoices.forEach((invoice) => {
    const explicitService = invoice.serviceId
      ? journeyServicesById.get(invoice.serviceId)
      : undefined;

    if (!journeyInvoiceIds.has(invoice.id) && !explicitService) {
      return;
    }

    const legacyService =
      explicitService ??
      journeyServices.find(
        (service) =>
          service.invoiceId === invoice.id ||
          service.invoiceIds?.includes(invoice.id) ||
          (!invoice.serviceId && invoice.id === journeyInvoiceIdForService(service.id)),
      );

    if (!legacyService) {
      return;
    }

    journeyServicesByInvoiceId.set(invoice.id, legacyService);
    journeyInvoicesByServiceId.set(legacyService.id, [
      ...(journeyInvoicesByServiceId.get(legacyService.id) ?? []),
      invoice,
    ]);
  });

  const activeServiceInvoices = (serviceId: string) =>
    (journeyInvoicesByServiceId.get(serviceId) ?? []).filter(
      (invoice) => invoice.status !== "Void",
    );
  const serviceInvoicedAmount = (serviceId: string) =>
    databaseServiceBillingById.get(serviceId)?.invoicedAmount ??
    activeServiceInvoices(serviceId).reduce(
      (total, invoice) => total + invoice.amount,
      0,
    );
  const serviceBillableCollectedAmount = (service: JourneyServiceRow) =>
    calculateServiceBillableCollectedAmount(
      service.finalPrice,
      serviceAppliedAmount(service.id),
    );
  const serviceRemainingInvoiceCapacity = (service: JourneyServiceRow) =>
    calculateServiceRemainingInvoiceCapacity(
      service.finalPrice,
      serviceInvoicedAmount(service.id),
    );
  const serviceUninvoicedAmount = (service: JourneyServiceRow) =>
    calculateServiceUninvoicedAmount(
      service.finalPrice,
      serviceAppliedAmount(service.id),
      serviceInvoicedAmount(service.id),
    );
  const billingSearchQuery = normalizeSearchText(billingSearch.trim());
  const updateReceiptDraft = (
    serviceId: string,
    patch: Partial<JourneyReceiptDraftStore[string]>,
  ) => {
    setReceiptDrafts((current) => ({
      ...current,
      [serviceId]: {
        amount: current[serviceId]?.amount ?? "",
        method: current[serviceId]?.method ?? "cash",
        ...patch,
      },
    }));
  };
  const persistJourneyServices = (updater: (current: JourneyServiceRow[]) => JourneyServiceRow[]) =>
    setBillingJourneyServices((current) => updater(current));
  const appendInvoiceIdToService = (serviceId: string, invoiceId: string) => {
    if (!invoiceId) {
      return;
    }

    persistJourneyServices((current) =>
      current.map((item) => {
        if (item.id !== serviceId) {
          return item;
        }

        const invoiceIds = Array.from(
          new Set([...(item.invoiceIds ?? []), item.invoiceId, invoiceId].filter(Boolean)),
        ) as string[];

        return {
          ...item,
          invoiceCreatedAt: item.invoiceCreatedAt ?? Date.now(),
          invoiceId: item.invoiceId ?? invoiceId,
          invoiceIds,
        };
      }),
    );
  };

  const handleLocalPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const invoiceNo = String(formData.get("invoiceNo") ?? "");
    const amount = Number(formData.get("amount") ?? 0);
    const methodInput = formData.get("method");
    const method = isJourneyReceiptMethod(methodInput) ? methodInput : "cash";
    const invoice = billingVisibleInvoices.find((item) => item.id === invoiceNo);
    const service = billingJourneyServices.find(
      (item) =>
        item.source === "odontogram" &&
        (item.id === invoice?.serviceId ||
          item.invoiceId === invoiceNo ||
          item.invoiceIds?.includes(invoiceNo)),
    );
    const patient = service ? visiblePatientsById.get(service.patientId) : undefined;

    if (service && patient && amount > 0) {
      const collectedAt = Date.now();
      const receiptId = journeyReceiptIdForService(service.id, collectedAt);

      onCreateJourneyReceipt({
        id: receiptId,
        serviceId: service.id,
        patientId: patient.id,
        patient: patient.name,
        clinicId: patient.clinicId,
        amount,
        method,
        collectedAt,
      });
      onRecordJourneyInvoicePayment(invoiceNo, amount);
      form.reset();

      return;
    }

    onRecordJourneyInvoicePayment(invoiceNo, amount);
    form.reset();
  };
  const issueInvoiceForService = (service: JourneyServiceRow) => {
    const patient = visiblePatients.find((item) => item.id === service.patientId);

    if (!patient || service.source !== "odontogram") {
      return;
    }

    const invoiceAmount = serviceUninvoicedAmount(service);

    if (invoiceAmount <= 0) {
      return;
    }

    const invoiceId = onIssueJourneyInvoiceForService({
      clinicId: patient.clinicId,
      patient: patient.name,
      patientId: patient.id,
      amount: invoiceAmount,
      issuedAt: Date.now(),
      serviceCode: service.serviceCode,
      serviceId: service.id,
      paidAmountOverride: invoiceAmount,
    });

    appendInvoiceIdToService(service.id, invoiceId);
  };
  const recordReceiptForService = (
    service: JourneyServiceRow,
    options: { issueInvoice: boolean },
  ) => {
    const patient = visiblePatients.find((item) => item.id === service.patientId);
    const draft = receiptDrafts[service.id];
    const method = draft?.method ?? "cash";
    const amount = Math.max(Number(draft?.amount ?? 0) || 0, 0);

    if (method === "credit_balance") {
      allocateCreditToService(service, amount, options.issueInvoice);
      setReceiptDrafts((current) => ({
        ...current,
        [service.id]: {
          amount: "",
          method: "credit_balance",
        },
      }));

      return;
    }

    if (!patient || amount <= 0 || !isJourneyReceiptMethod(method)) {
      return;
    }

    const collectedAt = Date.now();
    const receiptId = journeyReceiptIdForService(service.id, collectedAt);

    onCreateJourneyReceipt({
      id: receiptId,
      serviceId: service.id,
      patientId: patient.id,
      patient: patient.name,
      clinicId: patient.clinicId,
      amount,
      method,
      collectedAt,
    });
    setReceiptDrafts((current) => ({
      ...current,
      [service.id]: {
        amount: "",
        method: current[service.id]?.method ?? "cash",
      },
    }));

    if (options.issueInvoice) {
      const invoiceAmount = Math.min(amount, serviceRemainingInvoiceCapacity(service));

      if (invoiceAmount <= 0) {
        return;
      }

      const invoiceId = onIssueJourneyInvoiceForService({
        clinicId: patient.clinicId,
        patient: patient.name,
        patientId: patient.id,
        amount: invoiceAmount,
        issuedAt: collectedAt,
        receiptId,
        serviceCode: service.serviceCode,
        serviceId: service.id,
        paidAmountOverride: invoiceAmount,
      });

      appendInvoiceIdToService(service.id, invoiceId);
    }
  };
  const sortedJourneyServices = periodJourneyServices;
  const billingInvoiceAmount = (invoice: Invoice) => invoice.amount;
  const billingInvoicePaidAmount = (invoice: Invoice) => {
    if (!journeyInvoiceIds.has(invoice.id)) {
      return invoice.paidAmount ?? 0;
    }

    const amount = billingInvoiceAmount(invoice);
    const paidAmount =
      invoice.paidAmount ?? (invoice.status === "Paid" ? amount : 0);

    return cappedPaidAmount(paidAmount, amount);
  };
  const billingInvoiceBalance = (invoice: Invoice) =>
    invoiceBalanceAmount(billingInvoiceAmount(invoice), billingInvoicePaidAmount(invoice));
  const journeyInvoiceSequenceTime = (invoice: Invoice) => {
    if (typeof invoice.issuedAtMs === "number" && Number.isFinite(invoice.issuedAtMs)) {
      return invoice.issuedAtMs;
    }

    const dueTime = Date.parse(invoice.due);

    return Number.isFinite(dueTime) ? dueTime : Number.MAX_SAFE_INTEGER;
  };
  const sortJourneyInvoicesBySequence = (invoices: Invoice[]) =>
    [...invoices].sort((left, right) => {
      const timeDelta = journeyInvoiceSequenceTime(left) - journeyInvoiceSequenceTime(right);

      if (timeDelta !== 0) {
        return timeDelta;
      }

      return left.id.localeCompare(right.id);
    });
  const journeyServiceInvoiceSnapshot = (
    service: JourneyServiceRow,
    invoice: Invoice,
  ) => {
    const orderedInvoices = sortJourneyInvoicesBySequence(activeServiceInvoices(service.id));
    const invoiceIndex = orderedInvoices.findIndex((item) => item.id === invoice.id);
    const invoicesThroughCurrent =
      invoiceIndex >= 0 ? orderedInvoices.slice(0, invoiceIndex + 1) : [invoice];
    const paidThroughInvoice = Math.min(
      invoicesThroughCurrent.reduce(
        (total, item) => total + billingInvoicePaidAmount(item),
        0,
      ),
      service.finalPrice,
    );

    return {
      balanceAfterInvoice: Math.max(service.finalPrice - paidThroughInvoice, 0),
      isLatestInvoice: orderedInvoices[orderedInvoices.length - 1]?.id === invoice.id,
      paidThroughInvoice,
    };
  };
  const billingJourneyFilterLabel = (filter: BillingJourneyServiceFilter) => {
    const labels: Record<BillingJourneyServiceFilter, string> = {
      all: bt.filterAll,
      cancelled: bt.filterCancelled,
      complete: bt.filterComplete,
      deposit: bt.filterDeposit,
      has_invoice: bt.filterHasInvoice,
      invoice_requested: bt.filterInvoiceRequested,
      needs_collection: bt.filterNeedsCollection,
      no_invoice: bt.filterNoInvoice,
      partial_invoice: bt.filterPartialInvoice,
    };

    return labels[filter];
  };
  const billingInvoiceFilterLabel = (filter: BillingInvoiceFilter) => {
    const labels: Record<BillingInvoiceFilter, string> =
      language === "vi"
        ? {
            all: "Tất cả hóa đơn",
            service_linked: "Hóa đơn dịch vụ",
            standalone: "Hóa đơn độc lập",
            open_balance: "Còn công nợ",
            overdue: "Quá hạn",
            paid: "Đã thanh toán",
            partial: "Thanh toán một phần",
            void: "Đã hủy",
          }
        : {
            all: "All invoices",
            service_linked: "Service invoices",
            standalone: "Standalone invoices",
            open_balance: "Open balance",
            overdue: "Overdue",
            paid: "Paid",
            partial: "Partial",
            void: "Void",
          };

    return labels[filter];
  };
  const invoiceIsServiceLinked = (invoice: Invoice) =>
    Boolean(invoice.serviceId || journeyInvoiceIds.has(invoice.id));
  const invoiceMatchesFilter = (invoice: Invoice, filter: BillingInvoiceFilter) => {
    switch (filter) {
      case "service_linked":
        return invoiceIsServiceLinked(invoice);
      case "standalone":
        return !invoiceIsServiceLinked(invoice);
      case "open_balance":
        return isCollectableInvoice(invoice) && billingInvoiceBalance(invoice) > 0;
      case "overdue":
        return invoice.status === "Overdue";
      case "paid":
        return invoice.status === "Paid";
      case "partial":
        return invoice.status === "Partial";
      case "void":
        return invoice.status === "Void";
      default:
        return true;
    }
  };
  const serviceMatchesJourneyFilter = (
    service: JourneyServiceRow,
    filter: BillingJourneyServiceFilter,
  ) => {
    if (filter === "all") {
      return true;
    }

    const appliedAmount = serviceAppliedAmount(service.id);
    const remainingAmount = Math.max(service.finalPrice - appliedAmount, 0);
    const isCancelled = serviceProgressIsCancelled(service.progress);
    const isStarted = serviceIsStarted(service);
    const invoicedAmount = serviceInvoicedAmount(service.id);
    const hasInvoice = invoicedAmount > 0;

    switch (filter) {
      case "needs_collection":
        return isStarted && remainingAmount > 0;
      case "has_invoice":
        return hasInvoice;
      case "partial_invoice":
        return hasInvoice && invoicedAmount < service.finalPrice;
      case "deposit":
        return !isStarted && !isCancelled && appliedAmount > 0;
      case "invoice_requested":
        return serviceUninvoicedAmount(service) > 0;
      case "no_invoice":
        return !hasInvoice;
      case "complete":
        return isStarted && !isCancelled && remainingAmount <= 0;
      case "cancelled":
        return isCancelled;
      default:
        return true;
    }
  };
  const searchedJourneyServices = sortedJourneyServices.filter((service) => {
    const patient = visiblePatientsById.get(service.patientId);
    const serviceInvoices = activeServiceInvoices(service.id);

    return matchesChartSearch(billingSearchQuery, [
      service.serviceName,
      service.serviceCode,
      service.catalogCode,
      displayServiceInstanceCode(service, patient),
      service.object,
      service.diagnosis,
      service.progress,
      service.invoiceId,
      service.invoiceIds?.join(" "),
      serviceInvoices.map((invoice) => invoice.id).join(" "),
      serviceInvoices.map((invoice) => invoice.status).join(" "),
      serviceInvoices.reduce((total, invoice) => total + invoice.amount, 0),
      patient?.name,
      patient?.phone,
      patient ? patientCodeFor(patient) : undefined,
      patient ? patientClassCodeFor(patient) : undefined,
      service.finalPrice,
      serviceAppliedAmount(service.id),
    ]);
  });
  const journeyFilterOptions = billingJourneyServiceFilters.map((filter) => ({
    filter,
    label: billingJourneyFilterLabel(filter),
    count: searchedJourneyServices.filter((service) =>
      serviceMatchesJourneyFilter(service, filter),
    ).length,
  }));
  const filteredJourneyServices = searchedJourneyServices.filter((service) =>
    serviceMatchesJourneyFilter(service, journeyServiceFilter),
  );
  const filteredJourneyServiceInvoiceIds = new Set(
    filteredJourneyServices
      .flatMap((service) =>
        (journeyInvoicesByServiceId.get(service.id) ?? []).map((invoice) => invoice.id),
      )
      .filter(Boolean),
  );
  const journeyServiceFilterActive = journeyServiceFilter !== "all";
  const invoiceMatchesVisibleScope = (invoice: Invoice) => {
    const invoicePatient = invoice.patientId
      ? visiblePatientsById.get(invoice.patientId)
      : undefined;
    const relatedService =
      (invoice.serviceId ? journeyServicesById.get(invoice.serviceId) : undefined) ??
      (journeyInvoiceIds.has(invoice.id)
        ? journeyServicesByInvoiceId.get(invoice.id)
        : undefined);
    const invoiceMatchesSearch = matchesChartSearch(billingSearchQuery, [
      invoice.id,
      invoice.patient,
      invoice.patientId,
      invoicePatient ? patientCodeFor(invoicePatient) : undefined,
      invoice.clinicId,
      invoice.status,
      invoice.due,
      billingInvoiceAmount(invoice),
      billingInvoicePaidAmount(invoice),
      billingInvoiceBalance(invoice),
      journeyInvoiceIds.has(invoice.id) ? bt.localInvoice : "",
      relatedService?.serviceName,
      relatedService?.serviceCode,
      relatedService?.catalogCode,
      relatedService?.object,
      relatedService?.diagnosis,
      relatedService
        ? displayServiceInstanceCode(
            relatedService,
            visiblePatientsById.get(relatedService.patientId),
          )
        : undefined,
    ]);
    const invoiceBelongsToFilteredService = filteredJourneyServiceInvoiceIds.has(
      invoice.id,
    );

    if (journeyServiceFilterActive) {
      return invoiceBelongsToFilteredService;
    }

    return (
      invoiceMatchesSearch ||
      (billingSearchQuery.length > 0 && invoiceBelongsToFilteredService)
    );
  };
  const invoiceFilterOptions: Array<{ filter: BillingInvoiceFilter; label: string; count: number }> =
    ([
      "all",
      "service_linked",
      "standalone",
      "open_balance",
      "overdue",
      "partial",
      "paid",
      "void",
    ] as BillingInvoiceFilter[]).map(
      (filter) => ({
        filter,
        label: billingInvoiceFilterLabel(filter),
        count: periodInvoices.filter(
          (invoice) =>
            invoiceMatchesVisibleScope(invoice) && invoiceMatchesFilter(invoice, filter),
        ).length,
      }),
    );
  const invoiceFilterActive = billingInvoiceFilter !== "all";
  const filteredInvoices = periodInvoices.filter(
    (invoice) =>
      invoiceMatchesVisibleScope(invoice) &&
      invoiceMatchesFilter(invoice, billingInvoiceFilter),
  );
  const metricJourneyServices = billingSearchQuery || journeyServiceFilterActive
    ? filteredJourneyServices
    : periodJourneyServices;
  const metricInvoices =
    billingSearchQuery || journeyServiceFilterActive || invoiceFilterActive
      ? filteredInvoices
      : periodInvoices;
  const metricJourneyServiceIds = new Set(
    metricJourneyServices.map((service) => service.id),
  );
  const metricReceipts = billingSearchQuery
    ? visibleJourneyReceipts.filter((receipt) => {
        const service = journeyServicesById.get(receipt.serviceId);
        const patient = visiblePatientsById.get(receipt.patientId);

        return (
          metricJourneyServiceIds.has(receipt.serviceId) ||
          matchesChartSearch(billingSearchQuery, [
            receipt.patient,
            patient?.name,
            patient?.phone,
            patient ? patientCodeFor(patient) : undefined,
            patient?.email,
            receipt.amount,
            receiptMethodLabel(receipt.method, language),
            service?.serviceName,
            service?.serviceCode,
            service?.catalogCode,
            service && patient ? displayServiceInstanceCode(service, patient) : undefined,
            service?.object,
            service?.diagnosis,
            service?.progress,
          ])
        );
      })
    : visibleJourneyReceipts;
  const metricDatabaseReceipts = billingSearchQuery
    ? visibleDatabaseReceipts.filter((receipt) => {
        const patient = visiblePatientsById.get(receipt.patientId);

        return matchesChartSearch(billingSearchQuery, [
          receipt.receiptNo,
          receipt.patientName,
          patient?.name,
          patient?.phone,
          patient ? patientCodeFor(patient) : undefined,
          receipt.amount,
          receipt.allocatedAmount,
          receipt.unallocatedAmount,
          isJourneyCollectionMethod(receipt.method)
            ? collectionMethodLabel(receipt.method, language)
            : receipt.method,
          receipt.method,
          receipt.reference,
        ]);
      })
    : visibleDatabaseReceipts;
  const openBalanceInvoices = metricInvoices.filter(
    (invoice) => isCollectableInvoice(invoice) && billingInvoiceBalance(invoice) > 0,
  );
  const openTotal = openBalanceInvoices.reduce(
    (total, invoice) => total + billingInvoiceBalance(invoice),
    0,
  );
  const allocatedTotal = metricJourneyServices.reduce(
    (total, service) =>
      total + Math.min(serviceAppliedAmount(service.id), service.finalPrice),
    0,
  );
  const serviceLinkedMetricInvoices = metricInvoices.filter(invoiceIsServiceLinked);
  const issuedInvoiceTotal = serviceLinkedMetricInvoices
    .filter((invoice) => invoice.status !== "Void")
    .reduce((total, invoice) => total + billingInvoiceAmount(invoice), 0);
  const overdueInvoices = metricInvoices.filter(
    (invoice) => invoice.status === "Overdue",
  );
  const overdueInvoiceTotal = overdueInvoices.reduce(
    (total, invoice) => total + billingInvoiceBalance(invoice),
    0,
  );
  const plannedDepositServices = metricJourneyServices.filter(
    (service) =>
      !serviceIsStarted(service) &&
      !serviceProgressIsCancelled(service.progress) &&
      serviceAppliedAmount(service.id) > 0,
  );
  const plannedDepositTotal = plannedDepositServices.reduce(
    (total, service) => total + serviceAppliedAmount(service.id),
    0,
  );
  const receiptTotal =
    billingWorkspace?.source === "database"
      ? metricDatabaseReceipts
          .filter((receipt) => receipt.method !== "credit_balance")
          .reduce((total, receipt) => total + receipt.amount, 0)
      : metricReceipts.reduce((total, receipt) => total + receipt.amount, 0);
  const creditBalanceTotal = visibleCreditBalances.reduce(
    (total, balance) => total + balance.amount,
    0,
  );
  const unappliedReceiptTotal =
    billingWorkspace?.source === "database"
      ? Math.max(creditBalanceTotal, receiptTotal - allocatedTotal, 0)
      : Math.max(receiptTotal - allocatedTotal, 0);
  const directDatabaseReceipts = metricDatabaseReceipts.filter(
    (receipt) => receipt.method !== "credit_balance",
  );
  const creditBalanceAllocationReceipts = metricDatabaseReceipts.filter(
    (receipt) => receipt.method === "credit_balance",
  );
  const recentDatabaseReceipts = directDatabaseReceipts.slice(0, 8);
  const activeCreditBalances = visibleCreditBalances.filter(
    (balance) => balance.amount > 0,
  );
  const selectedBillingPatientBalanceAmount = selectedBillingPatient
    ? visibleCreditBalances.find(
        (balance) => balance.patientId === selectedBillingPatient.id,
      )?.amount ?? 0
    : 0;
  const selectedBillingPatientDirectReceiptTotal = selectedBillingPatient
    ? directDatabaseReceipts
        .filter((receipt) => receipt.patientId === selectedBillingPatient.id)
        .reduce((total, receipt) => total + receipt.amount, 0)
    : 0;
  const patientBillingRows = scopedBillingPatients
    .map((patient) => {
      const services = metricJourneyServices.filter(
        (service) => service.patientId === patient.id,
      );
      const invoices = metricInvoices.filter((invoice) => invoice.patientId === patient.id);
      const receipts =
        billingWorkspace?.source === "database"
          ? directDatabaseReceipts.filter((receipt) => receipt.patientId === patient.id)
          : metricReceipts.filter((receipt) => receipt.patientId === patient.id);
      const creditBalance =
        visibleCreditBalances.find((balance) => balance.patientId === patient.id)?.amount ??
        0;
      const progressedServices = services.filter(
        (service) =>
          serviceProgressPercent(service.progress) > 0 &&
          !serviceProgressIsCancelled(service.progress),
      );
      const minimumDueAmount = progressedServices.reduce(
        (total, service) => total + service.finalPrice,
        0,
      );
      const paidAmount = services.reduce(
        (total, service) =>
          total + Math.min(serviceAppliedAmount(service.id), service.finalPrice),
        0,
      );
      const dueAmount = Math.max(minimumDueAmount - paidAmount, 0);
      const directReceiptAmount = receipts.reduce(
        (total, receipt) => total + receipt.amount,
        0,
      );
      const hasBillingActivity =
        services.length > 0 ||
        invoices.length > 0 ||
        receipts.length > 0 ||
        creditBalance > 0;

      return {
        creditBalance,
        directReceiptAmount,
        dueAmount,
        hasBillingActivity,
        invoices,
        minimumDueAmount,
        paidAmount,
        patient,
        progressedServices,
        receipts,
        services,
      };
    })
    .filter((row) => row.hasBillingActivity)
    .sort((left, right) => {
      const dueDelta = right.dueAmount - left.dueAmount;

      if (dueDelta !== 0) {
        return dueDelta;
      }

      return left.patient.name.localeCompare(right.patient.name, "vi");
    });
  const databaseVisibleInvoices = periodInvoices.filter(
    (invoice) => !invoiceIsServiceLinked(invoice),
  );
  const adjustableInvoices = databaseVisibleInvoices.filter(
    (invoice) => invoice.status !== "Void",
  );
  const refundableInvoices = databaseVisibleInvoices.filter(
    (invoice) => (invoice.paidAmount ?? 0) > 0 && invoice.status !== "Void",
  );
  const visibleStatementLines =
    billingWorkspace?.statementLines.filter(
      (line) =>
        visiblePatientIds.has(line.patientId) &&
        activeBillingClinicIds.has(line.clinicId) &&
        (billingPeriodFilter === "all" ||
          patientMatchesBillingPeriod(line.patientId) ||
          Boolean(
            billingPeriodRange &&
              isDateKeyInRange(vietnamDateKey(line.date), billingPeriodRange),
          )),
    ) ?? [];
  const visiblePaymentPlanReminders =
    billingWorkspace?.paymentPlanReminders.filter(
      (reminder) =>
        !reminder.clinicId || activeBillingClinicIds.has(reminder.clinicId),
    ) ?? [];
  const visiblePaymentPlans =
    billingWorkspace?.paymentPlans.filter(
      (plan) =>
        visiblePatientIds.has(plan.patientId) &&
        activeBillingClinicIds.has(plan.clinicId) &&
        (billingPeriodFilter === "all" ||
          patientMatchesBillingPeriod(plan.patientId) ||
          Boolean(
            billingPeriodRange &&
              isDateKeyInRange(vietnamDateKey(plan.createdAt), billingPeriodRange),
          )),
    ) ?? [];
  const billingAdvancedLabels =
    language === "vi"
      ? {
          adjustment: "Điều chỉnh hóa đơn",
          amountNew: "Tổng tiền mới",
          confirmAdjust: "Bạn chắc chắn muốn điều chỉnh tổng tiền hóa đơn này? Thao tác sẽ ghi audit log.",
          confirmIssueInvoice: "Bạn chắc chắn muốn xuất hóa đơn cho phần đã thu/chưa xuất hóa đơn?",
          confirmReceipt: "Bạn chắc chắn muốn ghi nhận khoản thu này?",
          confirmReceiptAndInvoice: "Bạn chắc chắn muốn ghi nhận khoản thu và xuất hóa đơn tương ứng?",
          confirmRefund: "Bạn chắc chắn muốn ghi nhận hoàn tiền cho hóa đơn này?",
          confirmVoid: "Bạn chắc chắn muốn hủy hóa đơn này?",
          paymentPlan: "Nhắc trả góp",
          refund: "Hoàn tiền",
          refundAmount: "Số tiền hoàn",
          audit: "Audit",
          ledger: "Sổ cái",
          reminderDate: "Ngày nhắc",
          statement: "Lịch sử thu và khoản phải thu",
          reason: "Lý do/ghi chú",
          installmentCount: "Số kỳ",
          intervalDays: "Khoảng cách ngày",
          firstDueAt: "Kỳ đầu",
          paymentPlanList: "Lịch trả góp",
        }
      : {
          adjustment: "Invoice adjustment",
          amountNew: "New total",
          confirmAdjust: "Are you sure you want to adjust this invoice total? This will write an audit log.",
          confirmIssueInvoice: "Are you sure you want to issue an invoice for the collected uninvoiced amount?",
          confirmReceipt: "Are you sure you want to record this receipt?",
          confirmReceiptAndInvoice: "Are you sure you want to record this receipt and issue the matching invoice?",
          confirmRefund: "Are you sure you want to record this invoice refund?",
          confirmVoid: "Are you sure you want to void this invoice?",
          paymentPlan: "Payment plan reminder",
          refund: "Refund",
          refundAmount: "Refund amount",
          audit: "Audit",
          ledger: "Ledger",
          reminderDate: "Reminder date",
          statement: "Patient payment history",
          reason: "Reason/note",
          installmentCount: "Installments",
          intervalDays: "Interval days",
          firstDueAt: "First due",
          paymentPlanList: "Payment plan schedule",
        };
  const allocateCreditToService = (
    service: JourneyServiceRow,
    requestedAmount?: number,
    issueInvoice = true,
  ) => {
    const patient = visiblePatientsById.get(service.patientId);
    const remainingAmount = Math.max(
      service.finalPrice - serviceAppliedAmount(service.id),
      0,
    );
    const requested =
      requestedAmount && requestedAmount > 0 ? requestedAmount : unappliedReceiptTotal;
    const amount = Math.min(unappliedReceiptTotal, remainingAmount, requested);

    if (!patient || amount <= 0) {
      return;
    }

    const allocatedAt = Date.now();
    const allocationId = journeyCreditAllocationIdForService(service.id, allocatedAt);

    setJourneyCreditAllocations((current) => [
      ...current,
      {
        id: allocationId,
        toServiceId: service.id,
        patientId: patient.id,
        patient: patient.name,
        clinicId: patient.clinicId,
        amount,
        allocatedAt,
      },
    ]);

    const invoiceAmount = issueInvoice
      ? Math.min(amount, serviceRemainingInvoiceCapacity(service))
      : 0;

    if (issueInvoice && invoiceAmount > 0) {
      const invoiceId = onIssueJourneyInvoiceForService({
        clinicId: patient.clinicId,
        patient: patient.name,
        patientId: patient.id,
        amount: invoiceAmount,
        creditAllocationId: allocationId,
        issuedAt: allocatedAt,
        serviceCode: service.serviceCode,
        serviceId: service.id,
        paidAmountOverride: invoiceAmount,
      });

      appendInvoiceIdToService(service.id, invoiceId);
    }
  };
  const remainingJourneyTotal = metricJourneyServices.reduce(
    (total, service) =>
      !serviceIsStarted(service)
        ? total
        : total + Math.max(service.finalPrice - serviceAppliedAmount(service.id), 0),
    0,
  );
  const remainingJourneyCount = metricJourneyServices.filter(
    (service) =>
      serviceIsStarted(service) &&
      Math.max(service.finalPrice - serviceAppliedAmount(service.id), 0) > 0,
  ).length;
  const billingResultScopeActive =
    Boolean(billingSearchQuery) ||
    journeyServiceFilterActive ||
    invoiceFilterActive ||
    billingClinicFilter !== "all" ||
    billingPeriodFilter !== "all";
  const billingSearchSummary = billingResultScopeActive
    ? language === "vi"
      ? `${filteredJourneyServices.length}/${periodJourneyServices.length} dịch vụ, ${filteredInvoices.length}/${periodInvoices.length} hóa đơn`
      : `${filteredJourneyServices.length}/${periodJourneyServices.length} services, ${filteredInvoices.length}/${periodInvoices.length} invoices`
    : bt.searchSummary;
  const billingSectionOptions: Array<{
    key: BillingSection;
    label: string;
    count: string | number;
  }> = [
    {
      key: "collection",
      label: bt.tabCollection,
      count: filteredJourneyServices.length,
    },
    {
      key: "invoices",
      label: bt.tabInvoices,
      count: filteredInvoices.length,
    },
    {
      key: "receipts",
      label: bt.tabReceipts,
      count: recentDatabaseReceipts.length,
    },
    {
      key: "balances",
      label: bt.tabBalances,
      count:
        activeCreditBalances.length +
        visiblePaymentPlans.length +
        creditBalanceAllocationReceipts.length,
    },
    {
      key: "control",
      label: bt.tabControl,
      count: adjustableInvoices.length + refundableInvoices.length,
    },
  ];
  const printJourneyServiceInvoice = (
    invoice: Invoice,
    service: JourneyServiceRow | undefined,
  ) => {
    const patient = invoice.patientId ? visiblePatientsById.get(invoice.patientId) : undefined;
    const serviceCode = service
      ? displayServiceInstanceCode(service, patient)
      : invoice.serviceCode ?? invoice.id;
    const serviceLabel = service
      ? `${service.serviceName} - ${service.object}`
      : bt.serviceTitle;
    const escapeHtml = (value: string | number | null | undefined) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const printWindow = window.open("", "_blank", "width=920,height=720");
    const invoiceSnapshot = service
      ? journeyServiceInvoiceSnapshot(service, invoice)
      : undefined;
    const servicePaidAmount = service
      ? invoiceSnapshot?.paidThroughInvoice ?? 0
      : billingInvoicePaidAmount(invoice);
    const serviceBalanceAmount = service
      ? invoiceSnapshot?.balanceAfterInvoice ?? 0
      : billingInvoiceBalance(invoice);

    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(invoice.id)}</title>
  <style>
    body { background: #edf2f4; color: #0f172a; font-family: Arial, sans-serif; margin: 0; padding: 28px; }
    .invoice { background: #fff; border: 1px solid #d8e0e8; border-radius: 8px; margin: 0 auto; max-width: 860px; padding: 38px; }
    header { align-items: flex-start; border-bottom: 2px solid #0f172a; display: flex; gap: 24px; justify-content: space-between; padding-bottom: 18px; }
    h1 { font-size: 32px; line-height: 1; margin: 0 0 10px; }
    .brand { text-align: right; }
    .brand img { border-radius: 8px; display: block; height: 42px; margin: 0 0 8px auto; width: 42px; }
    .brand strong { display: block; font-size: 24px; }
    .brand span, .muted { color: #64748b; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .grid { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 22px; }
    .box { background: #f8fafc; border: 1px solid #d8e0e8; border-radius: 8px; padding: 14px; }
    .box strong { display: block; margin-top: 5px; overflow-wrap: anywhere; }
    .total { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 22px 0; padding: 16px; }
    .total strong { display: block; font-size: 22px; margin-top: 5px; }
    table { border-collapse: collapse; margin-top: 14px; width: 100%; }
    th, td { border: 1px solid #d8e0e8; padding: 12px; text-align: left; }
    th { background: #f1f5f9; color: #64748b; font-size: 12px; text-transform: uppercase; }
    td:last-child, th:last-child { text-align: right; }
    .notes { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 22px; }
    .signature { display: grid; gap: 40px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 42px; }
    .signature div { border-top: 1px solid #0f172a; min-height: 72px; padding-top: 10px; text-align: center; }
    .print-actions { margin: 0 auto 14px; max-width: 860px; text-align: right; }
    button { border: 1px solid #d8e0e8; border-radius: 7px; cursor: pointer; font-weight: 800; min-height: 36px; padding: 0 14px; }
    @media print { body { background: #fff; padding: 0; } .invoice { border: 0; border-radius: 0; max-width: none; } .print-actions { display: none; } }
  </style>
</head>
<body>
  <div class="print-actions"><button onclick="window.print()">${escapeHtml(bt.print)}</button></div>
  <main class="invoice">
    <header>
      <div>
        <h1>${escapeHtml(bt.localInvoice)}</h1>
        <span class="muted">${escapeHtml(invoice.id)}</span>
      </div>
      <div class="brand">
        <img src="/icons/codexmed-icon.svg" alt="" />
        <strong>Codexdentist</strong>
        <span>SMART DENTAL SOLUTIONS</span>
      </div>
    </header>
    <section class="grid">
      <div class="box"><span class="muted">${escapeHtml(bt.patient)}</span><strong>${escapeHtml(invoice.patient)}</strong></div>
      <div class="box"><span class="muted">${escapeHtml(bt.dueDate)}</span><strong>${escapeHtml(invoice.due)}</strong></div>
      <div class="box"><span class="muted">${escapeHtml(bt.invoiceStatus)}</span><strong>${escapeHtml(displayStatus(invoice.status, language))}</strong></div>
      <div class="box"><span class="muted">${escapeHtml(language === "vi" ? "Mã dịch vụ" : "Service code")}</span><strong>${escapeHtml(serviceCode)}</strong></div>
      <div class="box"><span class="muted">${escapeHtml(bt.serviceTitle)}</span><strong>${escapeHtml(serviceLabel)}</strong></div>
      <div class="box"><span class="muted">${escapeHtml(bt.collectionMethod)}</span><strong>${escapeHtml(bt.localInvoice)}</strong></div>
    </section>
    <section class="total">
      <div><span class="muted">${escapeHtml(bt.amountTotal)}</span><strong>${escapeHtml(formatVnd(service?.finalPrice ?? billingInvoiceAmount(invoice)))}</strong></div>
      <div><span class="muted">${escapeHtml(bt.invoiceThisTime)}</span><strong>${escapeHtml(formatVnd(billingInvoiceAmount(invoice)))}</strong></div>
      <div><span class="muted">${escapeHtml(service ? bt.paidThroughInvoice : bt.amountPaid)}</span><strong>${escapeHtml(formatVnd(servicePaidAmount))}</strong></div>
      <div><span class="muted">${escapeHtml(service ? bt.remainingAfterInvoice : bt.balance)}</span><strong>${escapeHtml(formatVnd(serviceBalanceAmount))}</strong></div>
    </section>
    <table>
      <thead><tr><th>${escapeHtml(bt.serviceTitle)}</th><th>${escapeHtml(bt.invoiceThisTime)}</th></tr></thead>
      <tbody><tr><td>${escapeHtml(serviceCode)} · ${escapeHtml(serviceLabel)}</td><td>${escapeHtml(formatVnd(billingInvoiceAmount(invoice)))}</td></tr></tbody>
    </table>
    <section class="notes">
      <div class="box"><span class="muted">${escapeHtml(bt.invoiceStatus)}</span><p>${escapeHtml(bt.localInvoice)}</p></div>
      <div class="box"><span class="muted">${escapeHtml(bt.creditBalance)}</span><p>${escapeHtml(formatVnd(Math.max(serviceCollectedAmount(service?.id ?? "") - (service?.finalPrice ?? invoice.amount), 0)))}</p></div>
    </section>
    <section class="signature">
      <div>${escapeHtml(language === "vi" ? "Người lập phiếu" : "Prepared by")}</div>
      <div>${escapeHtml(language === "vi" ? "Bệnh nhân" : "Patient")}</div>
    </section>
  </main>
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
  };
  const billingPeriodOptions: Array<{ label: string; value: BillingPeriodFilter }> =
    language === "vi"
      ? [
          { label: "Tất cả", value: "all" },
          { label: "Hôm nay - đã check-in", value: "today" },
          { label: "Tuần này", value: "week" },
          { label: "Tuần trước", value: "last_week" },
          { label: "Tháng này", value: "month" },
          { label: "Tháng trước", value: "last_month" },
        ]
      : [
          { label: "All", value: "all" },
          { label: "Today - checked in", value: "today" },
          { label: "This week", value: "week" },
          { label: "Last week", value: "last_week" },
          { label: "This month", value: "month" },
          { label: "Last month", value: "last_month" },
        ];
  const billingClinicLabel = language === "vi" ? "Chi nhánh" : "Clinic";
  const billingTimeLabel = language === "vi" ? "Thời gian" : "Time";

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">{bt.workflow}</p>
          <h2>{bt.title}</h2>
          {bt.subtitle ? <p className="billing-subtitle">{bt.subtitle}</p> : null}
        </div>
        <SourceBadge source={billingWorkspace?.source} />
      </div>

      {billingSearchSummary ? (
        <div className="chart-search-meta billing-search-meta">
          <span>{billingSearchSummary}</span>
        </div>
      ) : null}

      <div className="billing-operational-filters">
        <label>
          {billingClinicLabel}
          <select
            value={billingClinicFilter}
            onChange={(event) => setBillingClinicFilter(event.target.value)}
          >
            <option value="all">
              {language === "vi" ? "Tất cả chi nhánh" : "All clinics"}
            </option>
            {billingClinicOptions.map((clinic) => (
              <option value={clinic.id} key={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {billingTimeLabel}
          <select
            value={billingPeriodFilter}
            onChange={(event) =>
              setBillingPeriodFilter(event.target.value as BillingPeriodFilter)
            }
          >
            {billingPeriodOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {language === "vi" ? "Hóa đơn" : "Invoice"}
          <select
            value={billingInvoiceFilter}
            onChange={(event) =>
              setBillingInvoiceFilter(event.target.value as BillingInvoiceFilter)
            }
          >
            {invoiceFilterOptions.map((option) => (
              <option value={option.filter} key={option.filter}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>
        <span>
          {language === "vi"
            ? `${periodAppointments.length} lịch hẹn, ${scopedBillingPatients.length} bệnh nhân`
            : `${periodAppointments.length} appointments, ${scopedBillingPatients.length} patients`}
        </span>
      </div>

      {(billingWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(billingWorkspace?.message, language)}
        </div>
      )}

      {bt.alert ? <div className="schedule-alert billing-rule-note">{bt.alert}</div> : null}

      {!selectedBillingPatient && (
        <section className="panel billing-patient-worklist">
          <PanelHeader
            icon={UsersRound}
            title={bt.patientBillingList}
            action={`${patientBillingRows.length}/${scopedBillingPatients.length}`}
          />
          <div className="billing-patient-list">
            {patientBillingRows.length > 0 ? (
              patientBillingRows.map((row) => (
                <button
                  className="billing-patient-card"
                  key={row.patient.id}
                  onClick={() => {
                    setSelectedBillingPatientId(row.patient.id);
                    setBillingSection("collection");
                  }}
                  type="button"
                >
                  <div>
                    <strong>{row.patient.name}</strong>
                    <span>
                      {patientCodeFor(row.patient)} ·{" "}
                      {visibleClinics.find((clinic) => clinic.id === row.patient.clinicId)
                        ?.name ?? row.patient.city}
                    </span>
                  </div>
                  <div>
                    <small>{bt.serviceTitle}</small>
                    <strong>{row.progressedServices.length}</strong>
                  </div>
                  <div>
                    <small>{bt.minimumDue}</small>
                    <strong>{formatVnd(row.minimumDueAmount)}</strong>
                  </div>
                  <div>
                    <small>{bt.amountPaid}</small>
                    <strong>{formatVnd(row.paidAmount)}</strong>
                  </div>
                  <div>
                    <small>{bt.amountDue}</small>
                    <strong>{formatVnd(row.dueAmount)}</strong>
                  </div>
                  <div>
                    <small>{bt.creditBalance}</small>
                    <strong>{formatVnd(row.creditBalance)}</strong>
                  </div>
                  <span>{bt.openPatientBilling}</span>
                </button>
              ))
            ) : (
              <EmptyState label={bt.patientBillingEmpty} />
            )}
          </div>
        </section>
      )}

      {selectedBillingPatient && (
      <>
      <div className="billing-selected-patient-bar">
        <button
          className="secondary-button"
          onClick={() => setSelectedBillingPatientId("")}
          type="button"
        >
          {bt.backToPatients}
        </button>
        <div>
          <strong>{selectedBillingPatient.name}</strong>
          <span>
            {patientCodeFor(selectedBillingPatient)} · {selectedBillingPatient.phone}
          </span>
        </div>
      </div>

      <section className="panel billing-patient-balance-panel">
        <PanelHeader
          icon={WalletCards}
          title={bt.patientBalanceTitle}
          action={formatVnd(selectedBillingPatientBalanceAmount)}
        />
        <div className="record-grid">
          <RecordTile
            title={bt.receiptTotal}
            value={formatVnd(selectedBillingPatientDirectReceiptTotal)}
          />
          <RecordTile
            title={bt.allocatedTotal}
            value={formatVnd(allocatedTotal)}
          />
          <RecordTile
            title={bt.amountDue}
            value={formatVnd(remainingJourneyTotal)}
          />
        </div>
        <form action={recordPatientReceiptAction} className="billing-balance-form">
          <input name="patientId" type="hidden" value={selectedBillingPatient.id} />
          <label>
            {bt.patientReceiptTitle}
            <MoneyInput name="amount" placeholder={bt.collectionAmount} required />
          </label>
          <label>
            {bt.collectionMethod}
            <select name="method" defaultValue="cash" required>
              <option value="cash">{collectionMethodLabel("cash", language)}</option>
              <option value="card">{collectionMethodLabel("card", language)}</option>
              <option value="bank_transfer">
                {collectionMethodLabel("bank_transfer", language)}
              </option>
            </select>
          </label>
          <input name="reference" placeholder={billingAdvancedLabels.reason} />
          <button className="primary-button" type="submit" disabled={!canMutate}>
            {bt.recordReceiptOnly}
          </button>
        </form>
      </section>

      <p className="billing-metric-scope">
        {billingResultScopeActive ? bt.metricScopeFiltered : bt.metricScopeAll}
      </p>

      <div className="metric-grid billing-metric-grid">
        <MetricCard
          label={bt.invoiceTotal}
          value={formatVnd(issuedInvoiceTotal)}
          tone="teal"
        />
        <MetricCard label={bt.openBalances} value={formatVnd(openTotal)} tone="amber" />
        <MetricCard
          label={bt.overdueInvoices}
          value={`${overdueInvoices.length} · ${formatVnd(overdueInvoiceTotal)}`}
          tone="rose"
        />
        <MetricCard
          label={bt.plannedDeposits}
          value={`${plannedDepositServices.length} · ${formatVnd(plannedDepositTotal)}`}
          tone="blue"
        />
      </div>

      <div
        className="segmented billing-workbench-tabs"
        role="tablist"
        aria-label={bt.workflow}
      >
        {billingSectionOptions.map((option) => (
          <button
            aria-selected={billingSection === option.key}
            className={billingSection === option.key ? "active" : ""}
            key={option.key}
            onClick={() => setBillingSection(option.key)}
            role="tab"
            type="button"
          >
            {option.label} <span>{option.count}</span>
          </button>
        ))}
      </div>

      {billingSection === "collection" && (
      <section className="panel">
        <PanelHeader
          icon={WalletCards}
          title={bt.collectionTitle}
          action={`${filteredJourneyServices.length}/${periodJourneyServices.length}`}
        />
        <div
          className="segmented billing-service-filters"
          role="group"
          aria-label={bt.collectionTitle}
        >
          {journeyFilterOptions.map((option) => (
            <button
              className={journeyServiceFilter === option.filter ? "active" : ""}
              type="button"
              key={option.filter}
              onClick={() => setJourneyServiceFilter(option.filter)}
            >
              {option.label} <span>{option.count}</span>
            </button>
          ))}
        </div>
        <div className="journey-billing-list">
          {filteredJourneyServices.length > 0 ? (
            filteredJourneyServices.map((service) => {
              const patient = visiblePatientsById.get(service.patientId);
              const serviceInvoices = activeServiceInvoices(service.id);
              const invoicedAmount = serviceInvoicedAmount(service.id);
              const uninvoicedAmount = serviceUninvoicedAmount(service);
              const creditAppliedAmount = serviceCreditAllocationAmount(service.id);
              const appliedAmount = serviceAppliedAmount(service.id);
              const remainingAmount = Math.max(service.finalPrice - appliedAmount, 0);
              const remainingInvoiceCapacity = serviceRemainingInvoiceCapacity(service);
              const progressPercent = serviceProgressPercent(service.progress);
              const collectedPercent =
                service.finalPrice > 0
                  ? Math.min(Math.round((appliedAmount / service.finalPrice) * 100), 100)
                  : 0;
              const isPlannedDeposit =
                progressPercent <= 0 &&
                !serviceProgressIsCancelled(service.progress) &&
                appliedAmount > 0;
              const receiptDraft = receiptDrafts[service.id] ?? {
                amount: "",
                method: "cash" as JourneyCollectionMethod,
              };
              const serviceAllocationFromBalance = service.source === "database";
              const isCreditMethod =
                serviceAllocationFromBalance || receiptDraft.method === "credit_balance";
              const receiptDraftAmount = Math.max(Number(receiptDraft.amount) || 0, 0);
              const actionDisabled = isCreditMethod
                ? unappliedReceiptTotal <= 0 || remainingAmount <= 0
                : receiptDraftAmount <= 0;
              const recordAndInvoiceDisabled =
                actionDisabled || remainingInvoiceCapacity <= 0;
              const serviceState = serviceProgressIsCancelled(service.progress)
                ? displayStatus("Cancelled", language)
                : isPlannedDeposit
                  ? bt.filterDeposit
                : remainingAmount <= 0
                  ? bt.complete
                  : progressPercent > 0
                    ? bt.serviceReady
                    : bt.depositAllowed;
              const serviceStateClass = serviceProgressIsCancelled(service.progress)
                ? "cancelled"
                : isPlannedDeposit
                  ? "waiting"
                : remainingAmount <= 0
                  ? "settled"
                  : progressPercent > 0
                    ? "action"
                    : "waiting";
              const invoiceLabel = service.invoiceId
                ? `${service.invoiceId} · ${
                    bt.issued
                  }`
                : bt.noInvoice;
              const displayedInvoiceLabel =
                serviceInvoices.length > 0
                  ? `${serviceInvoices.length} ${bt.invoiceCount} · ${formatVnd(
                      invoicedAmount,
                    )} / ${formatVnd(service.finalPrice)}`
                  : bt.noInvoice;
              const invoiceActionLabel =
                uninvoicedAmount > 0
                  ? bt.issueMissingInvoice
                  : invoicedAmount >= service.finalPrice
                    ? bt.invoiceComplete
                    : bt.waitingForMoreCollection;

              return (
                <article className="journey-billing-item" key={service.id}>
                  <div className="journey-billing-head">
                    <div>
                      <strong>{service.serviceName}</strong>
                      <span>
                        {displayServiceInstanceCode(service, patient)} ·{" "}
                        {patient?.name ?? service.patientId} · {service.object}
                      </span>
                    </div>
                    <div className="billing-service-badges">
                      <span className={`billing-service-state ${serviceStateClass}`}>
                        {serviceState}
                      </span>
                      <StatusPill status={service.progress} />
                    </div>
                  </div>
                  <div className="journey-billing-stats">
                    <span>
                      <small>{bt.amountTotal}</small>
                      <strong>{formatVnd(service.finalPrice)}</strong>
                    </span>
                    <span>
                      <small>{bt.amountPaid}</small>
                      <strong>{formatVnd(appliedAmount)}</strong>
                      {creditAppliedAmount > 0 && (
                        <small className="billing-credit-note">
                          {bt.creditApplied}: {formatVnd(creditAppliedAmount)}
                        </small>
                      )}
                    </span>
                    <span>
                      <small>{bt.amountDue}</small>
                      <strong>{formatVnd(remainingAmount)}</strong>
                    </span>
                    <span>
                      <small>{bt.invoiceStatus}</small>
                      <strong>{displayedInvoiceLabel}</strong>
                    </span>
                  </div>
                  {serviceInvoices.length > 0 && (
                    <div className="billing-service-invoice-list">
                      {serviceInvoices.map((invoice) => (
                        <span key={invoice.id}>
                          <strong>{invoice.id}</strong>
                          {formatVnd(billingInvoiceAmount(invoice))} ·{" "}
                          {displayStatus(invoice.status, language)}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="billing-service-progress">
                    <span>
                      <i style={{ width: `${collectedPercent}%` }} />
                    </span>
                    <small>
                      {bt.collected}: {collectedPercent}% · {bt.progress}: {progressPercent}%
                    </small>
                  </div>
                  {service.source === "database" ? (
                    <form
                      action={recordServiceReceiptAction}
                      className="journey-billing-controls"
                      onSubmit={(event) => {
                        const submitter = (event.nativeEvent as SubmitEvent)
                          .submitter as HTMLButtonElement | null;
                        const actionKind = submitter?.dataset.actionKind ?? "receipt";
                        const message =
                          actionKind === "receipt_and_invoice"
                            ? billingAdvancedLabels.confirmReceiptAndInvoice
                            : actionKind === "issue_invoice"
                              ? billingAdvancedLabels.confirmIssueInvoice
                              : billingAdvancedLabels.confirmReceipt;

                        if (!window.confirm(message)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input
                        name="treatmentServiceId"
                        type="hidden"
                        value={service.id}
                      />
                      <input name="method" type="hidden" value="credit_balance" />
                      <MoneyInput
                        aria-label={bt.collectionAmount}
                        name="amount"
                        value={receiptDraft.amount}
                        onValueChange={(amount) => updateReceiptDraft(service.id, { amount })}
                        placeholder={
                          isCreditMethod ? bt.allocationAmount : bt.collectionAmount
                        }
                      />
                      <button
                        className="secondary-button"
                        type="submit"
                        data-action-kind="receipt"
                        value="receipt"
                        disabled={!canMutate || actionDisabled}
                      >
                        {bt.allocateFromBalance}
                      </button>
                      <button
                        className="primary-button"
                        type="submit"
                        data-action-kind="receipt_and_invoice"
                        value="receipt_and_invoice"
                        formAction={recordServiceReceiptAndInvoiceAction}
                        disabled={!canMutate || recordAndInvoiceDisabled}
                      >
                        {bt.allocateAndInvoiceFromBalance}
                      </button>
                      <button
                        className="secondary-button"
                        type="submit"
                        data-action-kind="issue_invoice"
                        value="issue_invoice"
                        formAction={issueServiceInvoiceAction}
                        disabled={!canMutate || uninvoicedAmount <= 0}
                      >
                        {invoiceActionLabel}
                      </button>
                    </form>
                  ) : (
                    <div className="journey-billing-controls">
                      <MoneyInput
                        aria-label={bt.collectionAmount}
                        value={receiptDraft.amount}
                        name={`receiptDraft-${service.id}`}
                        onValueChange={(amount) => updateReceiptDraft(service.id, { amount })}
                        placeholder={
                          isCreditMethod ? bt.allocationAmount : bt.collectionAmount
                        }
                      />
                      <select
                        aria-label={bt.collectionMethod}
                        value={receiptDraft.method}
                        onChange={(event) =>
                          updateReceiptDraft(service.id, {
                            method: isJourneyCollectionMethod(event.target.value)
                              ? event.target.value
                              : "cash",
                          })
                        }
                      >
                        <option value="cash">
                          {collectionMethodLabel("cash", language)}
                        </option>
                        <option value="card">
                          {collectionMethodLabel("card", language)}
                        </option>
                        <option value="bank_transfer">
                          {collectionMethodLabel("bank_transfer", language)}
                        </option>
                        <option value="credit_balance">
                          {collectionMethodLabel("credit_balance", language)}
                        </option>
                      </select>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={actionDisabled}
                        onClick={() =>
                          recordReceiptForService(service, { issueInvoice: false })
                        }
                      >
                        {bt.recordReceiptOnly}
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={recordAndInvoiceDisabled}
                        onClick={() =>
                          recordReceiptForService(service, { issueInvoice: true })
                        }
                      >
                        {bt.recordReceiptAndInvoice}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={uninvoicedAmount <= 0}
                        onClick={() => issueInvoiceForService(service)}
                      >
                        {invoiceActionLabel}
                      </button>
                    </div>
                  )}
                </article>
              );
            })
          ) : (
            <EmptyState label={bt.emptyServices} />
          )}
        </div>
      </section>
      )}

      {billingSection === "invoices" && (
      <>
      <details className="billing-admin-details billing-manual-details">
        <summary>{bt.manualInvoice}</summary>
        <div className="billing-manual-details-body">
          <div className="panel-header">
            <div>
              <FileText size={18} aria-hidden="true" />
              <strong>{bt.manualInvoice}</strong>
            </div>
            <span className="billing-admin-action-label">{bt.createInvoice}</span>
          </div>
          <p className="billing-panel-note">{bt.manualInvoiceHint}</p>
          <form action={createInvoiceAction} className="billing-form">
            <label>
              {bt.patient}
              <select name="patientId" disabled={!formReady} required>
                {formPatients.map((patient) => (
                  <option value={patient.id} key={patient.id}>
                    {patient.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {bt.amountTotal}
              <MoneyInput name="amount" placeholder="9.800.000" disabled={!formReady} required />
            </label>
            <label>
              {bt.dueDate}
              <input
                name="dueDate"
                type="date"
                defaultValue={dueDate}
                disabled={!formReady}
              />
            </label>
            <button className="primary-button" type="submit" disabled={!formReady}>
              <WalletCards size={16} />
              {bt.createInvoice}
            </button>
          </form>
        </div>
      </details>
      </>
      )}

      {billingSection === "control" && billingWorkspace?.source === "database" && (
        <details className="billing-admin-details">
          <summary>{bt.advancedTools}</summary>
          <div className="content-grid service-management-grid">
            <section className="panel">
            <PanelHeader icon={CreditCard} title={billingAdvancedLabels.adjustment} action={billingAdvancedLabels.audit} />
            <form
              action={adjustInvoiceAmountAction}
              className="staff-form"
              onSubmit={(event) => {
                if (!window.confirm(billingAdvancedLabels.confirmAdjust)) {
                  event.preventDefault();
                }
              }}
            >
              <label>
                {bt.invoiceList}
                <select name="invoiceNo" disabled={!canMutate || adjustableInvoices.length === 0} required>
                  {adjustableInvoices.map((invoice) => (
                    <option value={invoice.id} key={invoice.id}>
                      {invoice.id} - {invoice.patient}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {billingAdvancedLabels.amountNew}
                <MoneyInput name="amount" disabled={!canMutate} required />
              </label>
              <label className="clinical-wide">
                {billingAdvancedLabels.reason}
                <textarea name="reason" disabled={!canMutate} />
              </label>
              <button className="primary-button" type="submit" disabled={!canMutate || adjustableInvoices.length === 0}>
                {billingAdvancedLabels.adjustment}
              </button>
            </form>
            </section>

            <section className="panel">
            <PanelHeader icon={WalletCards} title={billingAdvancedLabels.refund} action={billingAdvancedLabels.ledger} />
            <form
              action={recordInvoiceRefundAction}
              className="staff-form"
              onSubmit={(event) => {
                if (!window.confirm(billingAdvancedLabels.confirmRefund)) {
                  event.preventDefault();
                }
              }}
            >
              <label>
                {bt.invoiceList}
                <select name="invoiceNo" disabled={!canMutate || refundableInvoices.length === 0} required>
                  {refundableInvoices.map((invoice) => (
                    <option value={invoice.id} key={invoice.id}>
                      {invoice.id} - {invoice.patient}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {billingAdvancedLabels.refundAmount}
                <MoneyInput name="amount" disabled={!canMutate} required />
              </label>
              <label>
                {bt.collectionMethod}
                <select name="method" defaultValue="cash" disabled={!canMutate}>
                  <option value="cash">{receiptMethodLabel("cash", language)}</option>
                  <option value="card">{receiptMethodLabel("card", language)}</option>
                  <option value="bank_transfer">{receiptMethodLabel("bank_transfer", language)}</option>
                </select>
              </label>
              <input name="reference" placeholder={billingAdvancedLabels.reason} disabled={!canMutate} />
              <button className="primary-button" type="submit" disabled={!canMutate || refundableInvoices.length === 0}>
                {billingAdvancedLabels.refund}
              </button>
            </form>
            </section>

            <section className="panel">
            <PanelHeader icon={Bell} title={billingAdvancedLabels.paymentPlan} action={`${visiblePaymentPlans.length}`} />
            <form action={createPaymentPlanAction} className="staff-form">
              <label>
                {bt.patient}
                <select name="patientId" disabled={!formReady} required>
                  {formPatients.map((patient) => (
                    <option value={patient.id} key={patient.id}>
                      {patient.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {bt.amountTotal}
                <MoneyInput name="amount" disabled={!formReady} required />
              </label>
              <label>
                {billingAdvancedLabels.firstDueAt}
                <input name="firstDueAt" type="date" defaultValue={dueDate} disabled={!formReady} />
              </label>
              <label>
                {billingAdvancedLabels.installmentCount}
                <input name="installmentCount" inputMode="numeric" defaultValue="3" disabled={!formReady} />
              </label>
              <label>
                {billingAdvancedLabels.intervalDays}
                <input name="intervalDays" inputMode="numeric" defaultValue="30" disabled={!formReady} />
              </label>
              <label className="clinical-wide">
                {billingAdvancedLabels.reason}
                <textarea name="note" disabled={!formReady} />
              </label>
              <button className="primary-button" type="submit" disabled={!formReady}>
                {billingAdvancedLabels.paymentPlan}
              </button>
            </form>
            </section>
          </div>
        </details>
      )}

      {billingSection === "invoices" && (
      <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <WalletCards size={18} aria-hidden="true" />
            <strong>{bt.invoiceList}</strong>
          </div>
          <a className="panel-action-link" href="/billing/export">
            <Download size={14} aria-hidden="true" />
            {bt.exportCsv}
          </a>
        </div>
        <div className="invoice-list">
          {filteredInvoices.length > 0 ? (
          filteredInvoices.map((invoice) => {
            const isJourneyInvoice = journeyInvoiceIds.has(invoice.id);
            const relatedService =
              (invoice.serviceId ? journeyServicesById.get(invoice.serviceId) : undefined) ??
              (isJourneyInvoice ? journeyServicesByInvoiceId.get(invoice.id) : undefined);
            const invoiceSnapshot = relatedService
              ? journeyServiceInvoiceSnapshot(relatedService, invoice)
              : undefined;
            const relatedServiceCollected = relatedService
              ? serviceCollectedAmount(relatedService.id)
              : 0;
            const relatedServiceUnapplied =
              relatedService && invoiceSnapshot?.isLatestInvoice
                ? Math.max(relatedServiceCollected - relatedService.finalPrice, 0)
                : 0;
            const displayedInvoiceAmount = billingInvoiceAmount(invoice);
            const displayedServiceAmount = relatedService?.finalPrice ?? displayedInvoiceAmount;
            const displayedPaidAmount = relatedService
              ? invoiceSnapshot?.paidThroughInvoice ?? 0
              : billingInvoicePaidAmount(invoice);
            const displayedBalance = relatedService
              ? invoiceSnapshot?.balanceAfterInvoice ?? 0
              : billingInvoiceBalance(invoice);
            const canChangeInvoice =
              (canMutate || isJourneyInvoice) && isCollectableInvoice(invoice);

            return (
              <div className="invoice-row billing-invoice-row" key={invoice.id}>
                <div>
                  <strong>{invoice.id}</strong>
                  <span>
                    {relatedService
                      ? `${displayServiceInstanceCode(
                          relatedService,
                          visiblePatientsById.get(relatedService.patientId),
                        )} · `
                      : ""}
                    {invoice.patient}
                    {isJourneyInvoice ? ` · ${bt.localInvoice}` : ""}
                  </span>
                </div>
                <div className="billing-invoice-cell">
                  <span>{bt.dueDate}</span>
                  <strong>{invoice.due}</strong>
                </div>
                <div className="billing-invoice-cell">
                  <span>{bt.amountTotal}</span>
                  <strong>{formatVnd(displayedServiceAmount)}</strong>
                  {relatedService && (
                    <small className="billing-credit-note">
                      {bt.invoiceThisTime}: {formatVnd(displayedInvoiceAmount)}
                    </small>
                  )}
                </div>
                <div className="billing-invoice-cell">
                  <span>{relatedService ? bt.paidThroughInvoice : bt.amountPaid}</span>
                  <strong>{formatVnd(displayedPaidAmount)}</strong>
                </div>
                <div className="billing-invoice-cell">
                  <span>{relatedService ? bt.remainingAfterInvoice : bt.balance}</span>
                  <strong>{formatVnd(displayedBalance)}</strong>
                  {relatedServiceUnapplied > 0 && (
                    <small className="billing-credit-note">
                      {bt.creditBalance}: {formatVnd(relatedServiceUnapplied)}
                    </small>
                  )}
                </div>
                <StatusPill status={invoice.status} />
                <div className="invoice-actions">
                  {isJourneyInvoice ? (
                    <>
                      <button
                        type="button"
                        onClick={() => printJourneyServiceInvoice(invoice, relatedService)}
                      >
                        <Printer size={13} aria-hidden="true" />
                        {bt.print}
                      </button>
                      <span className="invoice-local-note">{bt.localInvoice}</span>
                    </>
                  ) : (
                    <Link href={`/billing/print/${encodeURIComponent(invoice.id)}`}>
                      <Printer size={13} aria-hidden="true" />
                      {bt.print}
                    </Link>
                  )}
                  {canChangeInvoice && (
                    <>
                      {isJourneyInvoice ? (
                        <form onSubmit={handleLocalPayment}>
                          <input name="invoiceNo" type="hidden" value={invoice.id} />
                          <MoneyInput
                            name="amount"
                            placeholder={bt.paidAmount}
                            required
                          />
                          <select name="method" defaultValue="cash">
                            <option value="cash">
                              {receiptMethodLabel("cash", language)}
                            </option>
                            <option value="card">
                              {receiptMethodLabel("card", language)}
                            </option>
                            <option value="bank_transfer">
                              {receiptMethodLabel("bank_transfer", language)}
                            </option>
                          </select>
                          <button type="submit">{bt.recordPayment}</button>
                        </form>
                      ) : (
                        <form action={recordPaymentAction}>
                          <input name="invoiceNo" type="hidden" value={invoice.id} />
                          <MoneyInput
                            name="amount"
                            placeholder={bt.paidAmount}
                            required
                          />
                          <select name="method" defaultValue="cash">
                            <option value="cash">
                              {receiptMethodLabel("cash", language)}
                            </option>
                            <option value="card">
                              {receiptMethodLabel("card", language)}
                            </option>
                            <option value="bank_transfer">
                              {receiptMethodLabel("bank_transfer", language)}
                            </option>
                          </select>
                          <button type="submit">{bt.recordPayment}</button>
                        </form>
                      )}
                      {isJourneyInvoice ? (
                        <button
                          className="danger-link"
                          type="button"
                          onClick={() => {
                            if (window.confirm(billingAdvancedLabels.confirmVoid)) {
                              onVoidJourneyInvoice(invoice.id);
                            }
                          }}
                        >
                          {bt.cancel}
                        </button>
                      ) : (
                        <form
                          action={voidInvoiceAction}
                          onSubmit={(event) => {
                            if (!window.confirm(billingAdvancedLabels.confirmVoid)) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <input name="invoiceNo" type="hidden" value={invoice.id} />
                          <button className="danger-link" type="submit">
                            {bt.cancel}
                          </button>
                        </form>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
          ) : (
            <EmptyState label={bt.emptyInvoices} />
          )}
        </div>
      </section>
      </>
      )}

      {billingSection === "receipts" && billingWorkspace?.source === "database" && (
        <section className="content-grid service-management-grid">
          <section className="panel">
            <PanelHeader
              icon={WalletCards}
              title={bt.recentReceipts}
              action={`${recentDatabaseReceipts.length}`}
            />
            <div className="record-grid">
              {recentDatabaseReceipts.length > 0 ? (
                recentDatabaseReceipts.map((receipt) => (
                  <RecordTile
                    key={receipt.id}
                    title={`${receipt.receiptNo} · ${receipt.patientName}`}
                    value={`${formatVnd(receipt.amount)} · ${
                      isJourneyCollectionMethod(receipt.method)
                        ? collectionMethodLabel(receipt.method, language)
                        : receipt.method
                    } · ${receipt.receivedAt}`}
                  />
                ))
              ) : (
                <EmptyState
                  label={bt.noReceipts}
                />
              )}
            </div>
          </section>
        </section>
      )}

      {billingSection === "balances" && billingWorkspace?.source === "database" && (
        <section className="content-grid service-management-grid">
          <section className="panel">
            <PanelHeader
              icon={CreditCard}
              title={bt.unappliedBalance}
              action={formatVnd(unappliedReceiptTotal)}
            />
            <div className="record-grid">
              {activeCreditBalances.length > 0 ? (
                activeCreditBalances.map((balance) => {
                  const patient = visiblePatientsById.get(balance.patientId);

                  return (
                    <RecordTile
                      key={balance.patientId}
                      title={patient ? `${patientCodeFor(patient)} · ${patient.name}` : balance.patientId}
                      value={formatVnd(balance.amount)}
                    />
                  );
                })
              ) : (
                <EmptyState
                  label={bt.noUnappliedBalance}
                />
              )}
            </div>
          </section>

          <section className="panel">
            <PanelHeader
              icon={FileText}
              title={billingAdvancedLabels.statement}
              action={`${visibleStatementLines.length}`}
            />
            <div className="invoice-list">
              {visibleStatementLines.length > 0 ? (
                visibleStatementLines.slice(-14).reverse().map((line) => (
                  <div className="invoice-row billing-invoice-row" key={line.id}>
                    <div>
                      <strong>{line.patientName}</strong>
                      <span>
                        {statementKindLabel(line.kind, language)} · {line.description}
                      </span>
                      <small>{line.date}</small>
                    </div>
                    <div className="billing-invoice-cell">
                      <span>{bt.statementDebit}</span>
                      <strong>{line.debit > 0 ? formatVnd(line.debit) : "-"}</strong>
                    </div>
                    <div className="billing-invoice-cell">
                      <span>{bt.statementCredit}</span>
                      <strong>{line.credit > 0 ? formatVnd(line.credit) : "-"}</strong>
                    </div>
                    <div className="billing-invoice-cell">
                      <span>{bt.balance}</span>
                      <strong>{statementBalanceLabel(line.balanceAfter, language)}</strong>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState label={bt.emptyInvoices} />
              )}
            </div>
          </section>

          <section className="panel">
            <PanelHeader
              icon={WalletCards}
              title={bt.creditAllocationHistory}
              action={`${creditBalanceAllocationReceipts.length}`}
            />
            <div className="record-grid">
              {creditBalanceAllocationReceipts.length > 0 ? (
                creditBalanceAllocationReceipts.slice(0, 12).map((receipt) => (
                  <RecordTile
                    key={receipt.id}
                    title={`${receipt.receiptNo} · ${receipt.patientName}`}
                    value={`${formatVnd(receipt.amount)} · ${bt.creditApplied} · ${receipt.receivedAt}`}
                  />
                ))
              ) : (
                <EmptyState label={bt.noUnappliedBalance} />
              )}
            </div>
          </section>

          <section className="panel">
            <PanelHeader
              icon={WalletCards}
              title={billingAdvancedLabels.paymentPlanList}
              action={`${visiblePaymentPlans.length}`}
            />
            <div className="invoice-list">
              {visiblePaymentPlans.length > 0 ? (
                visiblePaymentPlans.slice(0, 8).map((plan) => (
                  <div className="invoice-row billing-invoice-row" key={plan.id}>
                    <div>
                      <strong>{plan.planNo} · {plan.patientName}</strong>
                      <span>{formatVnd(plan.totalAmount)} · {displayStatus(plan.status, language)}</span>
                      <small>{plan.note ?? plan.createdAt}</small>
                    </div>
                    <div className="record-grid">
                      {plan.installments.slice(0, 4).map((installment) => (
                        <RecordTile
                          key={installment.id}
                          title={`${installment.sequence}. ${installment.dueAt}`}
                          value={`${formatVnd(installment.amount)} · ${displayStatus(installment.status, language)}`}
                        />
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState label={billingAdvancedLabels.paymentPlanList} />
              )}
            </div>
          </section>

          <section className="panel">
            <PanelHeader
              icon={Bell}
              title={billingAdvancedLabels.paymentPlan}
              action={`${visiblePaymentPlanReminders.length}`}
            />
            <div className="record-grid">
              {visiblePaymentPlanReminders.length > 0 ? (
                visiblePaymentPlanReminders.slice(0, 12).map((reminder) => (
                  <RecordTile
                    key={reminder.id}
                    title={`${reminder.patientName ?? reminder.recipient} · ${reminder.scheduledAt ?? "-"}`}
                    value={`${reminder.amount ? formatVnd(reminder.amount) : "-"} · ${displayStatus(reminder.status, language)}`}
                  />
                ))
              ) : (
                <EmptyState label={billingAdvancedLabels.paymentPlan} />
              )}
            </div>
          </section>
        </section>
      )}
      </>
      )}
    </section>
  );
}

