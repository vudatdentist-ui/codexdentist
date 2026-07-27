"use client";

import { Activity, CalendarDays, ClipboardList, FileText, MessageSquareText, Search, Stethoscope, Trash2, UsersRound, WalletCards } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FocusEvent, type FormEvent } from "react";
import { createClinicalNoteAction } from "@/app/(app)/clinical/actions";
import { updatePatientFileGovernanceAction } from "@/app/(app)/patient-files/actions";
import { createJourneyCommentAction, createJourneyTreatmentServicesAction, deleteJourneyTreatmentServiceAction, recordJourneyServiceProgressAction, updateJourneyStateAction, updateJourneyTreatmentServiceDiscountAction } from "@/app/(app)/journey/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { MoneyInput } from "@/components/MoneyInput";
import { PatientOdontogramEditor } from "@/components/PatientOdontogramEditor";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, PanelHeader, StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import { invoiceBalanceAmount, isCollectableInvoiceStatus, serviceAppliedAmount as calculateServiceAppliedAmount } from "@/lib/billing-calculations";
import { formatVnd, type Appointment, type Clinic, type Invoice, type Patient, type TreatmentPlan } from "@/lib/data";
import { hasAnyRole } from "@/lib/permissions";
import type { BillingWorkspace } from "@/lib/billing-types";
import type { ClinicalWorkspace as ClinicalWorkspaceData } from "@/lib/clinical-types";
import type { CrmWorkspace } from "@/lib/crm-types";
import type { FormsWorkspace } from "@/lib/forms-types";
import type { JourneyRecordsWorkspace } from "@/lib/journey-records-types";
import {
  compareJourneyTimelineEvents,
  formatJourneyTimelineDateTime,
  journeyTimelineTimestamp,
} from "@/lib/journey-timeline";
import type { PatientFilesWorkspace } from "@/lib/patient-files-types";
import type { PatientWorkspace } from "@/lib/patient-types";
import type { PharmacyWorkspace } from "@/lib/pharmacy-types";
import type { ScheduleWorkspace } from "@/lib/schedule-types";
import type { ServiceStepSummary, ServicesWorkspace } from "@/lib/services-types";
import type { AppSession } from "@/lib/session";
import type { SettingsWorkspace } from "@/lib/settings-types";
import type { TreatmentWorkspace } from "@/lib/treatment-types";
import { serviceCatalog as serviceLibrary, type DentalServiceCatalogItem } from "@/lib/service-catalog";

const statusText: Record<Language, Record<string, string>> = {
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

function displayStatus(status: string, language: Language) {
  return statusText[language][status] ?? status;
}

function statusClass(status: string) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();

  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}

function formatFileSize(bytes: number) {
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

function timelineFileKind(fileName: string | null | undefined, mimeType: string | null | undefined) {
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

function timelineFileKindLabel(kind: string | null | undefined, language: Language) {
  const labels: Record<string, Record<Language, string>> = {
    document: { en: "Document", vi: "Tài liệu" },
    image: { en: "Image", vi: "Ảnh" },
    model3d: { en: "3D file", vi: "File 3D" },
    pdf: { en: "PDF", vi: "PDF" },
    video: { en: "Video", vi: "Video" },
  };

  return kind ? labels[kind]?.[language] ?? kind : "";
}


function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { t } = useAppLanguage();

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? t.databaseLive : t.demoMode}
    </span>
  );
}

function noticeText(notice: string | null, language: Language) {
  const notices: Record<string, Record<Language, string>> = {
    "clinical-created": { vi: "Đã tạo ghi chú lâm sàng.", en: "Clinical note created." },
    "journey-service-created": { vi: "Đã tạo dịch vụ điều trị trong timeline bệnh nhân.", en: "Treatment service created in the patient timeline." },
    "journey-discount-updated": { vi: "Đã cập nhật giảm giá dịch vụ.", en: "Service discount updated." },
    "journey-service-deleted": { vi: "Đã xóa dịch vụ điều trị.", en: "Treatment service deleted." },
    "journey-progress-recorded": { vi: "Đã ghi nhận tiến độ dịch vụ.", en: "Service progress recorded." },
    "journey-state-saved": { vi: "Đã lưu bệnh án Journey.", en: "Journey record saved." },
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

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();
  return noticeText(notice, language);
}

function workspaceMessageText(message: string | null | undefined, language: Language) {
  if (!message || language !== "vi") return message;

  const viMessages: Record<string, string> = {
    "Chưa có dữ liệu trong phạm vi hiện tại.":
      "Chưa có dữ liệu trong phạm vi hiện tại.",
  };

  return viMessages[message] ?? message;
}

function invoiceBalance(invoice: Invoice) {
  return invoiceBalanceAmount(invoice.amount, invoice.paidAmount);
}

function isCollectableInvoice(invoice: Invoice) {
  return isCollectableInvoiceStatus(invoice.status);
}

type JourneyReceiptMethod = "cash" | "card" | "bank_transfer";
type JourneyCollectionMethod = JourneyReceiptMethod | "credit_balance";

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

function receiptMethodLabelForBilling(method: string, language: Language) {
  if (method === "cash" || method === "card" || method === "bank_transfer") {
    return receiptMethodLabel(method, language);
  }

  const labels: Record<string, Record<Language, string>> = {
    credit_balance: { vi: "Tiền dư/chưa phân bổ", en: "Credit balance" },
    service_receipt: { vi: "Phiếu thu dịch vụ", en: "Service receipt" },
  };

  return labels[method]?.[language] ?? method;
}

const odontogramRows = [
  {
    label: "Hàm trên",
    position: "upper",
    teeth: [
      "18",
      "17",
      "16",
      "15",
      "14",
      "13",
      "12",
      "11",
      "21",
      "22",
      "23",
      "24",
      "25",
      "26",
      "27",
      "28",
    ],
  },
  {
    label: "Hàm dưới",
    position: "lower",
    teeth: [
      "48",
      "47",
      "46",
      "45",
      "44",
      "43",
      "42",
      "41",
      "31",
      "32",
      "33",
      "34",
      "35",
      "36",
      "37",
      "38",
    ],
  },
] as const;

const archTargets = [
  { id: "ARCH_UPPER", label: "HÀM TRÊN", labelEn: "UPPER ARCH" },
  { id: "ARCH_LOWER", label: "HÀM DƯỚI", labelEn: "LOWER ARCH" },
  { id: "ARCH_BOTH", label: "HAI HÀM", labelEn: "BOTH ARCHES" },
  { id: "TOOTH_GROUP", label: "NHÓM RĂNG", labelEn: "TOOTH GROUP" },
] as const;
const archTargetIds: ReadonlySet<string> = new Set(
  archTargets.map((target) => target.id),
);

function isArchTarget(target: string) {
  return archTargetIds.has(target);
}

function isToothTarget(target: string) {
  return /^R\d{2}$/.test(target);
}

function treatmentTargetLabel(target: string, language: Language = "vi") {
  const archTarget = archTargets.find((candidate) => candidate.id === target);

  if (!archTarget) {
    return target;
  }

  return language === "en" ? archTarget.labelEn : archTarget.label;
}

function serviceTargetsFromSelection(targets: string[], language: Language) {
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

function serviceLibraryName(service: DentalServiceCatalogItem, language: Language) {
  return language === "en" ? service.nameEn : service.name;
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

function patientSearchDisplayLabel(patient: PatientSearchRecord) {
  return `${patientCodeFor(patient)} - ${patient.name} - ${patient.phone}`;
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

function patientGenderLabel(gender: string | null | undefined, language: Language) {
  const normalizedGender = String(gender ?? "UNKNOWN").toUpperCase();

  if (normalizedGender === "FEMALE") {
    return language === "vi" ? "Nữ" : "Female";
  }

  if (normalizedGender === "MALE") {
    return language === "vi" ? "Nam" : "Male";
  }

  if (normalizedGender === "OTHER") {
    return language === "vi" ? "Khác" : "Other";
  }

  return language === "vi" ? "Chưa rõ" : "Unknown";
}

type PatientSearchRecord = Pick<Patient, "id" | "name" | "phone"> &
  Partial<
    Pick<
      Patient,
      | "address"
      | "age"
      | "city"
      | "consent"
      | "email"
      | "flags"
      | "gender"
      | "guardianName"
      | "leadSource"
      | "nationalId"
      | "patientCode"
      | "visitReason"
    >
  >;

function patientLeadSourceOptions(language: Language) {
  return [
    { value: "WALK_IN", label: language === "vi" ? "Vãng lai" : "Walk-in" },
    { value: "FACEBOOK_ADS", label: "Facebook Ads" },
    { value: "GOOGLE_ADS", label: "Google Ads" },
    { value: "TIKTOK", label: "TikTok" },
    { value: "SOCIAL", label: language === "vi" ? "Social / cộng đồng" : "Social / community" },
    { value: "TELESALE", label: "Telesale" },
    { value: "WEBSITE", label: "Website" },
    { value: "ZALO", label: "Zalo" },
    {
      value: "PATIENT_REFERRAL",
      label: language === "vi" ? "Bệnh nhân giới thiệu" : "Patient referral",
    },
    {
      value: "STAFF_REFERRAL",
      label: language === "vi" ? "Nhân sự giới thiệu" : "Staff referral",
    },
    { value: "PARTNER", label: language === "vi" ? "Đối tác" : "Partner" },
    { value: "OTHER", label: language === "vi" ? "Khác" : "Other" },
  ];
}

function patientLeadSourceLabel(source: string | null | undefined, language: Language) {
  const normalizedSource = String(source ?? "WALK_IN").toUpperCase();

  return (
    patientLeadSourceOptions(language).find((option) => option.value === normalizedSource)
      ?.label ?? normalizedSource
  );
}

function PatientSearchCombobox({
  disabled = false,
  hideIcon = false,
  query,
  onQueryChange,
  matches,
  selectedPatient,
  placeholder,
  selectLabel,
  noResultsLabel,
  onSelect,
}: {
  disabled?: boolean;
  hideIcon?: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  matches: PatientSearchRecord[];
  selectedPatient?: PatientSearchRecord | null;
  placeholder: string;
  selectLabel: string;
  noResultsLabel: string;
  onSelect: (patient: PatientSearchRecord) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const normalizedQuery = normalizeSearchText(query.trim());
  const selectedPatientLabel = selectedPatient ? patientSearchDisplayLabel(selectedPatient) : "";
  const inputValue = query || selectedPatientLabel;
  const visibleMatches = normalizedQuery
    ? matches.filter((patient) => patient.id !== selectedPatient?.id).slice(0, 8)
    : [];
  const shouldShowResults = isOpen && normalizedQuery.length > 0;

  return (
    <div className="patient-search-combobox">
      <label className="search-field topbar-search-field patient-search-input">
        {!hideIcon && <Search size={16} aria-hidden="true" />}
        <input
          ref={inputRef}
          aria-autocomplete="list"
          aria-expanded={shouldShowResults}
          aria-label={selectLabel}
          disabled={disabled}
          onBlur={() => setIsOpen(false)}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);

            if (!query && selectedPatientLabel) {
              requestAnimationFrame(() => inputRef.current?.select());
            }
          }}
          placeholder={placeholder}
          value={inputValue}
        />
      </label>
      {shouldShowResults ? (
        <div className="patient-search-results" role="listbox" aria-label={selectLabel}>
          {visibleMatches.length > 0 ? (
            visibleMatches.map((patient) => (
              <button
                className="patient-search-option"
                key={patient.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(patient);
                  setIsOpen(false);
                }}
                role="option"
                type="button"
              >
                <strong>{patient.name}</strong>
                <span>
                  {patientCodeFor(patient)} - {patient.phone}
                  {patient.email ? ` - ${patient.email}` : ""}
                </span>
              </button>
            ))
          ) : (
            <div className="patient-search-empty">{noResultsLabel}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function patientMatchesExactSelectorSearch(patient: PatientSearchRecord, query: string) {
  return matchesChartSearch(query, [
    patient.name,
    patient.phone,
    patientCodeFor(patient),
    typeof patient.age === "number" && patient.flags ? patientClassCodeFor(patient as Patient) : null,
    patient.email,
    patientGenderLabel(patient.gender, "vi"),
    patientGenderLabel(patient.gender, "en"),
    patientLeadSourceLabel(patient.leadSource, "vi"),
    patientLeadSourceLabel(patient.leadSource, "en"),
    patient.visitReason,
    patient.nationalId,
    patient.address,
    patient.city,
    patient.guardianName,
    patient.consent,
    ...(patient.flags ?? []),
  ]);
}

function normalizeCodeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
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

const serviceProgressOptions = [
  "Planned (0%)",
  "In progress",
  "Step 1 (20%)",
  "Step 2 (40%)",
  "Step 3 (55%)",
  "Step 4 (70%)",
  "Completed (100%)",
  "Cancelled",
];

function serviceProgressIsCancelled(progress: string) {
  return progress === "Cancelled";
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

function serviceProgressLabelFromPercent(
  percent: number,
  status?: string,
  steps: ServiceStepSummary[] = [],
) {
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
  const matchingStep = steps.find(
    (step) => Math.round(step.defaultProgress ?? -1) === roundedPercent,
  );

  if (matchingStep) {
    return `${matchingStep.sequence}. ${matchingStep.name} (${roundedPercent}%)`;
  }

  const knownStepLabels: Record<number, string> = {
    20: "Step 1 (20%)",
    40: "Step 2 (40%)",
    55: "Step 3 (55%)",
    70: "Step 4 (70%)",
  };

  return knownStepLabels[roundedPercent] ?? `Step (${roundedPercent}%)`;
}

function serviceProgressPercentOptions(
  currentPercent: number,
  steps: ServiceStepSummary[] = [],
) {
  const stepPercents = steps
    .map((step) => step.defaultProgress)
    .filter((percent): percent is number => Number.isFinite(percent ?? NaN));

  return Array.from(
    new Set([
      0,
      ...(stepPercents.length > 0 ? stepPercents : [10, 20, 40, 55, 70]),
      100,
      Math.round(currentPercent),
    ]),
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
  steps: ServiceStepSummary[];
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
  progressSteps?: ServiceStepSummary[];
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

type JourneyTreatmentDraft = {
  goal: string;
  plan: string;
};

type JourneyTreatmentDraftStore = Record<string, JourneyTreatmentDraft>;

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

function isStoredJourneyServiceRow(value: unknown): value is JourneyServiceRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const service = value as Partial<JourneyServiceRow>;

  return (
    typeof service.id === "string" &&
    typeof service.patientId === "string" &&
    (service.serviceCode === undefined || typeof service.serviceCode === "string") &&
    (service.catalogItemId === undefined ||
      typeof service.catalogItemId === "string") &&
    (service.catalogCode === undefined || typeof service.catalogCode === "string") &&
    (service.createdAt === undefined || typeof service.createdAt === "number") &&
    (service.createdBy === undefined || typeof service.createdBy === "string") &&
    (service.createdById === undefined || typeof service.createdById === "string") &&
    (service.compensationRuleId === undefined ||
      service.compensationRuleId === null ||
      typeof service.compensationRuleId === "string") &&
    (service.compensationRuleName === undefined ||
      service.compensationRuleName === null ||
      typeof service.compensationRuleName === "string") &&
    typeof service.object === "string" &&
    typeof service.diagnosis === "string" &&
    typeof service.serviceName === "string" &&
    typeof service.progress === "string" &&
    typeof service.listPrice === "number" &&
    typeof service.discount === "number" &&
    typeof service.finalPrice === "number" &&
    (service.invoiceCreatedAt === undefined ||
      typeof service.invoiceCreatedAt === "number") &&
    (service.invoiceId === undefined || typeof service.invoiceId === "string") &&
    (service.invoiceIds === undefined ||
      (Array.isArray(service.invoiceIds) &&
        service.invoiceIds.every((invoiceId) => typeof invoiceId === "string"))) &&
    (service.patientRequestedInvoice === undefined ||
      typeof service.patientRequestedInvoice === "boolean") &&
    service.source === "odontogram"
  );
}

function isStoredTreatmentDraftStore(value: unknown): value is JourneyTreatmentDraftStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (draft) =>
      Boolean(draft) &&
      typeof draft === "object" &&
      typeof (draft as Partial<JourneyTreatmentDraft>).goal === "string" &&
      typeof (draft as Partial<JourneyTreatmentDraft>).plan === "string",
  );
}

type JourneyComment = {
  id: string;
  patientId: string;
  author: string;
  body: string;
  createdAt: number;
  attachments?: JourneyTimelineAttachment[];
  imageName?: string;
  imageUrl?: string;
};

type JourneyTimelineAttachment = {
  id: string;
  url: string;
  name: string | null;
  mimeType: string | null;
  fileKind?: string | null;
  previewUrl?: string | null;
  sizeBytes?: number | null;
  thumbnailUrl?: string | null;
};

type JourneyTimelineEvent = {
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

const journeyTimelineFilters = [
  "All",
  "Session",
  "Clinical",
  "Treatment",
  "Billing",
  "Files",
] as const;

type JourneyTimelineFilter = (typeof journeyTimelineFilters)[number];

const journeyText = {
  vi: {
    actions: {
      admin: "Hành chính",
      intake: "Khám",
      plan: "Mục tiêu & kế hoạch",
      services: "Dịch vụ",
      toothPlanning: "Lập kế hoạch răng",
    },
    admin: {
      address: "Địa chỉ",
      age: "Tuổi",
      consent: "Đồng ý",
      debt: "Công nợ",
      dobAge: "Ngày sinh / tuổi",
      extendedInfo: "Thông tin mở rộng",
      guardian: "Người giám hộ",
      nationalId: "CMND/CCCD",
      noEmail: "Chưa có email",
      noClinic: "Chưa có phòng khám",
      notApplicable: "Không áp dụng",
      patientRecord: "Hồ sơ bệnh nhân",
      patientCode: "Mã bệnh nhân",
      sessions: "Buổi hẹn",
      title: "Thông tin hành chính",
      unknown: "Chưa rõ",
      unsignedDate: "chưa ghi nhận ngày ký",
    },
    chart: {
      eyebrow: "Bệnh án",
      noPatient: "Không có bệnh nhân trong phạm vi phòng khám hiện tại",
      searchPlaceholder:
        "Tìm bệnh nhân, điện thoại, lý do khám, kế hoạch, dịch vụ, timeline",
      searchSummary:
        "",
      sectionNavAria: "Mục bệnh án",
      clearSearch: "Xóa tìm kiếm",
      selectPatient: "Chọn bệnh nhân",
      emptyTitle: "Bệnh án trung tâm",
      title: "Bệnh án trung tâm: 1 bệnh nhân, 1 timeline",
    },
    clinical: {
      action: "Khám",
      assessment: "Khám lâm sàng",
      assessmentPlaceholder:
        "Mô mềm, nha chu, khớp cắn, vùng đau, phim X-quang...",
      bloodPressure: "Huyết áp",
      heartRate: "Mạch",
      history: "Bệnh sử",
      historyAllergy: "Tiền sử, dị ứng, thuốc đang dùng",
      historyAllergyPlaceholder:
        "Bệnh nền, dị ứng, thuốc chống đông, đang mang thai...",
      historyPlaceholder:
        "Diễn tiến triệu chứng, bệnh đã điều trị, tái phát, thời điểm khởi phát...",
      initialPlan: "Kế hoạch/ghi chú ban đầu",
      initialPlanPlaceholder:
        "Chỉ định chụp phim, tư vấn dịch vụ, hẹn session tiếp theo...",
      reason: "Lý do đến khám",
      reasonPlaceholder:
        "Đau, ê buốt, chảy máu nướu, kiểm tra định kỳ...",
      save: "Lưu thông tin khám",
      temperature: "Nhiệt độ",
      title: "Thông tin khám",
      soapNote: "Ghi chú SOAP",
    },
    empty: {
      noMatchingEvents: "Không có sự kiện phù hợp với bộ lọc hoặc tìm kiếm",
      noMatchingPlans: "Không có kế hoạch khớp tìm kiếm",
      noMatchingServices: "Không có dịch vụ khớp tìm kiếm",
      noPlans: "Chưa có kế hoạch điều trị",
      noServices: "Chưa có dịch vụ điều trị",
    },
    nav: {
      admin: "Hành chính",
      exam: "Khám",
      odontogram: "Odontogram",
      plan: "Kế hoạch",
      services: "Dịch vụ",
      timeline: "Timeline",
    },
    odontogram: {
      addService: "Thêm dịch vụ",
      diagnosis: "Chẩn đoán",
      diagnosisDefault: "",
      missingDiagnosis: "Chưa nhập chẩn đoán",
      emptySelection: "Chưa chọn răng hoặc đối tượng điều trị",
      serviceLibrary: "Dịch vụ từ thư viện",
      selectService: "Chọn dịch vụ",
      targetAria: "Chọn đối tượng điều trị",
      targetPrompt: "Chọn răng, nhóm răng hoặc toàn hàm",
      title: "Odontogram",
    },
    plan: {
      goalField: "Mục tiêu điều trị",
      goalPlaceholder:
        "Ví dụ: phục hồi chức năng ăn nhai, cải thiện thẩm mỹ, kiểm soát đau...",
      firstPhase: "Giai đoạn đầu",
      patientDue: "Bệnh nhân trả",
      planField: "Kế hoạch điều trị",
      planPlaceholder:
        "Ví dụ: chụp phim, nhổ răng còn lại, lấy dấu, thử khung, giao hàm...",
      procedures: "Thủ thuật",
      title: "Mục tiêu và kế hoạch điều trị",
      totalAmount: "Tổng tiền",
      titleField: "Tên kế hoạch",
      create: "Tạo kế hoạch",
    },
    services: {
      actions: "Thao tác",
      collected: "Đã thu",
      assistantPrimary: "Phụ tá 1",
      assistantSecondary: "Phụ tá 2",
      clinicalSupport: "Hỗ trợ chuyên môn",
      createdBy: "Tạo bởi",
      diagnosis: "Chẩn đoán",
      delete: "Xóa dịch vụ",
      deleteConfirm:
        "Xóa dịch vụ này? Chỉ dùng khi nhập nhầm và chưa phát sinh điều trị/thanh toán.",
      deleteLocked:
        "Không thể xóa vì dịch vụ đã có tiến độ, hóa đơn hoặc thu tiền.",
      discount: "Giảm giá",
      finalPrice: "Giá cuối",
      invoice: "Hóa đơn",
      invoiceRequested: "Chờ xuất hóa đơn",
      issueInvoice: "Xuất hóa đơn",
      noInvoice: "Chưa có",
      listPrice: "Giá niêm yết",
      object: "Đối tượng",
      performedBy: "Người thực hiện",
      progress: "Tiến độ",
      recordProgress: "Ghi nhận tiến độ",
      receiptAmount: "Số tiền thu",
      receiptMethod: "Hình thức thu",
      recordReceipt: "Ghi nhận thu",
      remaining: "Còn lại",
      serviceCode: "Mã dịch vụ",
      serviceName: "Tên dịch vụ",
      title: "Dịch vụ điều trị",
    },
    timeline: {
      attachment: "Ảnh đính kèm",
      comment: "Comment nội bộ",
      commentPlaceholder: "Ví dụ: bệnh nhân về nhà không đau",
      closeImage: "Đóng ảnh",
      fileAlt: "Ảnh timeline",
      imageDetailPrefix: "Ảnh",
      internalComment: "Comment nội bộ",
      openImage: "Mở ảnh",
      postComment: "Thêm comment",
      prescription: "Đơn thuốc",
      receipt: "Phiếu thu",
      patientFile: "Tài liệu bệnh nhân",
      patientFilePlaceholder: "Ví dụ: phim X-quang trước điều trị",
      fileCategory: "Loại tài liệu",
      fileMimeType: "MIME type",
      fileNotes: "Ghi chú tài liệu",
      fileUpload: "Tải file lên",
      fileUrl: "URL",
      retentionUntil: "Lưu đến ngày",
      saveGovernance: "Lưu kiểm soát",
      scanStatus: "Trạng thái quét",
      openFile: "Mở file",
      saveFile: "Lưu tài liệu",
      patientForm: "Biểu mẫu",
      title: "Timeline bệnh án",
    },
  },
  en: {
    actions: {
      admin: "Admin",
      intake: "Intake",
      plan: "Goals & plan",
      services: "Services",
      toothPlanning: "Tooth planning",
    },
    admin: {
      address: "Address",
      age: "Age",
      consent: "Consent",
      debt: "Balance due",
      dobAge: "Date of birth / age",
      extendedInfo: "Extended information",
      guardian: "Guardian",
      nationalId: "National ID",
      noEmail: "No email",
      noClinic: "No clinic",
      notApplicable: "Not applicable",
      patientRecord: "Patient record",
      patientCode: "Patient code",
      sessions: "Sessions",
      title: "Administrative Information",
      unknown: "Unknown",
      unsignedDate: "no signing date recorded",
    },
    chart: {
      eyebrow: "Patient chart",
      noPatient: "No patients are available in the current clinic scope",
      searchPlaceholder:
        "Search patient, phone, visit reason, plan, service, timeline",
      searchSummary:
        "Search by patient, phone, visit reason, plan, service, or timeline",
      sectionNavAria: "Chart sections",
      clearSearch: "Clear search",
      selectPatient: "Select patient",
      emptyTitle: "Central chart",
      title: "Central chart: 1 patient, 1 timeline",
    },
    clinical: {
      action: "Intake",
      assessment: "Clinical exam",
      assessmentPlaceholder:
        "Soft tissue, perio, occlusion, pain area, X-ray findings...",
      bloodPressure: "Blood pressure",
      heartRate: "Pulse",
      history: "Illness history",
      historyAllergy: "Medical history, allergies, current medications",
      historyAllergyPlaceholder:
        "Medical conditions, allergies, anticoagulants, pregnancy...",
      historyPlaceholder:
        "Symptom course, previous treatment, recurrence, onset time...",
      initialPlan: "Initial plan / note",
      initialPlanPlaceholder:
        "Imaging order, service consultation, next session...",
      reason: "Visit reason",
      reasonPlaceholder:
        "Pain, sensitivity, bleeding gums, routine checkup...",
      save: "Save exam information",
      temperature: "Temperature",
      title: "Exam Information",
      soapNote: "SOAP note",
    },
    empty: {
      noMatchingEvents: "No events match the filter or search",
      noMatchingPlans: "No treatment plans match the search",
      noMatchingServices: "No services match the search",
      noPlans: "No treatment plans yet",
      noServices: "No treatment services yet",
    },
    nav: {
      admin: "Admin",
      exam: "Exam",
      odontogram: "Odontogram",
      plan: "Plan",
      services: "Services",
      timeline: "Timeline",
    },
    odontogram: {
      addService: "Add service",
      diagnosis: "Diagnosis",
      diagnosisDefault: "",
      missingDiagnosis: "No diagnosis entered",
      emptySelection: "No teeth or treatment target selected",
      serviceLibrary: "Service library",
      selectService: "Select service",
      targetAria: "Select treatment target",
      targetPrompt: "Select teeth, tooth group, or arch",
      title: "Odontogram",
    },
    plan: {
      goalField: "Treatment Goal",
      goalPlaceholder:
        "Example: restore chewing function, improve esthetics, control pain...",
      firstPhase: "First phase",
      patientDue: "Patient due",
      planField: "Treatment Plan",
      planPlaceholder:
        "Example: imaging, extract remaining teeth, impression, framework try-in, delivery...",
      procedures: "Procedures",
      title: "Treatment Goals and Plan",
      totalAmount: "Total amount",
      titleField: "Plan title",
      create: "Create plan",
    },
    services: {
      actions: "Actions",
      collected: "Collected",
      assistantPrimary: "Assistant 1",
      assistantSecondary: "Assistant 2",
      clinicalSupport: "Clinical support",
      createdBy: "Created by",
      diagnosis: "Diagnosis",
      delete: "Delete service",
      deleteConfirm:
        "Delete this service? Use only when it was added by mistake and has no treatment or payment history.",
      deleteLocked:
        "Cannot delete because this service already has progress, invoice, or payment activity.",
      discount: "Discount",
      finalPrice: "Final price",
      invoice: "Invoice",
      invoiceRequested: "Invoice requested",
      issueInvoice: "Issue invoice",
      noInvoice: "None",
      listPrice: "List price",
      object: "Target",
      performedBy: "Operator",
      progress: "Progress",
      recordProgress: "Record progress",
      receiptAmount: "Receipt amount",
      receiptMethod: "Receipt method",
      recordReceipt: "Record receipt",
      remaining: "Remaining",
      serviceCode: "Service code",
      serviceName: "Service name",
      title: "Treatment Services",
    },
    timeline: {
      attachment: "Attachment",
      comment: "Internal comment",
      commentPlaceholder: "Example: patient had no pain after going home",
      closeImage: "Close image",
      fileAlt: "Timeline image",
      imageDetailPrefix: "Image",
      internalComment: "Internal comment",
      openImage: "Open image",
      postComment: "Add comment",
      prescription: "Prescription",
      receipt: "Receipt",
      patientFile: "Patient file",
      patientFilePlaceholder: "Example: pre-op radiograph",
      fileCategory: "Category",
      fileMimeType: "MIME type",
      fileNotes: "File notes",
      fileUpload: "Upload file",
      fileUrl: "URL",
      retentionUntil: "Retain until",
      saveGovernance: "Save controls",
      scanStatus: "Scan status",
      openFile: "Open file",
      saveFile: "Save file",
      patientForm: "Patient form",
      title: "Chart Timeline",
    },
  },
} as const;

const billingText = {
  vi: {
    alert:
      "",
    allocateCredit: "Phân bổ tiền dư",
    allocationAmount: "Số tiền phân bổ",
    amountDue: "Còn phải thu",
    amountPaid: "Đã thu",
    amountTotal: "Tổng tiền",
    advancedTools: "Công cụ quản trị billing",
    allocatedTotal: "Đã phân bổ",
    balance: "Còn lại",
    cancel: "Hủy",
    clearSearch: "Xóa tìm kiếm",
    collected: "Đã thu",
    collectionAmount: "Số tiền thu",
    collectionMethod: "Hình thức",
    collectionTitle: "Thu tiền theo dịch vụ điều trị",
    complete: "Đã thu đủ",
    createInvoice: "Tạo hóa đơn",
    creditBalance: "Thu trước/chưa phân bổ",
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
    plannedDeposits: "Dịch vụ Planned đã cọc",
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
    statementCredit: "Có",
    statementDebit: "Nợ",
    subtitle:
      "Thanh to?n",
    title: "Thanh toán, phiếu thu, hóa đơn",
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
    balance: "Balance",
    cancel: "Void",
    clearSearch: "Clear search",
    collected: "Collected",
    collectionAmount: "Collection amount",
    collectionMethod: "Method",
    collectionTitle: "Treatment service collections",
    complete: "Fully collected",
    createInvoice: "Create invoice",
    creditBalance: "Advance/unapplied",
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
    statementCredit: "Credit",
    statementDebit: "Debit",
    subtitle:
      "Billing",
    title: "Billing, receipts, invoices",
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

function splitClinicalObjective(objective: string | null | undefined) {
  const fields = {
    objective: "",
    medicalHistory: "",
    temperature: "",
    bloodPressure: "",
    heartRate: "",
  };
  let remaining = objective?.trim() ?? "";

  const historyMatch = remaining.match(
    /(?:^|\n\n)Bệnh sử:\s*([\s\S]*?)(?=\n\nSinh hiệu:|$)/,
  );

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

export function PatientJourneyPanel({
  actorName,
  billingWorkspace,
  clinicalWorkspace,
  crmWorkspace,
  formsWorkspace,
  journeyRecordsWorkspace,
  patientFilesWorkspace,
  patientWorkspace,
  pharmacyWorkspace,
  scheduleWorkspace,
  servicesWorkspace,
  settingsWorkspace,
  session,
  treatmentWorkspace,
  chartSearch,
  journeyReceipts,
  onUpdateJourneyInvoiceAmount,
  onVoidJourneyInvoiceIfUnpaid,
  selectedPatientId,
  visibleAppointments,
  visibleClinics,
  visibleInvoices,
  visiblePatients,
  visiblePlans,
}: {
  actorName: string;
  billingWorkspace?: BillingWorkspace | null;
  clinicalWorkspace?: ClinicalWorkspaceData | null;
  crmWorkspace?: CrmWorkspace | null;
  formsWorkspace?: FormsWorkspace | null;
  journeyRecordsWorkspace?: JourneyRecordsWorkspace | null;
  patientFilesWorkspace?: PatientFilesWorkspace | null;
  patientWorkspace?: PatientWorkspace | null;
  pharmacyWorkspace?: PharmacyWorkspace | null;
  scheduleWorkspace?: ScheduleWorkspace | null;
  servicesWorkspace?: ServicesWorkspace | null;
  settingsWorkspace?: SettingsWorkspace | null;
  session: AppSession;
  treatmentWorkspace?: TreatmentWorkspace | null;
  chartSearch: string;
  journeyReceipts: JourneyReceipt[];
  onUpdateJourneyInvoiceAmount: (invoiceId: string, amount: number) => void;
  onVoidJourneyInvoiceIfUnpaid: (invoiceId: string) => void;
  selectedPatientId: string;
  visibleAppointments: Appointment[];
  visibleClinics: Clinic[];
  visibleInvoices: Invoice[];
  visiblePatients: Patient[];
  visiblePlans: TreatmentPlan[];
}) {
  const { language } = useAppLanguage();
  const jt = journeyText[language];
  const searchParams = useSearchParams();
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const selectedPatient =
    visiblePatients.find((patient) => patient.id === selectedPatientId) ?? null;
  const visiblePatientsById = useMemo(
    () => new Map(visiblePatients.map((patient) => [patient.id, patient])),
    [visiblePatients],
  );
  const selectedPatientKey = selectedPatient?.id ?? "";
  const chartSearchQuery = normalizeSearchText(chartSearch.trim());
  const serviceOptions = useMemo<JourneyServiceCatalogOption[]>(() => {
    const databaseServices =
      servicesWorkspace?.services
        .filter((service) => service.status === "ACTIVE")
        .map((service) => ({
          id: service.id,
          code: service.code,
          category: service.categoryCode,
          name: service.name,
          nameEn: service.nameEn ?? service.name,
          price: service.defaultPrice,
          compensationRuleId: service.defaultCompensationRuleId,
          compensationRuleName: service.defaultCompensationRuleName,
        })) ?? [];

    if (servicesWorkspace?.source === "database") {
      return databaseServices;
    }

    return serviceLibrary.map((service) => ({
      ...service,
      compensationRuleId: null,
      compensationRuleName: null,
    }));
  }, [servicesWorkspace?.services, servicesWorkspace?.source]);
  const patientSearchMatches = visiblePatients.filter((patient) =>
    matchesChartSearch(chartSearchQuery, [
      patient.name,
      patient.phone,
      patientCodeFor(patient),
      patientClassCodeFor(patient),
      patient.email,
      patient.nationalId,
      patient.address,
      patient.city,
      patient.guardianName,
      patient.consent,
      ...patient.flags,
    ]),
  );
  const [selectedTeeth, setSelectedTeeth] = useState<string[]>([]);
  const [odontogramDiagnosis, setOdontogramDiagnosis] = useState<string>(
    jt.odontogram.diagnosisDefault,
  );
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [plannedServices, setPlannedServices] = useState<JourneyServiceRow[]>([]);
  const [treatmentDrafts, setTreatmentDrafts] = useState<JourneyTreatmentDraftStore>(
    {},
  );
  const [timelineComments, setTimelineComments] = useState<JourneyComment[]>([]);
  const [timelineFilter, setTimelineFilter] = useState<JourneyTimelineFilter>("All");
  const [selectedTimelineEventId, setSelectedTimelineEventId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentAttachments, setCommentAttachments] = useState<JourneyTimelineAttachment[]>([]);
  const [commentImage, setCommentImage] = useState<{
    name: string;
    url: string;
  } | null>(null);
  const [openTimelineImage, setOpenTimelineImage] = useState<{
    alt: string;
    src: string;
  } | null>(null);
  const [pendingProgressUpdate, setPendingProgressUpdate] =
    useState<PendingProgressUpdate | null>(null);
  const [journeyCreditAllocations, setJourneyCreditAllocations] = useState<
    JourneyCreditAllocation[]
  >([]);
  const journeyDatabaseOnly = [
    patientWorkspace?.source,
    clinicalWorkspace?.source,
    treatmentWorkspace?.source,
    scheduleWorkspace?.source,
    billingWorkspace?.source,
    servicesWorkspace?.source,
    pharmacyWorkspace?.source,
    formsWorkspace?.source,
    patientFilesWorkspace?.source,
    journeyRecordsWorkspace?.source,
    crmWorkspace?.source,
  ].includes("database");
  useEffect(() => {
    setSelectedTimelineEventId("");
    setPendingProgressUpdate(null);
  }, [chartSearch, selectedPatientId]);
  useEffect(() => {
    if (selectedServiceId && !serviceOptions.some((service) => service.id === selectedServiceId)) {
      setSelectedServiceId("");
    }
  }, [selectedServiceId, serviceOptions]);
  useEffect(() => {
    setOdontogramDiagnosis((current) =>
      current === journeyText.vi.odontogram.diagnosisDefault ||
      current === journeyText.en.odontogram.diagnosisDefault
        ? jt.odontogram.diagnosisDefault
        : current,
    );
  }, [language, jt.odontogram.diagnosisDefault]);
  const selectedNotes =
    clinicalWorkspace?.notes.filter((note) => note.patientId === selectedPatientKey) ??
    [];
  const selectedPlans = visiblePlans.filter(
    (plan) =>
      plan.patientId === selectedPatientKey ||
      (selectedPatient && plan.patient === selectedPatient.name),
  );
  const selectedInvoices = visibleInvoices.filter(
    (invoice) =>
      invoice.patientId === selectedPatientKey ||
      (selectedPatient && invoice.patient === selectedPatient.name),
  );
  const selectedBillingReceipts =
    billingWorkspace?.receipts.filter(
      (receipt) => receipt.patientId === selectedPatientKey,
    ) ?? [];
  const selectedPrescriptions =
    pharmacyWorkspace?.prescriptions.filter(
      (prescription) => prescription.patientId === selectedPatientKey,
    ) ?? [];
  const selectedPatientForms =
    formsWorkspace?.patientForms.filter((form) => form.patientId === selectedPatientKey) ??
    [];
  const selectedPatientFiles =
    patientFilesWorkspace?.files.filter((file) => file.patientId === selectedPatientKey) ??
    [];
  const selectedJourneyState =
    journeyRecordsWorkspace?.states.find((state) => state.patientId === selectedPatientKey) ??
    null;
  const selectedOdontogram =
    journeyRecordsWorkspace?.odontograms.find(
      (odontogram) => odontogram.patientId === selectedPatientKey,
    ) ?? null;
  const selectedJourneyComments =
    journeyRecordsWorkspace?.comments.filter(
      (comment) => comment.patientId === selectedPatientKey,
    ) ?? [];
  useEffect(() => {
    setSelectedTeeth(selectedJourneyState?.odontogramTeeth ?? []);
  }, [selectedJourneyState?.id, selectedPatientKey]);
  const selectedCrmActivities =
    crmWorkspace?.activities.filter((activity) => activity.patientId === selectedPatientKey) ??
    [];
  const selectedAppointments = visibleAppointments.filter(
    (appointment) =>
      appointment.patientId === selectedPatientKey ||
      (selectedPatient && appointment.patient === selectedPatient.name),
  );
  const selectedTreatmentDraft = treatmentDrafts[selectedPatientKey] ?? {
    goal: "",
    plan: "",
  };
  const selectedTreatmentGoal =
    selectedJourneyState?.treatmentGoal ?? selectedTreatmentDraft.goal;
  const selectedTreatmentPlanText =
    selectedJourneyState?.treatmentPlan ?? selectedTreatmentDraft.plan;
  const updateTreatmentDraft = (
    field: keyof JourneyTreatmentDraft,
    value: string,
  ) => {
    if (!selectedPatientKey) {
      return;
    }

    setTreatmentDrafts((current) => ({
      ...current,
      [selectedPatientKey]: {
        goal: current[selectedPatientKey]?.goal ?? "",
        plan: current[selectedPatientKey]?.plan ?? "",
        [field]: value,
      },
    }));
  };
  const latestNote = selectedNotes[0];
  const latestExamFields = splitClinicalObjective(latestNote?.objective);
  const clinicName =
    visibleClinics.find((clinic) => clinic.id === selectedPatient?.clinicId)?.name ??
    selectedPatient?.city ??
    jt.admin.noClinic;
  const source = journeyDatabaseOnly ? "database" : "demo";
  const messages = Array.from(
    new Set(
      [
        patientWorkspace?.message,
        clinicalWorkspace?.message,
        treatmentWorkspace?.message,
        scheduleWorkspace?.message,
        billingWorkspace?.message,
        servicesWorkspace?.message,
        pharmacyWorkspace?.message,
        formsWorkspace?.message,
        patientFilesWorkspace?.message,
        journeyRecordsWorkspace?.message,
        crmWorkspace?.message,
      ].filter(Boolean) as string[],
    ),
  );
  const clinicalReady = Boolean(clinicalWorkspace?.canMutate && selectedPatient);
  const journeyRecordsReady = Boolean(journeyRecordsWorkspace?.canMutate && selectedPatient);
  const odontogramReady = Boolean(
    journeyRecordsWorkspace?.source === "database" &&
      selectedPatient &&
      hasAnyRole(session, [
        "OWNER",
        "AREA_MANAGER",
        "CLINIC_MANAGER",
        "DENTIST",
        "HYGIENIST",
      ]),
  );
  const journeyServiceDatabaseReady =
    servicesWorkspace?.source === "database" && serviceOptions.length > 0;
  const canDeleteTreatmentServices = hasAnyRole(session, ["OWNER"]);
  const selectedLibraryService =
    serviceOptions.find((service) => service.id === selectedServiceId) ?? null;
  const progressParticipants =
    settingsWorkspace?.staff.filter((member) => member.active) ?? [];
  const selectedToothTargets = selectedTeeth.filter(isToothTarget);
  const selectedArchTargets = selectedTeeth.filter(isArchTarget);
  const selectedServiceTargets = serviceTargetsFromSelection(selectedTeeth, language);
  const updateSelectedToothTargets = (teeth: string[]) => {
    setSelectedTeeth((current) => [...current.filter(isArchTarget), ...teeth]);
  };
  const toggleArchTarget = (targetId: string) => {
    setSelectedTeeth((current) => {
      const toothTargets = current.filter(isToothTarget);
      const currentArchTargets = current.filter(isArchTarget);
      const alreadySelected = currentArchTargets.includes(targetId);

      if (alreadySelected) {
        return [
          ...toothTargets,
          ...currentArchTargets.filter((target) => target !== targetId),
        ];
      }

      if (targetId === "TOOTH_GROUP") {
        return [...toothTargets, targetId];
      }

      if (targetId === "ARCH_BOTH") {
        return [...toothTargets, targetId];
      }

      return [
        ...toothTargets,
        ...currentArchTargets.filter(
          (target) => target !== "ARCH_BOTH" && target !== "TOOTH_GROUP",
        ),
        targetId,
      ];
    });
  };
  const addServicesFromOdontogram = () => {
    if (!selectedPatient || !selectedLibraryService || selectedServiceTargets.length === 0) {
      return;
    }

    const createdAt = Date.now();
    const diagnosis = odontogramDiagnosis.trim() || jt.odontogram.missingDiagnosis;

    setPlannedServices((current) => {
      const firstSequence = nextServiceSequence(
        current,
        selectedPatient.id,
        selectedLibraryService.code,
      );

      return [
        ...current,
        ...selectedServiceTargets.map((target, index) => ({
          id: `${selectedPatient.id}-${selectedLibraryService.id}-${target}-${createdAt}-${index}`,
          patientId: selectedPatient.id,
          catalogItemId: selectedLibraryService.id,
          serviceCode: createServiceInstanceCode(
            selectedPatient,
            selectedLibraryService.code,
            firstSequence + index,
          ),
          catalogCode: selectedLibraryService.code,
          createdAt,
          createdBy: actorName,
          createdById: "",
          compensationRuleId: selectedLibraryService.compensationRuleId ?? null,
          compensationRuleName: selectedLibraryService.compensationRuleName ?? null,
          object: target,
          diagnosis,
          serviceName: serviceCatalogOptionName(selectedLibraryService, language),
          progress: serviceProgressOptions[0],
          listPrice: selectedLibraryService.price,
          discount: 0,
          finalPrice: selectedLibraryService.price,
          patientRequestedInvoice: false,
          source: "odontogram" as const,
        })),
      ];
    });
    setSelectedTeeth([]);
  };
  const selectedReceipts = journeyReceipts.filter(
    (receipt) => receipt.patientId === selectedPatientKey,
  );
  const selectedCreditAllocations = journeyCreditAllocations.filter(
    (allocation) => allocation.patientId === selectedPatientKey,
  );
  const databaseServiceBillingById = useMemo(
    () =>
      new Map(
        (servicesWorkspace?.treatmentServices ?? []).map((service) => [
          service.id,
          {
            collectedAmount: service.collectedAmount,
            creditAllocatedAmount: service.creditAllocatedAmount,
          },
        ]),
      ),
    [servicesWorkspace?.treatmentServices],
  );
  const serviceCollectedAmount = (serviceId: string) =>
    databaseServiceBillingById.get(serviceId)?.collectedAmount ??
    selectedReceipts
      .filter((receipt) => receipt.serviceId === serviceId)
      .reduce((total, receipt) => total + receipt.amount, 0);
  const serviceCreditAllocationAmount = (serviceId: string) =>
    databaseServiceBillingById.get(serviceId)?.creditAllocatedAmount ??
    selectedCreditAllocations
      .filter((allocation) => allocation.toServiceId === serviceId)
      .reduce((total, allocation) => total + allocation.amount, 0);
  const serviceAppliedAmount = (serviceId: string) =>
    calculateServiceAppliedAmount(
      serviceCollectedAmount(serviceId),
      serviceCreditAllocationAmount(serviceId),
    );
  const updateServiceProgress = (serviceId: string, progress: string) => {
    const currentService = plannedServices.find((service) => service.id === serviceId);

    setPlannedServices((current) =>
      current.map((service) =>
        service.id === serviceId
          ? {
              ...service,
              progress,
            }
          : service,
      ),
    );

    if (serviceProgressIsCancelled(progress) && currentService?.invoiceId) {
      onVoidJourneyInvoiceIfUnpaid(currentService.invoiceId);
    }
  };
  const updateServiceDiscount = (serviceId: string, value: string) => {
    const discount = Math.max(Number(value) || 0, 0);

    setPlannedServices((current) =>
      current.map((service) =>
        service.id === serviceId
          ? {
              ...service,
              discount,
              finalPrice: Math.max(service.listPrice - discount, 0),
            }
          : service,
      ),
    );
  };
  const removeDraftTreatmentService = (serviceId: string) => {
    setPlannedServices((current) =>
      current.filter((service) => service.id !== serviceId),
    );
  };
  const submitServiceDiscountOnBlur = (
    event: FocusEvent<HTMLFormElement>,
    currentDiscount: number,
  ) => {
    const form = event.currentTarget;
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && form.contains(nextTarget)) {
      return;
    }

    const formData = new FormData(form);
    const rawDiscount = String(formData.get("discount") ?? "");
    const nextDiscount = rawDiscount.trim() ? Number(rawDiscount) : 0;

    if (!Number.isFinite(nextDiscount) || nextDiscount === currentDiscount) {
      return;
    }

    window.setTimeout(() => {
      if (form.isConnected) {
        form.requestSubmit();
      }
    }, 0);
  };
  const addTimelineComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPatient || (!commentBody.trim() && commentAttachments.length === 0)) {
      return;
    }

    setTimelineComments((current) => [
      ...current,
      {
        id: `comment-${Date.now()}`,
        patientId: selectedPatient.id,
        author: actorName,
        body:
          commentBody.trim() ||
          commentAttachments.map((attachment) => attachment.name).filter(Boolean).join(", ") ||
          "File đính kèm",
        createdAt: Date.now(),
        attachments: commentAttachments,
        imageName: commentAttachments.find((attachment) =>
          attachment.mimeType?.startsWith("image/"),
        )?.name ?? commentImage?.name,
        imageUrl: commentAttachments.find((attachment) =>
          attachment.mimeType?.startsWith("image/"),
        )?.url ?? commentImage?.url,
      },
    ]);
    setCommentBody("");
    setCommentImage(null);
    setCommentAttachments([]);
  };
  const totalDue = selectedInvoices.reduce(
    (total, invoice) =>
      isCollectableInvoice(invoice) ? total + invoiceBalance(invoice) : total,
    0,
  );
  const persistedTreatmentServices: JourneyServiceRow[] = selectedPlans.flatMap((plan) =>
    plan.tasks.map((task, index, tasks) => {
      const listPrice = Math.round(plan.patientShare / Math.max(tasks.length, 1));

      return {
        id: `${plan.id}-${task}-${index}`,
        patientId: selectedPatientKey,
        serviceCode: createServiceInstanceCode(
          selectedPatient,
          "KHT",
          index + 1,
        ),
        catalogCode: "KHT",
        createdAt: plan.createdAt ? Date.parse(plan.createdAt) || undefined : undefined,
        object: plan.phase,
        diagnosis: plan.title,
        serviceName: task,
        progress: plan.status,
        listPrice,
        discount: 0,
        finalPrice: listPrice,
        source: "plan" as const,
      };
    }),
  );
  const databaseTreatmentServices: JourneyServiceRow[] =
    servicesWorkspace?.treatmentServices
      .filter((service) => service.patientId === selectedPatientKey)
      .map((service) => ({
        id: service.id,
        patientId: service.patientId,
        catalogItemId: service.serviceCatalogItemId ?? undefined,
        serviceCode: service.serviceCode,
        catalogCode: service.catalogCode,
        createdAt: Date.parse(service.createdAt) || undefined,
        createdBy: service.createdByName,
        createdById: service.createdById,
        compensationRuleId: service.compensationRuleId,
        compensationRuleName: service.compensationRuleName,
        object: service.teeth.join(", ") || service.targetSummary || "",
        diagnosis: service.targetSummary ?? "",
        serviceName: service.serviceName,
        progress: serviceProgressLabelFromPercent(
          service.currentProgressPercent,
          service.status,
          service.steps,
        ),
        listPrice: service.listPrice,
        discount: Math.max(service.listPrice - service.finalPrice, 0),
        finalPrice: service.finalPrice,
        collectedAmount: service.collectedAmount,
        creditAllocatedAmount: service.creditAllocatedAmount,
        invoicedAmount: service.invoicedAmount,
        invoiceNos: service.invoiceNos,
        progressEvents: service.progressEvents,
        progressSteps: service.steps,
        source: "database" as const,
      })) ?? [];
  const treatmentServices = [
    ...databaseTreatmentServices,
    ...(journeyDatabaseOnly
      ? []
      : plannedServices.filter((service) => service.patientId === selectedPatientKey)),
    ...persistedTreatmentServices,
  ];
  const filteredSelectedPlans = selectedPlans.filter((plan) =>
    matchesChartSearch(chartSearchQuery, [
      plan.title,
      plan.phase,
      plan.status,
      plan.estimatedCost,
      plan.patientShare,
      ...plan.tasks,
    ]),
  );
  const hasTreatmentDraft = Boolean(
    selectedTreatmentGoal.trim() || selectedTreatmentPlanText.trim(),
  );
  const treatmentDraftMatches = matchesChartSearch(chartSearchQuery, [
    selectedTreatmentGoal,
    selectedTreatmentPlanText,
  ]);
  const treatmentPlanSearchCount =
    filteredSelectedPlans.length + (hasTreatmentDraft && treatmentDraftMatches ? 1 : 0);
  const filteredTreatmentServices = treatmentServices.filter((service) =>
    matchesChartSearch(chartSearchQuery, [
      service.object,
      service.diagnosis,
      service.serviceName,
      service.serviceCode,
      service.catalogCode,
      displayServiceInstanceCode(service, visiblePatientsById.get(service.patientId)),
      service.progress,
      service.listPrice,
      service.discount,
      service.finalPrice,
      serviceAppliedAmount(service.id),
    ]),
  );
  const serviceSummary =
    treatmentServices.length > 0
      ? treatmentServices
          .slice(0, 4)
          .map(
            (service) =>
              `${displayServiceInstanceCode(
                service,
                visiblePatientsById.get(service.patientId),
              )} ${service.object}: ${service.serviceName} - ${displayStatus(
                service.progress,
                language,
              )}`,
          )
          .join("; ")
      : jt.empty.noServices;
  const sessionEvents: JourneyTimelineEvent[] = [
    ...selectedAppointments.map((appointment, index) => ({
      group: "Session" as const,
      id: `appointment-${appointment.id}`,
      kind: displayStatus("Session", language),
      label: appointment.time,
      sortMs: journeyTimelineTimestamp(
        appointment.startsAt,
        Number.MAX_SAFE_INTEGER - index,
      ),
      status: appointment.status,
      title:
        language === "vi"
          ? `Buổi ${index + 1}: ${appointment.procedure}`
          : `Session ${index + 1}: ${appointment.procedure}`,
      detail:
        language === "vi"
          ? `Dịch vụ đã làm: ${serviceSummary}. Tiến độ: ${displayStatus(
              appointment.status === "Completed"
                ? "Completed (100%)"
                : "Planned (0%)",
              language,
            )}. Ghi chú sau thủ thuật: ${appointment.provider} - ${appointment.room} - ${
              appointment.duration
            } phút.`
          : `Services performed: ${serviceSummary}. Progress: ${displayStatus(
              appointment.status === "Completed"
                ? "Completed (100%)"
                : "Planned (0%)",
              language,
            )}. Post-procedure note: ${appointment.provider} - ${
              appointment.room
            } - ${appointment.duration} min.`,
    })),
    ...selectedNotes.map((note) => ({
      group: "Clinical" as const,
      id: `note-${note.id}`,
      kind: jt.clinical.title,
      label: note.createdAt,
      sortMs: journeyTimelineTimestamp(note.createdAtIso ?? note.createdAt),
      status: note.lockedAt ? "Locked" : "Draft",
      title: note.assessment ?? note.plan ?? note.subjective ?? jt.clinical.soapNote,
      detail: [note.subjective, note.objective, note.plan].filter(Boolean).join(" | "),
    })),
    ...selectedPlans.map((plan) => ({
      group: "Treatment" as const,
      id: `plan-${plan.id}`,
      kind: jt.plan.title,
      label: plan.createdAt ?? jt.actions.plan,
      sortMs: journeyTimelineTimestamp(plan.createdAt),
      status: plan.status,
      title: plan.title,
      detail: `${plan.phase} - ${formatVnd(plan.patientShare)}`,
    })),
    ...databaseTreatmentServices.flatMap((service) =>
      (service.progressEvents ?? []).map((event) => {
        const fromProgress = serviceProgressLabelFromPercent(
          event.fromProgressPercent,
          undefined,
          service.progressSteps,
        );
        const toProgress = serviceProgressLabelFromPercent(
          event.toProgressPercent,
          undefined,
          service.progressSteps,
        );
        const progressLabel = `${fromProgress} -> ${toProgress}`;
        const participants = [
          `${jt.services.performedBy}: ${event.performedByName}`,
          event.clinicalSupportName
            ? `${jt.services.clinicalSupport}: ${event.clinicalSupportName}`
            : "",
          event.assistantPrimaryName
            ? `${jt.services.assistantPrimary}: ${event.assistantPrimaryName}`
            : "",
          event.assistantSecondaryName
            ? `${jt.services.assistantSecondary}: ${event.assistantSecondaryName}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");

        return {
          group: "Treatment" as const,
          id: `service-progress-${event.id}`,
          kind: jt.services.recordProgress,
          label: event.occurredAt,
          sortMs: journeyTimelineTimestamp(event.occurredAtIso),
          status: `${Math.round(event.toProgressPercent)}%`,
          title: `${displayServiceInstanceCode(
            service,
            visiblePatientsById.get(service.patientId),
          )} · ${service.serviceName}`,
          detail: [progressLabel, participants, event.note].filter(Boolean).join(" · "),
        };
      }),
    ),
    ...selectedReceipts.map((receipt) => {
      const receiptService = treatmentServices.find(
        (service) => service.id === receipt.serviceId,
      );

      return {
        group: "Billing" as const,
        id: `receipt-${receipt.id}`,
        kind: jt.timeline.receipt,
        label: "",
        sortMs: journeyTimelineTimestamp(receipt.collectedAt),
        status: "Paid",
        title: receiptService
          ? `${displayServiceInstanceCode(
              receiptService,
              visiblePatientsById.get(receiptService.patientId),
            )} · ${receiptService.serviceName}`
          : receipt.id,
        detail: `${formatVnd(receipt.amount)} · ${receiptMethodLabel(
          receipt.method,
          language,
        )}`,
      };
    }),
    ...selectedBillingReceipts.map((receipt) => ({
      group: "Billing" as const,
      id: `billing-receipt-${receipt.id}`,
      kind:
        receipt.method === "credit_balance"
          ? language === "vi"
            ? "Phân bổ tiền dư"
            : "Credit allocation"
          : jt.timeline.receipt,
      label: receipt.receivedAt,
      sortMs: journeyTimelineTimestamp(receipt.receivedAtIso),
      status: receipt.unallocatedAmount > 0 ? "Credit balance" : "Paid",
      title: receipt.receiptNo,
      detail:
        receipt.method === "credit_balance"
          ? [
              formatVnd(receipt.allocatedAmount || receipt.amount),
              language === "vi" ? "Từ tiền dư/chưa phân bổ" : "From credit balance",
              language === "vi" ? "Đã phân bổ vào dịch vụ" : "Allocated to service",
              receipt.reference
                ? `${language === "vi" ? "Tham chiếu" : "Reference"} ${receipt.reference}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : [
              formatVnd(receipt.amount),
              receiptMethodLabelForBilling(receipt.method, language),
              receipt.allocatedAmount > 0
                ? `${language === "vi" ? "Đã phân bổ" : "Allocated"} ${formatVnd(receipt.allocatedAmount)}`
                : "",
              receipt.unallocatedAmount > 0
                ? `${language === "vi" ? "Còn dư/chưa phân bổ" : "Remaining unallocated"} ${formatVnd(receipt.unallocatedAmount)}`
                : "",
              receipt.reference
                ? `${language === "vi" ? "Tham chiếu" : "Reference"} ${receipt.reference}`
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
    })),
    ...selectedInvoices.map((invoice) => ({
      group: "Billing" as const,
      id: `invoice-${invoice.id}`,
      kind: displayStatus("Billing", language),
      label: invoice.due,
      sortMs: journeyTimelineTimestamp(invoice.issuedAtMs ?? invoice.due),
      status: invoice.status,
      title: invoice.id,
      detail: [
        `${formatVnd(invoice.paidAmount ?? 0)} / ${formatVnd(invoice.amount)}`,
        `${language === "vi" ? "Hạn thanh toán" : "Due"} ${journeyDate(invoice.due)}`,
      ].join(" · "),
    })),
    ...selectedPrescriptions.map((prescription) => ({
      group: "Clinical" as const,
      id: `prescription-${prescription.id}`,
      kind: jt.timeline.prescription,
      label: prescription.createdAt,
      sortMs: journeyTimelineTimestamp(prescription.createdAtIso),
      status: prescription.status,
      title: prescription.prescriptionNo,
      detail:
        prescription.items
          .map((item) => `${item.drugName}: ${item.sig}`)
          .join(" | ") || prescription.diagnosis || jt.timeline.prescription,
    })),
    ...selectedPatientForms.map((form) => ({
      group: "Files" as const,
      id: `form-${form.id}`,
      kind: jt.timeline.patientForm,
      label: form.completedAt ?? form.sentAt ?? form.createdAt,
      sortMs: journeyTimelineTimestamp(
        form.completedAtIso ?? form.sentAtIso ?? form.createdAtIso,
      ),
      status: form.status,
      title: `${form.formNo} · ${form.templateName}`,
      detail: form.responseText ?? form.templateCode,
    })),
    ...selectedPatientFiles.filter((file) => file.category !== "TIMELINE_COMMENT").map((file) => ({
      group: "Files" as const,
      id: `patient-file-${file.id}`,
      kind: file.category,
      label: file.createdAt,
      sortMs: journeyTimelineTimestamp(file.createdAtIso),
      status: "File",
      title: file.title,
      detail: [file.fileName, file.notes].filter(Boolean).join(" · ") || file.url,
      fileUrl: file.url,
      patientFileGovernance: {
        fileId: file.id,
        retentionUntilIso: file.retentionUntilIso,
        virusScanStatus: file.virusScanStatus,
      },
      imageUrl: file.mimeType?.startsWith("image/")
        ? file.previewUrl ?? file.url
        : undefined,
      imageName: file.fileName ?? file.title,
    })),
    ...selectedCrmActivities.map((activity) => ({
      group: "Session" as const,
      id: `crm-activity-${activity.id}`,
      kind: `CSKH · ${displayStatus(activity.type, language)}`,
      label: activity.createdAt,
      sortMs: journeyTimelineTimestamp(activity.createdAtIso),
      status: activity.completedAt ? "Completed" : "Open",
      title: activity.subject,
      detail: [
        activity.channel ? displayStatus(activity.channel, language) : "",
        activity.body,
        activity.dueAt
          ? `${language === "vi" ? "Hẹn" : "Due"} ${activity.dueAt}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    ...selectedJourneyComments.map((comment) => ({
      group: comment.attachments.length > 0 ? ("Files" as const) : ("Clinical" as const),
      id: `journey-comment-${comment.id}`,
      kind: comment.authorName,
      label: comment.createdAt,
      sortMs: journeyTimelineTimestamp(comment.createdAtIso),
      status: "Comment",
      title: comment.body,
      detail: comment.attachments.length > 0
        ? `${jt.timeline.imageDetailPrefix}: ${comment.attachments
            .map((attachment) => attachment.name)
            .filter(Boolean)
            .join(", ")}`
        : jt.timeline.internalComment,
      attachments: comment.attachments,
      imageUrl: comment.attachments.find((attachment) =>
        attachment.mimeType?.startsWith("image/"),
      )?.url,
      fileUrl: comment.attachments[0]?.url,
      imageName:
        comment.attachments.find((attachment) =>
          attachment.mimeType?.startsWith("image/"),
        )?.name ??
        comment.attachments[0]?.name ??
        undefined,
    })),
    ...timelineComments
      .filter((comment) => comment.patientId === selectedPatientKey)
      .map((comment) => ({
        group:
          comment.attachments && comment.attachments.length > 0
            ? ("Files" as const)
            : comment.imageUrl
              ? ("Files" as const)
              : ("Clinical" as const),
        id: comment.id,
        kind: comment.author,
        label: "",
        sortMs: journeyTimelineTimestamp(comment.createdAt),
        status: "Comment",
        title: comment.body,
        detail:
          comment.attachments && comment.attachments.length > 0
            ? `${jt.timeline.imageDetailPrefix}: ${comment.attachments
                .map((attachment) => attachment.name)
                .filter(Boolean)
                .join(", ")}`
            : comment.imageName
              ? `${jt.timeline.imageDetailPrefix}: ${comment.imageName}`
              : jt.timeline.internalComment,
        attachments: comment.attachments,
        imageUrl:
          comment.attachments?.find((attachment) =>
            attachment.mimeType?.startsWith("image/"),
          )?.url ?? comment.imageUrl,
        fileUrl: comment.attachments?.[0]?.url,
        imageName:
          comment.attachments?.find((attachment) =>
            attachment.mimeType?.startsWith("image/"),
          )?.name ??
          comment.attachments?.[0]?.name ??
          comment.imageName,
      })),
  ]
    .map((event) => ({
      ...event,
      label: formatJourneyTimelineDateTime(
        event.sortMs,
        event.label,
        language,
      ),
    }))
    .sort(compareJourneyTimelineEvents);
  const timelineGroupEvents =
    timelineFilter === "All"
      ? sessionEvents
      : sessionEvents.filter((event) => event.group === timelineFilter);
  const filteredSessionEvents = timelineGroupEvents.filter((event) =>
    matchesChartSearch(chartSearchQuery, [
      event.group,
      event.kind,
      event.label,
      event.status,
      event.title,
      event.detail,
      event.imageName,
    ]),
  );
  const selectedTimelineEvent =
    filteredSessionEvents.find((event) => event.id === selectedTimelineEventId) ??
    filteredSessionEvents[0] ??
    (chartSearchQuery || timelineFilter !== "All" ? undefined : sessionEvents[0]);
  const searchSummary = chartSearchQuery
    ? language === "vi"
      ? `${patientSearchMatches.length} bệnh nhân, ${treatmentPlanSearchCount} kế hoạch, ${filteredTreatmentServices.length} dịch vụ, ${filteredSessionEvents.length} timeline`
      : `${patientSearchMatches.length} patients, ${treatmentPlanSearchCount} plans, ${filteredTreatmentServices.length} services, ${filteredSessionEvents.length} timeline events`
    : jt.chart.searchSummary;
  const renderTimelineImageButton = (
    src: string,
    alt: string | undefined,
    key?: string,
  ) => {
    const imageAlt = alt ?? jt.timeline.fileAlt;

    return (
      <button
        className="timeline-image-button"
        key={key}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpenTimelineImage({ alt: imageAlt, src });
        }}
        aria-label={`${jt.timeline.openImage}: ${imageAlt}`}
      >
        <img className="timeline-image" src={src} alt={imageAlt} />
      </button>
    );
  };
  const renderTimelineAttachment = (
    attachment: JourneyTimelineAttachment,
    mode: "compact" | "preview",
  ) => {
    const attachmentName = attachment.name ?? jt.timeline.openFile;
    const imageSrc = attachment.thumbnailUrl ?? attachment.previewUrl ?? attachment.url;
    const openImageSrc = attachment.previewUrl ?? attachment.url;
    const isImage = attachment.mimeType?.startsWith("image/");
    const isVideo = attachment.mimeType?.startsWith("video/");
    const fileMeta = [
      timelineFileKindLabel(attachment.fileKind, language),
      attachment.sizeBytes ? formatFileSize(attachment.sizeBytes) : "",
    ]
      .filter(Boolean)
      .join(" · ");

    if (isImage) {
      return (
        <button
          className={
            mode === "preview"
              ? "timeline-image-button preview"
              : "timeline-image-button"
          }
          type="button"
          key={attachment.id}
          onClick={(clickEvent) => {
            clickEvent.stopPropagation();
            setOpenTimelineImage({
              alt: attachmentName,
              src: openImageSrc,
            });
          }}
          aria-label={`${jt.timeline.openImage}: ${attachmentName}`}
        >
          <img
            className={mode === "preview" ? "timeline-image-preview" : "timeline-image"}
            src={imageSrc}
            alt={attachmentName}
          />
        </button>
      );
    }

    if (isVideo && mode === "preview") {
      return (
        <video
          className="timeline-video-preview"
          controls
          key={attachment.id}
          preload="metadata"
          src={attachment.url}
        />
      );
    }

    return (
      <a
        className="secondary-button timeline-file-link"
        href={attachment.url}
        rel="noreferrer"
        target="_blank"
        key={attachment.id}
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <FileText size={16} />
        <span>
          {attachmentName}
          {fileMeta ? <small>{fileMeta}</small> : null}
        </span>
      </a>
    );
  };

  return (
    <section className="view-stack patient-chart">
      <div className="toolbar">
        <div className="patient-chart-toolbar-title">
          <p className="eyebrow">{jt.chart.eyebrow}</p>
          <h2>{selectedPatient ? jt.chart.title : jt.chart.emptyTitle}</h2>
        </div>
        <SourceBadge source={source} />
      </div>

      <div className="chart-search-meta patient-chart-search-meta">
        <span>{searchSummary}</span>
      </div>

      {(notice || messages.length > 0) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? messages[0]}
        </div>
      )}

      {selectedPatient ? (
        <section className="patient-chart-flow">
          <section className="patient-chart-paired-blocks">
          <section className="panel patient-chart-header" id="chart-admin">
            <PanelHeader
              icon={UsersRound}
              title={jt.admin.title}
              action={jt.actions.admin}
            />

            <nav
              className="chart-section-nav"
              aria-label={jt.chart.sectionNavAria}
            >
              <a href="#chart-admin">{jt.nav.admin}</a>
              <a href="#chart-note">{jt.nav.exam}</a>
              <a href="#chart-odontogram">{jt.nav.odontogram}</a>
              <a href="#chart-plan">{jt.nav.plan}</a>
              <a href="#chart-services">{jt.nav.services}</a>
              <a href="#chart-timeline">{jt.nav.timeline}</a>
            </nav>

            <div className="patient-chart-topline">
              <div className="patient-chart-identity">
                <div className="avatar patient-chart-avatar">
                  {patientInitials(selectedPatient.name)}
                </div>
                <div>
                  <p className="eyebrow">{jt.admin.patientRecord}</p>
                  <h2>{selectedPatient.name}</h2>
                  <div className="patient-chart-meta">
                    <span className="code-chip">
                      {patientCodeFor(selectedPatient)} · {patientClassCodeFor(selectedPatient)}
                    </span>
                    <span>{selectedPatient.phone}</span>
                    <span>{selectedPatient.email ?? jt.admin.noEmail}</span>
                    <span>{clinicName}</span>
                  </div>
                </div>
              </div>

            </div>

            <div className="patient-chart-stats">
              <div>
                <span>{jt.admin.age}</span>
                <strong>{selectedPatient.age || jt.admin.unknown}</strong>
              </div>
              <div>
                <span>{jt.admin.consent}</span>
                <strong>{displayStatus(selectedPatient.consent, language)}</strong>
              </div>
              <div>
                <span>{jt.admin.sessions}</span>
                <strong>{selectedAppointments.length}</strong>
              </div>
              <div>
                <span>{jt.admin.debt}</span>
                <strong>{formatVnd(totalDue)}</strong>
              </div>
            </div>

            <details className="patient-admin-details">
              <summary>
                <strong>{jt.admin.extendedInfo}</strong>
                <span>
                  {selectedPatient.dateOfBirth ?? jt.admin.unknown} ·{" "}
                  {selectedPatient.address ?? selectedPatient.city}
                </span>
              </summary>
              <dl className="journey-detail-list compact patient-admin-list">
                <div>
                  <dt>{jt.admin.patientCode}</dt>
                  <dd>
                    {patientCodeFor(selectedPatient)} · {patientClassCodeFor(selectedPatient)}
                  </dd>
                </div>
                <div>
                  <dt>{jt.admin.dobAge}</dt>
                  <dd>
                    {selectedPatient.dateOfBirth ?? jt.admin.unknown} /{" "}
                    {selectedPatient.age || jt.admin.unknown}
                  </dd>
                </div>
                <div>
                  <dt>{jt.admin.guardian}</dt>
                  <dd>{selectedPatient.guardianName ?? jt.admin.notApplicable}</dd>
                </div>
                <div>
                  <dt>{jt.admin.nationalId}</dt>
                  <dd>{selectedPatient.nationalId ?? jt.admin.unknown}</dd>
                </div>
                <div>
                  <dt>{jt.admin.address}</dt>
                  <dd>{selectedPatient.address ?? selectedPatient.city}</dd>
                </div>
                <div>
                  <dt>{jt.admin.consent}</dt>
                  <dd>
                    {displayStatus(selectedPatient.consent, language)} -{" "}
                    {selectedPatient.consentSignedAt ?? jt.admin.unsignedDate}
                  </dd>
                </div>
              </dl>
            </details>

            <div className="patient-safety-strip">
              {selectedPatient.flags.map((flag) => (
                <span key={flag}>{flag}</span>
              ))}
            </div>
          </section>

          <section className="panel journey-clinical-panel" id="chart-note">
            <PanelHeader
              icon={Stethoscope}
              title={jt.clinical.title}
              action={jt.clinical.action}
            />
            <form
              action={createClinicalNoteAction}
              className="clinical-intake-form"
              key={`${selectedPatient.id}-${latestNote?.id ?? "new"}`}
            >
              <input name="patientId" type="hidden" value={selectedPatient.id} />
              <label className="clinical-wide">
                {jt.clinical.reason}
                <textarea
                  name="subjective"
                  defaultValue={selectedPatient.visitReason ?? latestNote?.subjective ?? ""}
                  placeholder={jt.clinical.reasonPlaceholder}
                  disabled={!clinicalReady}
                />
              </label>
              <label className="clinical-wide">
                {jt.clinical.historyAllergy}
                <textarea
                  name="objective"
                  defaultValue={latestExamFields.objective}
                  placeholder={jt.clinical.historyAllergyPlaceholder}
                  disabled={!clinicalReady}
                />
              </label>
              <label className="clinical-wide">
                {jt.clinical.history}
                <textarea
                  name="medicalHistory"
                  defaultValue={latestExamFields.medicalHistory}
                  placeholder={jt.clinical.historyPlaceholder}
                  disabled={!clinicalReady}
                />
              </label>
              <div className="vitals-grid">
                <label>
                  {jt.clinical.heartRate}
                  <input
                    name="heartRate"
                    defaultValue={latestExamFields.heartRate}
                    placeholder="78 bpm"
                    disabled={!clinicalReady}
                  />
                </label>
                <label>
                  {jt.clinical.temperature}
                  <input
                    name="temperature"
                    defaultValue={latestExamFields.temperature}
                    placeholder="36.8 C"
                    disabled={!clinicalReady}
                  />
                </label>
                <label>
                  {jt.clinical.bloodPressure}
                  <input
                    name="bloodPressure"
                    defaultValue={latestExamFields.bloodPressure}
                    placeholder="120/80"
                    disabled={!clinicalReady}
                  />
                </label>
              </div>
              <label className="clinical-wide">
                {jt.clinical.assessment}
                <textarea
                  name="assessment"
                  defaultValue={latestNote?.assessment ?? ""}
                  placeholder={jt.clinical.assessmentPlaceholder}
                  disabled={!clinicalReady}
                />
              </label>
              <label className="clinical-wide">
                {jt.clinical.initialPlan}
                <textarea
                  name="plan"
                  defaultValue={latestNote?.plan ?? ""}
                  placeholder={jt.clinical.initialPlanPlaceholder}
                  disabled={!clinicalReady}
                />
              </label>
              <button className="primary-button" type="submit" disabled={!clinicalReady}>
                <FileText size={16} />
                {jt.clinical.save}
              </button>
            </form>
          </section>
          </section>

          <section className="panel journey-odontogram-panel" id="chart-odontogram">
            <PanelHeader
              icon={Activity}
              title={jt.odontogram.title}
              action={jt.actions.toothPlanning}
            />
            <PatientOdontogramEditor
              key={selectedPatientKey}
              canEdit={odontogramReady}
              initialOdontogram={selectedOdontogram}
              language={language}
              onSelectionChange={(teeth) =>
                updateSelectedToothTargets(teeth.map((tooth) => `R${tooth}`))
              }
              patientId={selectedPatientKey}
              selectedTeeth={selectedToothTargets.map((tooth) =>
                tooth.replace(/^R/, ""),
              )}
            />
            <div className="odontogram-workbench">
              <div>
                <p className="eyebrow">{jt.odontogram.targetPrompt}</p>
                <div
                  className="arch-target-row"
                  role="group"
                  aria-label={jt.odontogram.targetAria}
                >
                  {archTargets.map((target) => (
                    <button
                      className={
                        selectedArchTargets.includes(target.id)
                          ? "arch-target active"
                          : "arch-target"
                      }
                      type="button"
                      key={target.id}
                      onClick={() => toggleArchTarget(target.id)}
                      aria-pressed={selectedArchTargets.includes(target.id)}
                    >
                      {treatmentTargetLabel(target.id, language)}
                    </button>
                  ))}
                </div>
                <div className="selected-teeth-row">
                  {selectedServiceTargets.length > 0 ? (
                    selectedServiceTargets.map((target) => (
                      <span key={target}>{target}</span>
                    ))
                  ) : (
                    <small>{jt.odontogram.emptySelection}</small>
                  )}
                </div>
              </div>
              <form
                className="odontogram-planner"
                action={
                  journeyServiceDatabaseReady
                    ? createJourneyTreatmentServicesAction
                    : undefined
                }
                onSubmit={() => {
                  if (
                    journeyServiceDatabaseReady &&
                    selectedLibraryService &&
                    selectedServiceTargets.length > 0
                  ) {
                    window.setTimeout(() => setSelectedTeeth([]), 0);
                  }
                }}
              >
                <input name="patientId" type="hidden" value={selectedPatientKey} />
                <input
                  name="targets"
                  type="hidden"
                  value={selectedServiceTargets.join("\n")}
                />
                <label>
                  {jt.odontogram.diagnosis}
                  <input
                    name="diagnosis"
                    value={odontogramDiagnosis}
                    onChange={(event) => setOdontogramDiagnosis(event.target.value)}
                  />
                </label>
                <label>
                  {jt.odontogram.serviceLibrary}
                  <select
                    name="serviceCatalogItemId"
                    value={selectedServiceId}
                    onChange={(event) => setSelectedServiceId(event.target.value)}
                    disabled={serviceOptions.length === 0}
                  >
                    <option value="" disabled>
                      {jt.odontogram.selectService}
                    </option>
                    {serviceOptions.map((service) => (
                      <option value={service.id} key={service.id}>
                        {service.code} · {serviceCatalogOptionName(service, language)} - {formatVnd(service.price)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary-button"
                  type={journeyServiceDatabaseReady ? "submit" : "button"}
                  onClick={
                    journeyServiceDatabaseReady
                      ? undefined
                      : addServicesFromOdontogram
                  }
                  disabled={!selectedLibraryService || selectedServiceTargets.length === 0}
                >
                  <WalletCards size={16} />
                  {jt.odontogram.addService}
                </button>
              </form>
            </div>
          </section>

          <section className="panel" id="chart-plan">
            <PanelHeader
              icon={ClipboardList}
              title={jt.plan.title}
              action={jt.actions.plan}
            />
            <form
              action={updateJourneyStateAction}
              className="journey-treatment-notes"
              key={`${selectedPatient.id}-${selectedJourneyState?.updatedAt ?? "draft"}`}
            >
              <input name="patientId" type="hidden" value={selectedPatient.id} />
              <input
                name="odontogramTeeth"
                type="hidden"
                value={selectedTeeth.join("\n")}
              />
              <label>
                {jt.plan.goalField}
                <textarea
                  name="treatmentGoal"
                  defaultValue={selectedTreatmentGoal}
                  onChange={(event) => updateTreatmentDraft("goal", event.target.value)}
                  placeholder={jt.plan.goalPlaceholder}
                  disabled={!journeyRecordsReady && journeyRecordsWorkspace?.source === "database"}
                />
              </label>
              <label>
                {jt.plan.planField}
                <textarea
                  name="treatmentPlan"
                  defaultValue={selectedTreatmentPlanText}
                  onChange={(event) => updateTreatmentDraft("plan", event.target.value)}
                  placeholder={jt.plan.planPlaceholder}
                  disabled={!journeyRecordsReady && journeyRecordsWorkspace?.source === "database"}
                />
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={!journeyRecordsReady}
              >
                <ClipboardList size={16} />
                {jt.clinical.save}
              </button>
            </form>
          </section>

          <section className="panel journey-services-panel" id="chart-services">
            <PanelHeader
              icon={WalletCards}
              title={jt.services.title}
              action={jt.actions.services}
            />
            <div className="journey-service-table">
              <div
                className={
                  canDeleteTreatmentServices
                    ? "journey-service-row head with-actions"
                    : "journey-service-row head"
                }
              >
                <span>{jt.services.serviceCode}</span>
                <span>{jt.services.object}</span>
                <span>{jt.services.serviceName}</span>
                <span>{jt.services.diagnosis}</span>
                <span>{jt.services.progress}</span>
                <span>{jt.services.listPrice}</span>
                <span>{jt.services.discount}</span>
                <span>{jt.services.finalPrice}</span>
                <span>{jt.services.collected}</span>
                {canDeleteTreatmentServices && <span>{jt.services.actions}</span>}
              </div>
              {filteredTreatmentServices.length > 0 ? (
                filteredTreatmentServices.map((service) => {
                  const progressPercent = serviceProgressPercent(service.progress);
                  const displayedAppliedAmount = Math.min(
                    serviceAppliedAmount(service.id),
                    service.finalPrice,
                  );
                  const discountLocked =
                    service.source === "database" &&
                    ((service.invoicedAmount ?? 0) > 0 ||
                      (service.collectedAmount ?? 0) > 0 ||
                      (service.creditAllocatedAmount ?? 0) > 0);
                  const serviceDeleteLocked =
                    service.source === "database" &&
                    (service.progress !== "Planned (0%)" ||
                      progressPercent > 0 ||
                      (service.progressEvents?.length ?? 0) > 0 ||
                      (service.invoicedAmount ?? 0) > 0 ||
                      (service.collectedAmount ?? 0) > 0 ||
                      (service.creditAllocatedAmount ?? 0) > 0);

                  return (
                    <div
                      className={
                        canDeleteTreatmentServices
                          ? "journey-service-row with-actions"
                          : "journey-service-row"
                      }
                      key={service.id}
                    >
                      <span className="code-chip" data-label={jt.services.serviceCode}>
                        {displayServiceInstanceCode(
                          service,
                          visiblePatientsById.get(service.patientId),
                        )}
                      </span>
                      <span data-label={jt.services.object}>{service.object}</span>
                      <div className="journey-service-name" data-label={jt.services.serviceName}>
                        <strong>{service.serviceName}</strong>
                        {(service.createdBy || service.compensationRuleName) && (
                          <small>
                            {service.createdBy
                              ? `${jt.services.createdBy} ${service.createdBy}`
                              : ""}
                            {service.createdBy && service.compensationRuleName
                              ? " · "
                              : ""}
                            {service.compensationRuleName ?? ""}
                          </small>
                        )}
                      </div>
                      <span data-label={jt.services.diagnosis}>{service.diagnosis}</span>
                      {service.source === "database" ? (
                        <div className="service-progress-cell" data-label={jt.services.progress}>
                          <select
                            value={String(progressPercent)}
                            onChange={(event) => {
                              const toProgressPercent = Number(event.target.value);

                              if (
                                Number.isNaN(toProgressPercent) ||
                                toProgressPercent === progressPercent
                              ) {
                                return;
                              }

                              setPendingProgressUpdate({
                                serviceId: service.id,
                                serviceLabel: displayServiceInstanceCode(
                                  service,
                                  visiblePatientsById.get(service.patientId),
                                ),
                                serviceName: service.serviceName,
                                fromProgressPercent: progressPercent,
                                toProgressPercent,
                                steps: service.progressSteps ?? [],
                              });
                            }}
                          >
                            {serviceProgressPercentOptions(progressPercent, service.progressSteps).map((percent) => (
                              <option value={percent} key={percent}>
                                {serviceProgressLabelFromPercent(
                                  percent,
                                  undefined,
                                  service.progressSteps,
                                )}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : service.source === "odontogram" ? (
                        <div className="service-progress-cell" data-label={jt.services.progress}>
                          <select
                            value={service.progress}
                            onChange={(event) =>
                              updateServiceProgress(service.id, event.target.value)
                            }
                          >
                            {serviceProgressOptions.map((progress) => (
                              <option value={progress} key={progress}>
                                {displayStatus(progress, language)}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span data-label={jt.services.progress}>{displayStatus(service.progress, language)}</span>
                      )}
                      <span data-label={jt.services.listPrice}>{formatVnd(service.listPrice)}</span>
                      {service.source === "odontogram" ? (
                        <div className="journey-service-input-cell" data-label={jt.services.discount}>
                          <MoneyInput
                            name={`discount-${service.id}`}
                            value={service.discount}
                            onValueChange={(amount) => updateServiceDiscount(service.id, amount)}
                          />
                        </div>
                      ) : service.source === "database" && !discountLocked ? (
                        <form
                          action={updateJourneyTreatmentServiceDiscountAction}
                          className="journey-service-discount-form"
                          data-label={jt.services.discount}
                          onBlur={(event) => submitServiceDiscountOnBlur(event, service.discount)}
                        >
                          <input name="patientId" type="hidden" value={selectedPatientKey} />
                          <input name="treatmentServiceId" type="hidden" value={service.id} />
                          <MoneyInput
                            aria-label={jt.services.discount}
                            name="discount"
                            defaultValue={service.discount}
                          />
                        </form>
                      ) : (
                        <span data-label={jt.services.discount}>{formatVnd(service.discount)}</span>
                      )}
                      <span data-label={jt.services.finalPrice}>{formatVnd(service.finalPrice)}</span>
                      <span className="journey-service-paid" data-label={jt.services.collected}>
                        <strong>{formatVnd(displayedAppliedAmount)}</strong>
                      </span>
                      {canDeleteTreatmentServices && (
                        <div
                          className="journey-service-action-cell"
                          data-label={jt.services.actions}
                        >
                          {service.source === "database" ? (
                            serviceDeleteLocked ? (
                              <button
                                className="icon-button small"
                                type="button"
                                disabled
                                title={jt.services.deleteLocked}
                                aria-label={jt.services.deleteLocked}
                              >
                                <Trash2 size={16} />
                              </button>
                            ) : (
                              <form
                                action={deleteJourneyTreatmentServiceAction}
                                onSubmit={(event) => {
                                  if (!window.confirm(jt.services.deleteConfirm)) {
                                    event.preventDefault();
                                  }
                                }}
                              >
                                <input name="patientId" type="hidden" value={selectedPatientKey} />
                                <input
                                  name="treatmentServiceId"
                                  type="hidden"
                                  value={service.id}
                                />
                                <button
                                  className="icon-button small danger-icon"
                                  type="submit"
                                  aria-label={jt.services.delete}
                                  title={jt.services.delete}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </form>
                            )
                          ) : service.source === "odontogram" ? (
                            <button
                              className="icon-button small danger-icon"
                              type="button"
                              onClick={() => {
                                if (window.confirm(jt.services.deleteConfirm)) {
                                  removeDraftTreatmentService(service.id);
                                }
                              }}
                              aria-label={jt.services.delete}
                              title={jt.services.delete}
                            >
                              <Trash2 size={16} />
                            </button>
                          ) : (
                            <span aria-hidden="true">-</span>
                          )}
                        </div>
                      )}
                      <div
                        className={
                          serviceProgressIsCancelled(service.progress)
                            ? "journey-service-progress cancelled"
                            : "journey-service-progress"
                        }
                        role="progressbar"
                        data-label={jt.services.progress}
                        aria-label={`${displayStatus(
                          service.progress,
                          language,
                        )} ${progressPercent}%`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progressPercent}
                      >
                        <div className="journey-service-progress-meta">
                          <span>{displayStatus(service.progress, language)}</span>
                          <strong>{progressPercent}%</strong>
                        </div>
                        <span className="journey-service-progress-track">
                          <span
                            className="journey-service-progress-fill"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  label={
                    chartSearchQuery
                      ? jt.empty.noMatchingServices
                      : jt.empty.noServices
                  }
                />
              )}
            </div>
          </section>

          <section className="panel chart-timeline-panel" id="chart-timeline">
            <PanelHeader
              icon={CalendarDays}
              title={jt.timeline.title}
              action={`${filteredSessionEvents.length}/${sessionEvents.length}`}
            />

            <div
              className="segmented chart-filter-row"
              role="group"
              aria-label={jt.timeline.title}
            >
              {journeyTimelineFilters.map((filter) => (
                <button
                  className={timelineFilter === filter ? "active" : ""}
                  type="button"
                  key={filter}
                  onClick={() => {
                    setTimelineFilter(filter);
                    setSelectedTimelineEventId("");
                  }}
                >
                  {displayStatus(filter, language)}
                </button>
              ))}
            </div>

            {selectedTimelineEvent && (
              <div className="chart-context-detail chart-context-detail-inline">
                <span>{selectedTimelineEvent.label}</span>
                <strong>{selectedTimelineEvent.title}</strong>
                <StatusPill status={selectedTimelineEvent.status} />
                <p>{selectedTimelineEvent.detail}</p>
                {(!selectedTimelineEvent.attachments ||
                  selectedTimelineEvent.attachments.length === 0) &&
                  selectedTimelineEvent.imageUrl && (
                  renderTimelineImageButton(
                    selectedTimelineEvent.imageUrl,
                    selectedTimelineEvent.imageName,
                  )
                )}
                {selectedTimelineEvent.fileUrl &&
                  (!selectedTimelineEvent.attachments ||
                    selectedTimelineEvent.attachments.length === 0) && (
                  <a
                    className="secondary-button timeline-file-link"
                    href={selectedTimelineEvent.fileUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <FileText size={16} />
                    {jt.timeline.openFile}
                  </a>
                )}
                {selectedTimelineEvent.patientFileGovernance && (
                  <form
                    action={updatePatientFileGovernanceAction}
                    className="patient-file-governance-form"
                  >
                    <input
                      name="fileId"
                      type="hidden"
                      value={selectedTimelineEvent.patientFileGovernance.fileId}
                    />
                    <label>
                      {jt.timeline.scanStatus}
                      <select
                        name="virusScanStatus"
                        defaultValue={selectedTimelineEvent.patientFileGovernance.virusScanStatus}
                        disabled={!patientFilesWorkspace?.canMutate}
                      >
                        {[
                          "NOT_SCANNED",
                          "PENDING",
                          "CLEAN",
                          "QUARANTINED",
                          "INFECTED",
                          "EXTERNAL_URL",
                        ].map((status) => (
                          <option value={status} key={status}>
                            {displayStatus(status, language)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {jt.timeline.retentionUntil}
                      <input
                        name="retentionUntil"
                        type="date"
                        defaultValue={
                          selectedTimelineEvent.patientFileGovernance.retentionUntilIso ?? ""
                        }
                        disabled={!patientFilesWorkspace?.canMutate}
                      />
                    </label>
                    <button type="submit" disabled={!patientFilesWorkspace?.canMutate}>
                      {jt.timeline.saveGovernance}
                    </button>
                  </form>
                )}
                {selectedTimelineEvent.attachments &&
                  selectedTimelineEvent.attachments.length > 0 && (
                    <div className="timeline-attachment-list">
                      {selectedTimelineEvent.attachments.map((attachment) =>
                        renderTimelineAttachment(attachment, "preview"),
                      )}
                    </div>
                  )}
              </div>
            )}

            <div className="journey-timeline chart-timeline">
              {filteredSessionEvents.length > 0 ? (
                filteredSessionEvents.map((event) => (
                  <article
                    className={
                      selectedTimelineEvent?.id === event.id
                        ? "chart-timeline-event active"
                        : "chart-timeline-event"
                    }
                    key={event.id}
                    onClick={() => setSelectedTimelineEventId(event.id)}
                    onKeyDown={(keyboardEvent) => {
                      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                        keyboardEvent.preventDefault();
                        setSelectedTimelineEventId(event.id);
                      }
                    }}
                    tabIndex={0}
                  >
                    <time>{event.label}</time>
                    <span className={`chart-event-marker ${statusClass(event.group)}`} />
                    <div className="chart-timeline-event-body">
                      <span>{event.kind}</span>
                      <strong>{event.title}</strong>
                      <small>{event.detail}</small>
                      {event.attachments && event.attachments.length > 0 ? (
                        <div className="timeline-attachment-list compact">
                          {event.attachments.map((attachment) =>
                            renderTimelineAttachment(attachment, "compact"),
                          )}
                        </div>
                      ) : event.imageUrl ? (
                        renderTimelineImageButton(
                          event.imageUrl,
                          event.imageName,
                          event.id,
                        )
                      ) : null}
                    </div>
                    <StatusPill status={event.status} />
                  </article>
                ))
              ) : (
                <EmptyState label={jt.empty.noMatchingEvents} />
              )}
            </div>

            <form
              action={createJourneyCommentAction}
              className="timeline-comment-form"
              id="chart-comment"
            >
              <input name="patientId" type="hidden" value={selectedPatient.id} />
              <label>
                {jt.timeline.comment}
                <textarea
                  name="body"
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder={jt.timeline.commentPlaceholder}
                  disabled={!journeyRecordsReady}
                />
              </label>
              <label>
                {jt.timeline.attachment}
                <input
                  name="file"
                  type="file"
                  accept="image/*,video/mp4,video/quicktime,application/pdf,.pdf,.stl,.ply,.obj,.3mf,.glb,.gltf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  disabled={!journeyRecordsReady}
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    const attachments = files.map((file, index) => ({
                      id: `${file.name}-${file.size}-${index}`,
                      name: file.name,
                      url: URL.createObjectURL(file),
                      mimeType: file.type || null,
                      fileKind: timelineFileKind(file.name, file.type),
                      sizeBytes: file.size,
                      previewUrl: null,
                      thumbnailUrl: null,
                    }));
                    const firstImage = attachments.find((attachment) =>
                      attachment.mimeType?.startsWith("image/"),
                    );

                    setCommentAttachments(attachments);
                    setCommentImage(
                      firstImage
                        ? {
                            name: firstImage.name ?? jt.timeline.openImage,
                            url: firstImage.url,
                          }
                        : null,
                    );
                  }}
                />
              </label>
              {commentAttachments.length > 0 && (
                <div className="timeline-attachment-list">
                  {commentAttachments.map((attachment) =>
                    renderTimelineAttachment(attachment, "preview"),
                  )}
                </div>
              )}
              <button className="primary-button" type="submit" disabled={!journeyRecordsReady}>
                <MessageSquareText size={16} />
                {jt.timeline.postComment}
              </button>
            </form>
          </section>
        </section>
      ) : (
        <EmptyState label={jt.chart.noPatient} />
      )}

      {pendingProgressUpdate && selectedPatient && (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={jt.services.recordProgress}
          onClick={() => setPendingProgressUpdate(null)}
        >
          <form
            action={recordJourneyServiceProgressAction}
            className="progress-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={() => setPendingProgressUpdate(null)}
          >
            <input
              name="treatmentServiceId"
              type="hidden"
              value={pendingProgressUpdate.serviceId}
            />
            <input name="patientId" type="hidden" value={selectedPatient.id} />
            <input
              name="toProgressPercent"
              type="hidden"
              value={pendingProgressUpdate.toProgressPercent}
            />
            <div className="progress-modal-header">
              <div>
                <span>{pendingProgressUpdate.serviceLabel}</span>
                <h3>{pendingProgressUpdate.serviceName}</h3>
              </div>
              <StatusPill
                status={`${serviceProgressLabelFromPercent(
                  pendingProgressUpdate.fromProgressPercent,
                  undefined,
                  pendingProgressUpdate.steps,
                )} -> ${serviceProgressLabelFromPercent(
                  pendingProgressUpdate.toProgressPercent,
                  undefined,
                  pendingProgressUpdate.steps,
                )}`}
              />
            </div>
            <div className="progress-modal-grid">
              <label>
                {jt.services.clinicalSupport}
                <select name="clinicalSupportId" defaultValue="">
                  <option value="">
                    {language === "vi" ? "Không chọn" : "Not selected"}
                  </option>
                  {progressParticipants.map((member) => (
                    <option value={member.id} key={member.id}>
                      {member.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {jt.services.assistantPrimary}
                <select name="assistantPrimaryId" defaultValue="">
                  <option value="">
                    {language === "vi" ? "Không chọn" : "Not selected"}
                  </option>
                  {progressParticipants.map((member) => (
                    <option value={member.id} key={member.id}>
                      {member.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {jt.services.assistantSecondary}
                <select name="assistantSecondaryId" defaultValue="">
                  <option value="">
                    {language === "vi" ? "Không chọn" : "Not selected"}
                  </option>
                  {progressParticipants.map((member) => (
                    <option value={member.id} key={member.id}>
                      {member.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="progress-modal-note">
                {language === "vi" ? "Ghi chú tiến độ" : "Progress note"}
                <textarea
                  name="note"
                  placeholder={
                    language === "vi"
                      ? "Ví dụ: hoàn tất bước lấy dấu, bệnh nhân ổn định"
                      : "Example: impression step completed, patient stable"
                  }
                />
              </label>
            </div>
            <div className="progress-modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setPendingProgressUpdate(null)}
              >
                {language === "vi" ? "Hủy" : "Cancel"}
              </button>
              <button className="primary-button" type="submit">
                <ClipboardList size={16} />
                {jt.services.recordProgress}
              </button>
            </div>
          </form>
        </div>
      )}

      {openTimelineImage && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={openTimelineImage.alt}
          onClick={() => setOpenTimelineImage(null)}
        >
          <div
            className="image-lightbox-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="icon-button image-lightbox-close"
              type="button"
              onClick={() => setOpenTimelineImage(null)}
              aria-label={jt.timeline.closeImage}
            >
              ×
            </button>
            <img src={openTimelineImage.src} alt={openTimelineImage.alt} />
            <span>{openTimelineImage.alt}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function patientInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "P";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";

  return `${first}${last}`.toUpperCase();
}

function journeyDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
  }).format(date);
}

