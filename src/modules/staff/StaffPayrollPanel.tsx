"use client";

import { Activity, Building2, CalendarDays, FileText, WalletCards, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DayPicker, type DayButtonProps } from "react-day-picker";
import { enUS, vi } from "react-day-picker/locale";
import { useMemo, useState, type MouseEvent } from "react";
import {
  approvePayrollRunAction,
  adjustAttendanceLogAction,
  clockInStaffAction,
  clockOutStaffAction,
  createLeaveRequestAction,
  createPayrollRunFromAccrualsAction,
  createStaffShiftAction,
  importPayrollPoliciesAction,
  markPayrollRunPaidAction,
  updatePayrollPolicyAction,
  updateLeaveRequestStatusAction,
  voidPayrollRunAction,
} from "@/app/(app)/staff/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { MoneyInput } from "@/components/MoneyInput";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, MetricCard, PanelHeader, RecordTile, StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import { formatVnd, type Clinic } from "@/lib/data";
import type { StaffPayrollWorkspace } from "@/lib/payroll-types";
import type { SettingsWorkspace } from "@/lib/settings-types";

const uiText: Record<Language, { allClinics: string; clinicScope: string; roles: Record<string, string> }> = {
  vi: {
    allClinics: "Tất cả chi nhánh",
    clinicScope: "Phòng khám",
    roles: {
      OWNER: "Chủ hệ thống",
      AREA_MANAGER: "Quản lý khu vực",
      CLINIC_MANAGER: "Quản lý phòng khám",
      DENTIST: "Nha sĩ",
      HYGIENIST: "Điều dưỡng nha khoa",
      FRONT_DESK: "Lễ tân",
      BILLING: "Thu ngân",
      PATIENT: "Bệnh nhân",
    },
  },
  en: {
    allClinics: "All clinics",
    clinicScope: "Clinic",
    roles: {
      OWNER: "Owner",
      AREA_MANAGER: "Area manager",
      CLINIC_MANAGER: "Clinic manager",
      DENTIST: "Dentist",
      HYGIENIST: "Hygienist",
      FRONT_DESK: "Front desk",
      BILLING: "Billing",
      PATIENT: "Patient",
    },
  },
};

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { t } = useAppLanguage();

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? t.databaseLive : t.demoMode}
    </span>
  );
}

function workspaceMessageText(message: string | null | undefined, language: Language) {
  if (!message || language !== "vi") return message;

  const viMessages: Record<string, string> = {
    "Chưa có dữ liệu trong phạm vi hiện tại.":
      "Chưa có dữ liệu trong phạm vi hiện tại.",
  };

  return viMessages[message] ?? message;
}

function noticeText(notice: string | null, language: Language) {
  const notices: Record<string, Record<Language, string>> = {
    "staff-payroll-created": { vi: "Đã tạo bảng lương từ accrual đã phát sinh.", en: "Payroll run created from earned accruals." },
    "staff-payroll-approved": { vi: "Đã duyệt bảng lương.", en: "Payroll run approved." },
    "staff-payroll-paid": { vi: "Đã đánh dấu bảng lương đã chi trả.", en: "Payroll run marked as paid." },
    "staff-payroll-voided": { vi: "Đã hủy bảng lương và trả accrual về trạng thái chờ.", en: "Payroll run voided and accruals released." },
    "staff-payroll-policy-saved": { vi: "Đã lưu preset chính sách lương.", en: "Payroll policy preset saved." },
    "staff-payroll-policy-imported": { vi: "Đã import CSV chính sách lương.", en: "Payroll policy CSV imported." },
    "staff-payroll-policy-import-empty": { vi: "CSV chính sách lương không có dòng hợp lệ.", en: "Payroll policy CSV has no importable rows." },
    "staff-payroll-policy-import-failed": { vi: "Import CSV chính sách lương thất bại.", en: "Payroll policy CSV import failed." },
    "staff-payroll-policy-bad-json": { vi: "JSON override chính sách lương không hợp lệ.", en: "Payroll policy override JSON is invalid." },
    "staff-payroll-run-missing": { vi: "Bảng lương không khả dụng cho thao tác này.", en: "The payroll run is not available for that action." },
    "staff-denied": { vi: "Vai trò này không thể quản lý bảng lương.", en: "This role cannot manage payroll." },
    "staff-payroll-date": { vi: "Chọn kỳ lương hợp lệ.", en: "Select a valid payroll period." },
    "staff-payroll-empty": { vi: "Không có accrual đủ điều kiện trong kỳ này.", en: "No earned accruals were found for that period." },
    "staff-database": { vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.", en: "The change could not be saved. Please try again." },
    "staff-shift-created": { vi: "Đã tạo ca làm.", en: "Staff shift created." },
    "staff-shift-missing": { vi: "Cần chọn nhân viên, phòng khám, ngày và giờ ca hợp lệ.", en: "Select a staff member, clinic, date, and valid shift time." },
    "staff-profile-missing": { vi: "Không tìm thấy hồ sơ nhân sự trong phạm vi phòng khám này.", en: "The staff profile could not be found in this clinic scope." },
    "staff-attendance-open": { vi: "Nhân viên này đang có log chấm công chưa ra ca.", en: "This staff member already has an open attendance log." },
    "staff-clocked-in": { vi: "Đã ghi nhận vào ca.", en: "Clock-in recorded." },
    "staff-attendance-missing": { vi: "Không tìm thấy log chấm công đang mở.", en: "The open attendance log could not be found." },
    "staff-clocked-out": { vi: "Đã ghi nhận ra ca.", en: "Clock-out recorded." },
    "staff-attendance-adjusted": { vi: "Đã chỉnh công.", en: "Attendance log adjusted." },
    "staff-leave-missing": { vi: "Cần chọn nhân viên và kỳ nghỉ hợp lệ.", en: "Select a staff member and a valid leave period." },
    "staff-leave-created": { vi: "Đã tạo đơn nghỉ phép.", en: "Leave request created." },
    "staff-leave-approved": { vi: "Đã duyệt đơn nghỉ phép.", en: "Leave request approved." },
    "staff-leave-rejected": { vi: "Đã từ chối đơn nghỉ phép.", en: "Leave request rejected." },
  };

  return notice ? notices[notice]?.[language] ?? null : null;
}

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();
  return noticeText(notice, language);
}

const statusText: Record<Language, Record<string, string>> = {
  vi: {
    DRAFT: "Nháp", APPROVED: "Đã duyệt", PAID: "Đã chi trả", VOIDED: "Đã hủy",
    EARNED: "Đã phát sinh", OPEN: "Đang mở", CLOSED: "Đã đóng", NORMAL: "Bình thường",
    REQUESTED: "Chờ duyệt", REJECTED: "Từ chối", CANCELLED: "Đã hủy",
    OWNER: "Chủ hệ thống", AREA_MANAGER: "Quản lý khu vực", CLINIC_MANAGER: "Quản lý phòng khám",
    DENTIST: "Nha sĩ", HYGIENIST: "Điều dưỡng", FRONT_DESK: "Lễ tân", BILLING: "Thu ngân", PATIENT: "Bệnh nhân",
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

function vietnamDateKey(value: Date | string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(date);
}

function isDateKeyInRange(dateKey: string, range: { endKey: string; startKey: string }) {
  return Boolean(dateKey && dateKey >= range.startKey && dateKey <= range.endKey);
}

function dateKeyToNoonDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return !year || !month || !day ? new Date() : new Date(year, month - 1, day, 12);
}

function startOfCalendarMonth(dateKey: string) {
  const [year, month] = dateKey.split("-").map(Number);
  return !year || !month ? new Date() : new Date(year, month - 1, 1, 12);
}

function staffCalendarDayLabel(dateKey: string, language: Language) {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  const weekday = language === "vi" ? ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][weekdayIndex] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayIndex];
  return `${weekday} ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

function staffCalendarMonthTag(date: Date, language: Language) {
  const months = language === "vi"
    ? ["Thg 1", "Thg 2", "Thg 3", "Thg 4", "Thg 5", "Thg 6", "Thg 7", "Thg 8", "Thg 9", "Thg 10", "Thg 11", "Thg 12"]
    : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[date.getMonth()] ?? "";
}

function vietnamTodayDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function vietnamInputDateTime(value: string | null) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { date: "", time: "" };
  const dateKey = vietnamDateKey(date);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(date);
  return { date: dateKey, time };
}

function padCodeNumber(value: number, digits: number) {
  return String(Math.max(Math.trunc(value), 0)).padStart(digits, "0");
}

function formatServiceInstanceCode(serviceCode: string) {
  const normalized = serviceCode.trim();
  if (/^[A-Z]{2,5}-\d{2,}$/i.test(normalized)) return normalized.toUpperCase();
  const match = normalized.match(/([A-Z]{2,5}).*?(\d{1,4})$/i);
  if (match) return `${match[1].toUpperCase()}-${padCodeNumber(Number(match[2]), 2)}`;
  return normalized.toUpperCase();
}
export function StaffPayrollPanel({
  settingsWorkspace,
  staffPayrollWorkspace,
  visibleClinics,
}: {
  settingsWorkspace?: SettingsWorkspace | null;
  staffPayrollWorkspace?: StaffPayrollWorkspace | null;
  visibleClinics: Clinic[];
}) {
  const { language } = useAppLanguage();
  const searchParams = useSearchParams();
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const [activeStaffSection, setActiveStaffSection] = useState<
    "overview" | "time" | "leave" | "payroll"
  >("overview");
  const labels =
    language === "vi"
      ? {
          accruals: "Lương phát sinh theo dịch vụ",
          amount: "Số tiền",
          approve: "Duyệt",
          approvedAt: "Duyệt lúc",
          createRun: "Tạo bảng lương từ accrual",
          defaultRule: "Chính sách mặc định",
          draft: "Nháp",
          emptyAccruals: "Chưa có lương phát sinh từ tiến độ dịch vụ",
          emptyRuns: "Chưa có bảng lương",
          earned: "Đã phát sinh",
          generated: "Tạo lúc",
          heading: "Nhân sự, lịch làm việc và bảng lương",
          markPaid: "Đã chi trả",
          confirmApproveRun: "Bạn chắc chắn muốn duyệt bảng lương này? Sau khi duyệt, bảng lương sẽ sẵn sàng để đánh dấu chi trả.",
          confirmCreateRun: "Bạn chắc chắn muốn tạo bảng lương cho kỳ đã chọn? Hệ thống sẽ gom accrual đủ điều kiện và ghi audit log.",
          confirmMarkPaid: "Bạn chắc chắn muốn đánh dấu bảng lương này là đã chi trả? Thao tác sẽ khóa trạng thái chi trả và ghi audit log.",
          confirmVoidRun: "Bạn chắc chắn muốn hủy bảng lương này? Accrual chưa chi sẽ được mở lại để xử lý lại.",
          paidAt: "Chi trả",
          periodEnd: "Đến ngày",
          periodStart: "Từ ngày",
          payrollRuns: "Bảng lương",
          includeBaseSalary: "Tính lương cứng theo ngày công",
          standardWorkdays: "Công chuẩn",
          taxPercent: "% thuế",
          insurancePercent: "% BH/XH",
          otherDeduction: "Khấu trừ khác / nhân sự",
          payrollPolicy: "Preset chính sách lương",
          payrollPolicyScope: "Áp dụng cho",
          savePayrollPolicy: "Lưu preset lương",
          currentPayrollPolicy: "Preset đang dùng",
          exportPolicies: "Xuất preset CSV",
          importPolicies: "Import preset CSV",
          importPolicyPlaceholder:
            "Dán CSV có header: scope_key,clinic_name,policy_name,include_base_salary,standard_workdays,tax_percent,insurance_percent,other_deduction_vnd,active",
          roleOverrides: "Override theo vai trò",
          staffOverrides: "Override theo nhân sự",
          overridePlaceholder:
            '{"DENTIST":{"taxPercent":5,"insurancePercent":10.5,"otherDeductionAmount":0,"standardWorkdays":24}}',
          gross: "Tổng gross",
          deduction: "Khấu trừ",
          staff: "Nhân sự",
          totalAccrual: "Tổng accrual",
          tabOverview: "Tổng quan",
          tabTime: "Ca & chấm công",
          tabLeave: "Nghỉ phép",
          tabPayroll: "Bảng lương",
          void: "Hủy",
        }
      : {
          accruals: "Service compensation accruals",
          amount: "Amount",
          approve: "Approve",
          approvedAt: "Approved",
          createRun: "Create payroll from accruals",
          defaultRule: "Default policy",
          draft: "Draft",
          emptyAccruals: "No compensation accruals from service progress yet",
          emptyRuns: "No payroll runs yet",
          earned: "Earned",
          generated: "Generated",
          heading: "Staff, schedules, and payroll",
          markPaid: "Mark paid",
          confirmApproveRun: "Are you sure you want to approve this payroll run? Approved runs are ready to be marked paid.",
          confirmCreateRun: "Are you sure you want to create payroll for the selected period? Eligible accruals will be grouped and audited.",
          confirmMarkPaid: "Are you sure you want to mark this payroll run as paid? This will lock the paid state and write an audit log.",
          confirmVoidRun: "Are you sure you want to void this payroll run? Unpaid accruals will be released for reprocessing.",
          paidAt: "Paid",
          periodEnd: "End date",
          periodStart: "Start date",
          payrollRuns: "Payroll runs",
          includeBaseSalary: "Include prorated base salary",
          standardWorkdays: "Standard workdays",
          taxPercent: "Tax %",
          insurancePercent: "Insurance %",
          otherDeduction: "Other deduction / staff",
          payrollPolicy: "Payroll policy preset",
          payrollPolicyScope: "Applies to",
          savePayrollPolicy: "Save payroll preset",
          currentPayrollPolicy: "Active preset",
          exportPolicies: "Export preset CSV",
          importPolicies: "Import preset CSV",
          importPolicyPlaceholder:
            "Paste CSV with header: scope_key,clinic_name,policy_name,include_base_salary,standard_workdays,tax_percent,insurance_percent,other_deduction_vnd,active",
          roleOverrides: "Role overrides",
          staffOverrides: "Staff overrides",
          overridePlaceholder:
            '{"DENTIST":{"taxPercent":5,"insurancePercent":10.5,"otherDeductionAmount":0,"standardWorkdays":24}}',
          gross: "Gross",
          deduction: "Deduction",
          staff: "Staff",
          totalAccrual: "Total accrual",
          tabOverview: "Overview",
          tabTime: "Shifts & attendance",
          tabLeave: "Leave",
          tabPayroll: "Payroll",
          void: "Void",
        };
  const rawStaff = staffPayrollWorkspace?.staff ?? [];
  const rawAccruals = staffPayrollWorkspace?.accruals ?? [];
  const rawPayrollRuns = staffPayrollWorkspace?.payrollRuns ?? [];
  const rawPayrollPolicies = staffPayrollWorkspace?.payrollPolicies ?? [];
  const rawShifts = staffPayrollWorkspace?.shifts ?? [];
  const rawAttendanceLogs = staffPayrollWorkspace?.attendanceLogs ?? [];
  const rawLeaveRequests = staffPayrollWorkspace?.leaveRequests ?? [];
  const canMutate = staffPayrollWorkspace?.canMutate ?? false;
  const [staffClinicFilter, setStaffClinicFilter] = useState("all");
  const visibleStaffClinicIds = useMemo(
    () => new Set(visibleClinics.map((clinic) => clinic.id)),
    [visibleClinics],
  );
  const scopedStaff = rawStaff.filter(
    (member) => member.clinicId === null || visibleStaffClinicIds.has(member.clinicId),
  );
  const scopedStaffUserIds = new Set(scopedStaff.map((member) => member.userId));
  const scopedAccruals = rawAccruals.filter(
    (accrual) =>
      visibleStaffClinicIds.has(accrual.clinicId) ||
      accrual.lines.some((line) => scopedStaffUserIds.has(line.userId)),
  );
  const scopedPayrollRuns = rawPayrollRuns.filter(
    (run) => run.clinicId === null || visibleStaffClinicIds.has(run.clinicId),
  );
  const scopedShifts = rawShifts.filter((shift) => visibleStaffClinicIds.has(shift.clinicId));
  const scopedAttendanceLogs = rawAttendanceLogs.filter((log) =>
    visibleStaffClinicIds.has(log.clinicId),
  );
  const scopedLeaveRequests = rawLeaveRequests.filter(
    (request) => request.clinicId === null || visibleStaffClinicIds.has(request.clinicId),
  );
  const clinicMatchesFilter = (clinicId: string | null) =>
    staffClinicFilter === "all" || clinicId === null || clinicId === staffClinicFilter;
  const staff = scopedStaff.filter((member) => clinicMatchesFilter(member.clinicId));
  const accruals = scopedAccruals;
  const payrollRuns = scopedPayrollRuns.filter((run) => clinicMatchesFilter(run.clinicId));
  const payrollPolicies = rawPayrollPolicies.filter(
    (policy) => policy.clinicId === null || visibleStaffClinicIds.has(policy.clinicId),
  );
  const shifts = scopedShifts.filter((shift) => clinicMatchesFilter(shift.clinicId));
  const attendanceLogs = scopedAttendanceLogs.filter((log) => clinicMatchesFilter(log.clinicId));
  const leaveRequests = scopedLeaveRequests.filter((request) =>
    clinicMatchesFilter(request.clinicId),
  );
  const formClinics =
    staffClinicFilter === "all"
      ? visibleClinics
      : visibleClinics.filter((clinic) => clinic.id === staffClinicFilter);
  const selectedPayrollPolicy =
    payrollPolicies.find((policy) => policy.scopeKey === staffClinicFilter) ??
    payrollPolicies.find((policy) => policy.scopeKey === "all") ??
    null;
  const payrollPolicyDefaults = {
    includeBaseSalary: selectedPayrollPolicy?.includeBaseSalary ?? true,
    standardWorkdays: String(selectedPayrollPolicy?.standardWorkdays ?? 26),
    taxPercent: String(selectedPayrollPolicy?.taxPercent ?? 0),
    insurancePercent: String(selectedPayrollPolicy?.insurancePercent ?? 0),
    otherDeductionAmount: String(selectedPayrollPolicy?.otherDeductionAmount ?? 0),
    roleOverridesJson: selectedPayrollPolicy?.roleOverridesJson ?? "",
    staffOverridesJson: selectedPayrollPolicy?.staffOverridesJson ?? "",
  };
  const activeStaff = staff.filter((member) => member.active);
  const openAttendanceLogs = attendanceLogs.filter((log) => !log.clockOutAt);
  const earnedAccruals = accruals.filter((accrual) => accrual.status === "EARNED");
  const totalAccrual = earnedAccruals.reduce(
    (total, accrual) => total + accrual.totalAmount,
    0,
  );
  const today = vietnamTodayDate();
  const monthStart = `${today.slice(0, 8)}01`;
  const [selectedStaffCalendarDate, setSelectedStaffCalendarDate] = useState(today);
  const [staffDayModalDate, setStaffDayModalDate] = useState<string | null>(null);
  const [staffCalendarMonth, setStaffCalendarMonth] = useState(() =>
    startOfCalendarMonth(today),
  );
  const hrLabels =
    language === "vi"
      ? {
          absentToday: "Chưa chấm công",
          attendance: "Chấm công",
          attendanceAdjustments: "Điều chỉnh thời gian chấm công",
          calendar30: "Lịch nhân sự theo tháng",
          calendarHint: "Dùng nút tháng trước/tháng sau để xem tổng quan. Chọn một ngày để xem chi tiết đi làm, nghỉ và đơn chờ duyệt.",
          calendarLeaveShort: "Nghỉ",
          calendarPendingShort: "Chờ duyệt",
          calendarWorkShort: "Dự kiến",
          adjustAttendance: "Chỉnh công",
          approveLeave: "Duyệt",
          clockIn: "Vào ca",
          clockOut: "Ra ca",
          close: "Đóng",
          createShift: "Tạo ca làm",
          date: "Ngày",
          emptyAttendance: "Chưa có log chấm công",
          emptyLeave: "Chưa có đơn nghỉ phép",
          emptyShifts: "Chưa có ca làm",
          noPendingLeave: "Không có đơn nghỉ chờ duyệt",
          noSelectedDayLeave: "Không có nhân sự nghỉ",
          noSelectedDayPending: "Không có đơn chờ duyệt",
          noSelectedDayWork: "Không có nhân sự đi làm",
          onLeaveToday: "Nghỉ đã duyệt",
          pendingLeave: "Đơn nghỉ chờ duyệt",
          selectedDayDetails: "Chi tiết ngày đã chọn",
          selectedDayModalTitle: "Nhân sự trong ngày",
          presentToday: "Đã chấm công",
          endTime: "Giờ kết thúc",
          hrOperations: "Vận hành nhân sự",
          clinicFilter: "Lọc chi nhánh",
          hours: "Số giờ",
          leave: "Nghỉ phép",
          leaveType: "Loại nghỉ",
          leavePolicyNote: "Đơn nghỉ bắt đầu trước hôm nay sẽ tự từ chối nếu chưa duyệt. Đơn nghỉ trong ngày do quản lý tạo được ghi nhận là nghỉ khẩn cấp đã duyệt.",
          manualClockIn: "Chấm công thủ công",
          notes: "Ghi chú",
          openShift: "Đang mở",
          rejectLeave: "Từ chối",
          reason: "Lý do",
          roleOnShift: "Vai trò trong ca",
          scheduledToday: "Dự kiến hôm nay",
          scheduledWork: "Dự kiến làm",
          shift: "Ca làm",
          shiftManagement: "Xếp ca làm việc",
          staffMember: "Nhân viên",
          startTime: "Giờ bắt đầu",
          submitLeave: "Tạo đơn nghỉ",
          todayDashboard: "Dashboard nhân sự hôm nay",
          exportPayroll: "Xuất CSV",
          payrollRunWorkflow: "Tạo bảng lương",
          payrollPolicyWorkflow: "Thiết lập chính sách lương",
          payrollImportWorkflow: "Import / export preset lương",
          shiftWorkflow: "Tạo ca làm",
          clockWorkflow: "Chấm công thủ công",
          leaveWorkflow: "Tạo đơn nghỉ phép",
        }
      : {
          absentToday: "Not clocked in",
          attendance: "Attendance",
          attendanceAdjustments: "Attendance time adjustments",
          calendar30: "Monthly staff calendar",
          calendarHint: "Use previous/next month to review the overview. Select a day to see scheduled work, approved leave, and pending leave.",
          calendarLeaveShort: "Leave",
          calendarPendingShort: "Pending",
          calendarWorkShort: "Expected",
          adjustAttendance: "Adjust attendance",
          approveLeave: "Approve",
          clockIn: "Clock in",
          clockOut: "Clock out",
          close: "Close",
          createShift: "Create shift",
          date: "Date",
          emptyAttendance: "No attendance logs yet",
          emptyLeave: "No leave requests yet",
          emptyShifts: "No shifts yet",
          noPendingLeave: "No pending leave requests",
          noSelectedDayLeave: "No approved leave",
          noSelectedDayPending: "No pending requests",
          noSelectedDayWork: "No scheduled staff",
          onLeaveToday: "Approved leave",
          pendingLeave: "Pending leave requests",
          selectedDayDetails: "Selected day details",
          selectedDayModalTitle: "Staff on selected day",
          presentToday: "Clocked in today",
          endTime: "End time",
          hrOperations: "HR operations",
          clinicFilter: "Clinic filter",
          hours: "Hours",
          leave: "Leave",
          leaveType: "Leave type",
          leavePolicyNote: "Leave that starts before today is auto-rejected if still pending. Same-day manager-created leave is treated as an approved emergency override.",
          manualClockIn: "Manual clock-in",
          notes: "Notes",
          openShift: "Open",
          rejectLeave: "Reject",
          reason: "Reason",
          roleOnShift: "Role on shift",
          scheduledToday: "Expected today",
          scheduledWork: "Expected work",
          shift: "Shift",
          shiftManagement: "Shift planning",
          staffMember: "Staff member",
          startTime: "Start time",
          submitLeave: "Create leave request",
          todayDashboard: "Today's HR dashboard",
          exportPayroll: "Export CSV",
          payrollRunWorkflow: "Create payroll run",
          payrollPolicyWorkflow: "Configure payroll policy",
          payrollImportWorkflow: "Import / export payroll presets",
          shiftWorkflow: "Create shift",
          clockWorkflow: "Manual clock-in",
          leaveWorkflow: "Create leave request",
        };
  const leaveTypeLabels =
    language === "vi"
      ? {
          ANNUAL: "Nghỉ phép năm",
          SICK: "Nghỉ ốm",
          UNPAID: "Nghỉ không lương",
          TRAINING: "Đào tạo",
        }
      : {
          ANNUAL: "Annual leave",
          SICK: "Sick leave",
          UNPAID: "Unpaid leave",
          TRAINING: "Training",
        };
  const todayAttendanceRows = attendanceLogs.filter(
    (log) => vietnamDateKey(log.clockInAtIso) === today,
  );
  const presentStaffIds = new Set(todayAttendanceRows.map((log) => log.staffProfileId));
  const approvedLeaveToday = leaveRequests.filter((request) => {
    if (request.status !== "APPROVED") {
      return false;
    }

    return isDateKeyInRange(today, {
      startKey: vietnamDateKey(request.startsAtIso),
      endKey: vietnamDateKey(request.endsAtIso),
    });
  });
  const pendingLeaveToday = leaveRequests.filter((request) => {
    if (request.status !== "REQUESTED") {
      return false;
    }

    return isDateKeyInRange(today, {
      startKey: vietnamDateKey(request.startsAtIso),
      endKey: vietnamDateKey(request.endsAtIso),
    });
  });
  const onLeaveStaffIds = new Set(
    approvedLeaveToday
      .map((request) => request.staffProfileId)
      .filter((staffProfileId) => !presentStaffIds.has(staffProfileId)),
  );
  const pendingLeaveStaffIds = new Set(
    pendingLeaveToday
      .map((request) => request.staffProfileId)
      .filter(
        (staffProfileId) =>
          !presentStaffIds.has(staffProfileId) && !onLeaveStaffIds.has(staffProfileId),
      ),
  );
  const scheduledFutureShiftByStaff = new Map(
    shifts
      .filter((shift) => {
        if (shift.status === "CANCELLED" || vietnamDateKey(shift.startsAtIso) !== today) {
          return false;
        }

        return (
          new Date(shift.startsAtIso).getTime() > Date.now() &&
          !presentStaffIds.has(shift.staffProfileId) &&
          !onLeaveStaffIds.has(shift.staffProfileId) &&
          !pendingLeaveStaffIds.has(shift.staffProfileId)
        );
      })
      .sort((left, right) => left.startsAtIso.localeCompare(right.startsAtIso))
      .map((shift) => [shift.staffProfileId, shift]),
  );
  const scheduledFutureStaffIds = new Set(scheduledFutureShiftByStaff.keys());
  const todayTrackedStaffIds = new Set(activeStaff.map((member) => member.id));
  const absentStaffIds = Array.from(todayTrackedStaffIds).filter(
    (staffProfileId) =>
      !presentStaffIds.has(staffProfileId) &&
      !onLeaveStaffIds.has(staffProfileId) &&
      !pendingLeaveStaffIds.has(staffProfileId) &&
      !scheduledFutureStaffIds.has(staffProfileId),
  );
  const staffById = new Map(activeStaff.map((member) => [member.id, member]));
  const presentTodayStaff = Array.from(presentStaffIds)
    .map((staffProfileId) => staffById.get(staffProfileId))
    .filter((member): member is (typeof activeStaff)[number] => Boolean(member));
  const onLeaveTodayStaff = Array.from(onLeaveStaffIds)
    .map((staffProfileId) => staffById.get(staffProfileId))
    .filter((member): member is (typeof activeStaff)[number] => Boolean(member));
  const pendingLeaveTodayStaff = Array.from(pendingLeaveStaffIds)
    .map((staffProfileId) => staffById.get(staffProfileId))
    .filter((member): member is (typeof activeStaff)[number] => Boolean(member));
  const absentTodayStaff = absentStaffIds
    .map((staffProfileId) => staffById.get(staffProfileId))
    .filter((member): member is (typeof activeStaff)[number] => Boolean(member));
  const pendingLeaveRequests = leaveRequests
    .filter((request) => request.status === "REQUESTED")
    .sort((left, right) => left.startsAtIso.localeCompare(right.startsAtIso));
  const leaveRequestMatchesDate = (
    request: (typeof leaveRequests)[number],
    dateKey: string,
  ) =>
    isDateKeyInRange(dateKey, {
      startKey: vietnamDateKey(request.startsAtIso),
      endKey: vietnamDateKey(request.endsAtIso),
    });
  const leaveRequestsForDate = (
    dateKey: string,
    status: (typeof leaveRequests)[number]["status"],
  ) =>
    leaveRequests
      .filter((request) => request.status === status && leaveRequestMatchesDate(request, dateKey))
      .sort((left, right) => left.staffName.localeCompare(right.staffName));
  const staffListItemFromMember = (member: (typeof activeStaff)[number]) => ({
    clinicName: member.clinicName,
    employeeCode: member.employeeCode,
    fullName: member.fullName,
    id: member.id,
  });
  const scheduledFutureTodayStaff = Array.from(scheduledFutureShiftByStaff.entries())
    .map(([staffProfileId, shift]) => {
      const member = staffById.get(staffProfileId);

      if (!member) {
        return null;
      }

      return {
        ...staffListItemFromMember(member),
        employeeCode: shift.roleOnShift
          ? `${shift.roleOnShift} · ${shift.startsAt} - ${shift.endsAt}`
          : `${shift.startsAt} - ${shift.endsAt}`,
      };
    })
    .filter((member): member is ReturnType<typeof staffListItemFromMember> => Boolean(member));
  const getExpectedWorkingStaffForDate = (
    dateKey: string,
    approvedLeave: Array<(typeof leaveRequests)[number]>,
    pendingLeave: Array<(typeof leaveRequests)[number]>,
  ) => {
    const blockedStaffIds = new Set([
      ...approvedLeave.map((request) => request.staffProfileId),
      ...pendingLeave.map((request) => request.staffProfileId),
    ]);
    const shiftByStaff = new Map(
      shifts
        .filter(
          (shift) =>
            shift.status !== "CANCELLED" &&
            vietnamDateKey(shift.startsAtIso) === dateKey,
        )
        .sort((left, right) => left.startsAtIso.localeCompare(right.startsAtIso))
        .map((shift) => [shift.staffProfileId, shift]),
    );

    return activeStaff
      .filter((member) => !blockedStaffIds.has(member.id))
      .map((member) => {
        const shift = shiftByStaff.get(member.id);

        return {
          clinicName: shift?.clinicName ?? member.clinicName,
          employeeCode: shift
            ? shift.roleOnShift
              ? `${shift.roleOnShift} · ${shift.startsAt} - ${shift.endsAt}`
              : `${shift.startsAt} - ${shift.endsAt}`
            : member.employeeCode,
          fullName: member.fullName,
          id: member.id,
        };
      })
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  };
  const getStaffCalendarDay = (dateKey: string) => {
    const approvedLeave = leaveRequestsForDate(dateKey, "APPROVED");
    const pendingLeave = leaveRequestsForDate(dateKey, "REQUESTED");

    return {
      approvedLeave,
      dateKey,
      pendingLeave,
      working: getExpectedWorkingStaffForDate(dateKey, approvedLeave, pendingLeave),
    };
  };
  const selectedStaffDay = getStaffCalendarDay(selectedStaffCalendarDate);
  const todayStaffDay = getStaffCalendarDay(today);
  const staffDayModalDay = staffDayModalDate
    ? getStaffCalendarDay(staffDayModalDate)
    : null;
  const staffCalendarSelectedDate = dateKeyToNoonDate(selectedStaffDay.dateKey);
  const StaffCalendarDayButton = (props: DayButtonProps) => {
    const dateKey = vietnamDateKey(props.day.date);
    const daySummary = getStaffCalendarDay(dateKey);
    const isMonthStart = props.day.date.getDate() === 1;
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      if (props.disabled) {
        return;
      }

      setSelectedStaffCalendarDate(dateKey);
      setStaffDayModalDate(dateKey);
      props.onClick?.(event);
    };

    return (
      <button
        {...props}
        className={`${props.className ?? ""} staff-day-picker-button${
          isMonthStart ? " month-start" : ""
        }`}
        type="button"
        disabled={props.disabled}
        onClick={handleClick}
      >
        <span className="staff-day-picker-topline">
          <span className="staff-day-picker-date">{props.day.date.getDate()}</span>
          {isMonthStart ? (
            <span className="staff-month-start-badge">
              {staffCalendarMonthTag(props.day.date, language)}
            </span>
          ) : null}
        </span>
        <span className="staff-day-picker-stats" aria-hidden="true">
          <span className="work">
            <span>{daySummary.working.length}</span>
            {hrLabels.calendarWorkShort}
          </span>
          <span className="leave">
            <span>{daySummary.approvedLeave.length}</span>
            {hrLabels.calendarLeaveShort}
          </span>
          <span className="pending">
            <span>{daySummary.pendingLeave.length}</span>
            {hrLabels.calendarPendingShort}
          </span>
        </span>
      </button>
    );
  };

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">{hrLabels.hrOperations}</p>
          <h2>{labels.heading}</h2>
        </div>
        <SourceBadge source={staffPayrollWorkspace?.source} />
      </div>

      {(staffPayrollWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(staffPayrollWorkspace?.message, language)}
        </div>
      )}

      <div className="staff-filter-bar">
        <label>
          {hrLabels.clinicFilter}
          <select
            value={staffClinicFilter}
            onChange={(event) => setStaffClinicFilter(event.target.value)}
          >
            <option value="all">{uiText[language].allClinics}</option>
            {visibleClinics.map((clinic) => (
              <option value={clinic.id} key={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="segmented staff-section-tabs" role="tablist" aria-label={labels.heading}>
        {[
          { key: "overview", label: labels.tabOverview },
          { key: "time", label: labels.tabTime },
          { key: "leave", label: labels.tabLeave },
          { key: "payroll", label: labels.tabPayroll },
        ].map((section) => (
          <button
            aria-selected={activeStaffSection === section.key}
            className={activeStaffSection === section.key ? "active" : ""}
            key={section.key}
            onClick={() =>
              setActiveStaffSection(
                section.key as "overview" | "time" | "leave" | "payroll",
              )
            }
            role="tab"
            type="button"
          >
            {section.label}
          </button>
        ))}
      </div>

      {activeStaffSection === "overview" ? (
        <>
      <section className="panel staff-calendar-panel">
        <PanelHeader
          icon={CalendarDays}
          title={hrLabels.calendar30}
          action={staffCalendarDayLabel(selectedStaffDay?.dateKey ?? today, language)}
        />
        <p className="staff-calendar-hint">{hrLabels.calendarHint}</p>
        <DayPicker
          className="staff-day-picker"
          components={{ DayButton: StaffCalendarDayButton }}
          fixedWeeks
          locale={language === "vi" ? vi : enUS}
          mode="single"
          month={staffCalendarMonth}
          onMonthChange={setStaffCalendarMonth}
          onSelect={(date) => {
            if (!date) {
              return;
            }

            const dateKey = vietnamDateKey(date);

            setSelectedStaffCalendarDate(dateKey);
            setStaffDayModalDate(dateKey);
          }}
          selected={staffCalendarSelectedDate}
          showOutsideDays
          weekStartsOn={1}
        />
      </section>

      {staffDayModalDay ? (
        <div
          className="progress-modal-backdrop"
          role="presentation"
          onMouseDown={() => setStaffDayModalDate(null)}
        >
          <div
            className="progress-modal staff-day-modal"
            role="dialog"
            aria-modal="true"
            aria-label={hrLabels.selectedDayModalTitle}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="progress-modal-header">
              <div>
                <span>{hrLabels.selectedDayModalTitle}</span>
                <h3>{staffCalendarDayLabel(staffDayModalDay.dateKey, language)}</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setStaffDayModalDate(null)}
                aria-label={hrLabels.close}
              >
                <X size={18} />
              </button>
            </div>
            <div className="staff-day-modal-grid">
              <StaffTodayList
                title={`${hrLabels.scheduledWork} (${staffDayModalDay.working.length})`}
                items={staffDayModalDay.working}
                emptyLabel={hrLabels.noSelectedDayWork}
                limit={null}
                tone="present"
              />
              <StaffTodayList
                title={`${hrLabels.leave} (${staffDayModalDay.approvedLeave.length})`}
                items={staffDayModalDay.approvedLeave.map((request) => ({
                  id: request.id,
                  employeeCode:
                    leaveTypeLabels[request.leaveType as keyof typeof leaveTypeLabels] ??
                    request.leaveType,
                  fullName: request.staffName,
                  clinicName: `${request.startsAt} - ${request.endsAt}`,
                }))}
                emptyLabel={hrLabels.noSelectedDayLeave}
                limit={null}
                tone="leave"
              />
              <StaffTodayList
                title={`${hrLabels.pendingLeave} (${staffDayModalDay.pendingLeave.length})`}
                items={staffDayModalDay.pendingLeave.map((request) => ({
                  id: request.id,
                  employeeCode:
                    leaveTypeLabels[request.leaveType as keyof typeof leaveTypeLabels] ??
                    request.leaveType,
                  fullName: request.staffName,
                  clinicName: `${request.startsAt} - ${request.endsAt}`,
                }))}
                emptyLabel={hrLabels.noSelectedDayPending}
                limit={null}
                tone="pending"
              />
            </div>
          </div>
        </div>
      ) : null}

      <section className="panel">
        <PanelHeader icon={Activity} title={hrLabels.todayDashboard} action={today} />
        <div className="metric-grid staff-ops-metric-grid">
          <MetricCard
            label={hrLabels.scheduledToday}
            value={String(scheduledFutureTodayStaff.length)}
            tone="blue"
          />
          <MetricCard
            label={hrLabels.presentToday}
            value={String(presentTodayStaff.length)}
            tone="green"
          />
          <MetricCard
            label={hrLabels.onLeaveToday}
            value={String(onLeaveTodayStaff.length)}
            tone="amber"
          />
          <MetricCard
            label={hrLabels.pendingLeave}
            value={String(pendingLeaveTodayStaff.length)}
            tone="violet"
          />
          <MetricCard
            label={hrLabels.absentToday}
            value={String(absentTodayStaff.length)}
            tone="rose"
          />
        </div>
        <div className="staff-roster-grid">
          <StaffTodayList
            title={hrLabels.presentToday}
            items={presentTodayStaff}
            emptyLabel="-"
            tone="present"
          />
          <StaffTodayList
            title={hrLabels.scheduledToday}
            items={scheduledFutureTodayStaff}
            emptyLabel="-"
            tone="future"
          />
          <StaffTodayList
            title={hrLabels.onLeaveToday}
            items={onLeaveTodayStaff}
            emptyLabel="-"
            tone="leave"
          />
          <StaffTodayList
            title={hrLabels.pendingLeave}
            items={pendingLeaveTodayStaff}
            emptyLabel="-"
            tone="pending"
          />
          <StaffTodayList
            title={hrLabels.absentToday}
            items={absentTodayStaff}
            emptyLabel="-"
            tone="absent"
          />
        </div>
      </section>
        </>
      ) : null}

      {activeStaffSection === "leave" ? (
      <section className="panel">
        <PanelHeader
          icon={FileText}
          title={hrLabels.pendingLeave}
          action={`${pendingLeaveRequests.length}`}
        />
        <div className="settings-archive-note">{hrLabels.leavePolicyNote}</div>
        <div className="invoice-list">
          {pendingLeaveRequests.length > 0 ? (
            pendingLeaveRequests.slice(0, 8).map((request) => (
              <div className="invoice-row staff-pending-leave-row" key={request.id}>
                <div>
                  <strong>
                    {request.staffName} ·{" "}
                    {leaveTypeLabels[request.leaveType as keyof typeof leaveTypeLabels] ??
                      request.leaveType}
                  </strong>
                  <span>
                    {request.startsAt} - {request.endsAt} · {request.hours ?? 0}h
                  </span>
                  <small>
                    {request.clinicName ?? uiText[language].allClinics} ·{" "}
                    {request.reason ?? "-"}
                  </small>
                </div>
                <div className="invoice-actions">
                  <form action={updateLeaveRequestStatusAction}>
                    <input name="leaveRequestId" type="hidden" value={request.id} />
                    <input name="status" type="hidden" value="APPROVED" />
                    <button type="submit" disabled={!canMutate}>
                      {hrLabels.approveLeave}
                    </button>
                  </form>
                  <form action={updateLeaveRequestStatusAction}>
                    <input name="leaveRequestId" type="hidden" value={request.id} />
                    <input name="status" type="hidden" value="REJECTED" />
                    <button type="submit" disabled={!canMutate}>
                      {hrLabels.rejectLeave}
                    </button>
                  </form>
                </div>
              </div>
            ))
          ) : (
            <EmptyState label={hrLabels.noPendingLeave} />
          )}
        </div>
      </section>
      ) : null}

      {activeStaffSection === "payroll" ? (
        <>
      <div className="metric-grid">
        <MetricCard label={labels.staff} value={String(activeStaff.length)} tone="blue" />
        <MetricCard label={labels.earned} value={String(earnedAccruals.length)} tone="teal" />
        <MetricCard
          label={labels.totalAccrual}
          value={formatVnd(totalAccrual)}
          tone="green"
        />
        <MetricCard label={labels.payrollRuns} value={String(payrollRuns.length)} tone="violet" />
      </div>
        </>
      ) : null}

      {activeStaffSection === "overview" || activeStaffSection === "payroll" ? (
      <section className="content-grid service-management-grid">
        {activeStaffSection === "overview" ? (
        <section className="panel">
          <PanelHeader icon={Building2} title={labels.staff} action={`${activeStaff.length}`} />
          <div className="staff-list compact">
            {activeStaff.length > 0 ? (
              activeStaff.map((member) => (
                <article className="staff-row" key={member.id}>
                  <div>
                    <strong>{member.fullName}</strong>
                    <span>
                      {member.employeeCode} · {uiText[language].roles[member.role]}
                    </span>
                    <small>{member.clinicName ?? settingsWorkspace?.clinics[0]?.name ?? "-"}</small>
                  </div>
                  <StatusPill status="Active" />
                </article>
              ))
            ) : (
              <EmptyState label={language === "vi" ? "Không có nhân sự đang hoạt động" : "No active staff"} />
            )}
          </div>
        </section>
        ) : null}

        {activeStaffSection === "payroll" ? (
        <section className="panel">
          <PanelHeader icon={WalletCards} title={labels.createRun} action={labels.draft} />
          <details className="staff-workflow-details">
            <summary>{hrLabels.payrollPolicyWorkflow}</summary>
          <form action={updatePayrollPolicyAction} className="staff-form" key={`policy-${staffClinicFilter}`}>
            <input name="clinicId" type="hidden" value={staffClinicFilter} />
            <div className="settings-archive-note">
              {labels.currentPayrollPolicy}:{" "}
              {selectedPayrollPolicy?.name ?? labels.defaultRule}
            </div>
            <label className="form-check-row">
              <input
                name="includeBaseSalary"
                type="checkbox"
                defaultChecked={payrollPolicyDefaults.includeBaseSalary}
                disabled={!canMutate}
              />
              {labels.includeBaseSalary}
            </label>
            <label>
              {labels.standardWorkdays}
              <input
                name="standardWorkdays"
                inputMode="numeric"
                defaultValue={payrollPolicyDefaults.standardWorkdays}
                disabled={!canMutate}
              />
            </label>
            <label>
              {labels.taxPercent}
              <input
                name="taxPercent"
                inputMode="decimal"
                defaultValue={payrollPolicyDefaults.taxPercent}
                disabled={!canMutate}
              />
            </label>
            <label>
              {labels.insurancePercent}
              <input
                name="insurancePercent"
                inputMode="decimal"
                defaultValue={payrollPolicyDefaults.insurancePercent}
                disabled={!canMutate}
              />
            </label>
            <label>
              {labels.otherDeduction}
              <MoneyInput
                name="otherDeductionAmount"
                defaultValue={payrollPolicyDefaults.otherDeductionAmount}
                disabled={!canMutate}
              />
            </label>
            <label>
              {labels.roleOverrides}
              <textarea
                name="roleOverridesJson"
                defaultValue={payrollPolicyDefaults.roleOverridesJson}
                placeholder={labels.overridePlaceholder}
                rows={3}
                disabled={!canMutate}
              />
            </label>
            <label>
              {labels.staffOverrides}
              <textarea
                name="staffOverridesJson"
                defaultValue={payrollPolicyDefaults.staffOverridesJson}
                placeholder='{"NV000001":{"otherDeductionAmount":200000}}'
                rows={3}
                disabled={!canMutate}
              />
            </label>
            <button type="submit" disabled={!canMutate}>
              {labels.savePayrollPolicy}
            </button>
          </form>
          </details>
          <details className="staff-workflow-details">
            <summary>{hrLabels.payrollImportWorkflow}</summary>
          <div className="service-action-row">
            <Link className="secondary-button" href="/staff/payroll-policy-export">
              {labels.exportPolicies}
            </Link>
          </div>
          <form action={importPayrollPoliciesAction} className="staff-form">
            <label>
              {labels.importPolicies}
              <textarea
                name="csvText"
                placeholder={labels.importPolicyPlaceholder}
                rows={4}
                disabled={!canMutate}
              />
            </label>
            <button type="submit" disabled={!canMutate}>
              {labels.importPolicies}
            </button>
          </form>
          </details>
          <details className="staff-workflow-details">
            <summary>{hrLabels.payrollRunWorkflow}</summary>
          <form
            action={createPayrollRunFromAccrualsAction}
            className="staff-form"
            key={`run-${staffClinicFilter}`}
            onSubmit={(event) => {
              if (!window.confirm(labels.confirmCreateRun)) {
                event.preventDefault();
              }
            }}
          >
            <label>
              {labels.periodStart}
              <input
                name="periodStart"
                type="date"
                defaultValue={monthStart}
                disabled={!canMutate}
                required
              />
            </label>
            <label>
              {labels.periodEnd}
              <input
                name="periodEnd"
                type="date"
                defaultValue={today}
                disabled={!canMutate}
                required
              />
            </label>
            <label>
              {uiText[language].clinicScope}
              <select name="clinicId" disabled={!canMutate}>
                <option value="all">{uiText[language].allClinics}</option>
                {formClinics.map((clinic) => (
                  <option value={clinic.id} key={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-check-row">
              <input
                name="includeBaseSalary"
                type="checkbox"
                defaultChecked={payrollPolicyDefaults.includeBaseSalary}
                disabled={!canMutate}
              />
              {labels.includeBaseSalary}
            </label>
            <label>
              {labels.standardWorkdays}
              <input
                name="standardWorkdays"
                inputMode="numeric"
                defaultValue={payrollPolicyDefaults.standardWorkdays}
                disabled={!canMutate}
              />
            </label>
            <label>
              {labels.taxPercent}
              <input
                name="taxPercent"
                inputMode="decimal"
                defaultValue={payrollPolicyDefaults.taxPercent}
                disabled={!canMutate}
              />
            </label>
            <label>
              {labels.insurancePercent}
              <input
                name="insurancePercent"
                inputMode="decimal"
                defaultValue={payrollPolicyDefaults.insurancePercent}
                disabled={!canMutate}
              />
            </label>
            <label>
              {labels.otherDeduction}
              <MoneyInput
                name="otherDeductionAmount"
                defaultValue={payrollPolicyDefaults.otherDeductionAmount}
                disabled={!canMutate}
              />
            </label>
            <button className="primary-button" type="submit" disabled={!canMutate}>
              <WalletCards size={16} />
              {labels.createRun}
            </button>
          </form>
          </details>
        </section>
        ) : null}
      </section>
      ) : null}

      {activeStaffSection === "time" || activeStaffSection === "leave" ? (
        <>
      <section className="content-grid service-management-grid">
        {activeStaffSection === "time" ? (
          <>
        <section className="panel">
          <PanelHeader icon={CalendarDays} title={hrLabels.shiftManagement} action={hrLabels.shift} />
          <details className="staff-workflow-details">
            <summary>{hrLabels.shiftWorkflow}</summary>
          <form action={createStaffShiftAction} className="staff-form">
            <label>
              {hrLabels.staffMember}
              <select name="staffProfileId" disabled={!canMutate || activeStaff.length === 0} required>
                {activeStaff.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.employeeCode} - {member.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {uiText[language].clinicScope}
              <select name="clinicId" disabled={!canMutate} required>
                {formClinics.map((clinic) => (
                  <option value={clinic.id} key={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {hrLabels.date}
              <input name="date" type="date" defaultValue={today} disabled={!canMutate} required />
            </label>
            <label>
              {hrLabels.startTime}
              <input name="startTime" type="time" defaultValue="08:00" disabled={!canMutate} required />
            </label>
            <label>
              {hrLabels.endTime}
              <input name="endTime" type="time" defaultValue="17:00" disabled={!canMutate} required />
            </label>
            <label>
              {hrLabels.roleOnShift}
              <input name="roleOnShift" disabled={!canMutate} />
            </label>
            <label className="clinical-wide">
              {hrLabels.notes}
              <textarea name="notes" disabled={!canMutate} />
            </label>
            <button
              className="primary-button"
              type="submit"
              disabled={!canMutate || activeStaff.length === 0 || formClinics.length === 0}
            >
              <CalendarDays size={16} />
              {hrLabels.createShift}
            </button>
          </form>
          </details>
        </section>
          </>
        ) : null}

        {activeStaffSection === "time" ? (
        <section className="panel">
          <PanelHeader icon={Activity} title={hrLabels.manualClockIn} action={`${openAttendanceLogs.length}`} />
          <details className="staff-workflow-details">
            <summary>{hrLabels.clockWorkflow}</summary>
          <form action={clockInStaffAction} className="staff-form">
            <label>
              {hrLabels.staffMember}
              <select name="staffProfileId" disabled={!canMutate || activeStaff.length === 0} required>
                {activeStaff.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.employeeCode} - {member.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {uiText[language].clinicScope}
              <select name="clinicId" disabled={!canMutate} required>
                {formClinics.map((clinic) => (
                  <option value={clinic.id} key={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="clinical-wide">
              {hrLabels.notes}
              <textarea name="note" disabled={!canMutate} />
            </label>
            <button
              className="primary-button"
              type="submit"
              disabled={!canMutate || activeStaff.length === 0 || formClinics.length === 0}
            >
              <Activity size={16} />
              {hrLabels.clockIn}
            </button>
          </form>
          </details>
        </section>
        ) : null}

        {activeStaffSection === "leave" ? (
        <section className="panel">
          <PanelHeader icon={FileText} title={hrLabels.leave} action={`${leaveRequests.length}`} />
          <details className="staff-workflow-details">
            <summary>{hrLabels.leaveWorkflow}</summary>
          <form action={createLeaveRequestAction} className="staff-form">
            <label>
              {hrLabels.staffMember}
              <select name="staffProfileId" disabled={!canMutate || activeStaff.length === 0} required>
                {activeStaff.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.employeeCode} - {member.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {hrLabels.leaveType}
              <select name="leaveType" disabled={!canMutate} defaultValue="ANNUAL">
                {Object.entries(leaveTypeLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.periodStart}
              <input name="startsAt" type="date" defaultValue={today} disabled={!canMutate} required />
            </label>
            <label>
              {labels.periodEnd}
              <input name="endsAt" type="date" defaultValue={today} disabled={!canMutate} required />
            </label>
            <label>
              {hrLabels.hours}
              <input name="hours" inputMode="decimal" disabled={!canMutate} />
            </label>
            <label className="clinical-wide">
              {hrLabels.reason}
              <textarea name="reason" disabled={!canMutate} />
            </label>
            <button className="primary-button" type="submit" disabled={!canMutate || activeStaff.length === 0}>
              <FileText size={16} />
              {hrLabels.submitLeave}
            </button>
          </form>
          </details>
        </section>
        ) : null}
      </section>

      <section className="content-grid service-management-grid">
        {activeStaffSection === "time" ? (
          <>
        <section className="panel">
          <PanelHeader icon={CalendarDays} title={hrLabels.shift} action={`${shifts.length}`} />
          <div className="record-grid">
            {shifts.length > 0 ? (
              shifts.slice(0, 12).map((shift) => (
                <RecordTile
                  key={shift.id}
                  title={`${shift.staffName} · ${shift.roleOnShift ?? hrLabels.shift}`}
                  value={`${shift.startsAt} - ${shift.endsAt} · ${shift.clinicName}`}
                />
              ))
            ) : (
              <EmptyState label={hrLabels.emptyShifts} />
            )}
          </div>
        </section>
          </>
        ) : null}

        {activeStaffSection === "time" ? (
        <section className="panel">
          <PanelHeader icon={Activity} title={hrLabels.attendanceAdjustments} action={`${attendanceLogs.length}`} />
          <div className="invoice-list">
            {attendanceLogs.length > 0 ? (
              attendanceLogs.slice(0, 12).map((log) => {
                const clockIn = vietnamInputDateTime(log.clockInAtIso);
                const clockOut = vietnamInputDateTime(log.clockOutAtIso);

                return (
                  <div className="invoice-row billing-invoice-row staff-attendance-row" key={log.id}>
                    <div>
                      <strong>{log.staffName}</strong>
                      <span>
                        {log.clinicName} · {log.clockInAt}
                        {log.clockOutAt ? ` - ${log.clockOutAt}` : ` · ${hrLabels.openShift}`}
                      </span>
                      {log.note && <small>{log.note}</small>}
                    </div>
                    <StatusPill status={log.clockOutAt ? log.outStatus ?? "CLOSED" : "OPEN"} />
                    <div className="invoice-actions">
                      {!log.clockOutAt && (
                        <form action={clockOutStaffAction}>
                          <input name="attendanceLogId" type="hidden" value={log.id} />
                          <input name="outStatus" type="hidden" value="NORMAL" />
                          <button type="submit" disabled={!canMutate}>
                            {hrLabels.clockOut}
                          </button>
                        </form>
                      )}
                    </div>
                    <form
                      action={adjustAttendanceLogAction}
                      className="service-step-form staff-attendance-adjust-form"
                    >
                      <input name="attendanceLogId" type="hidden" value={log.id} />
                      <input name="clockInDate" type="date" defaultValue={clockIn.date} disabled={!canMutate} />
                      <input name="clockInTime" type="time" defaultValue={clockIn.time} disabled={!canMutate} />
                      <input name="clockOutDate" type="date" defaultValue={clockOut.date} disabled={!canMutate} />
                      <input name="clockOutTime" type="time" defaultValue={clockOut.time} disabled={!canMutate} />
                      <input name="outStatus" defaultValue={log.outStatus ?? "NORMAL"} disabled={!canMutate} />
                      <button type="submit" disabled={!canMutate}>
                        {hrLabels.adjustAttendance}
                      </button>
                    </form>
                  </div>
                );
              })
            ) : (
              <EmptyState label={hrLabels.emptyAttendance} />
            )}
          </div>
        </section>
        ) : null}

        {activeStaffSection === "leave" ? (
        <section className="panel">
          <PanelHeader icon={FileText} title={hrLabels.leave} action={`${leaveRequests.length}`} />
          <div className="invoice-list">
            {leaveRequests.length > 0 ? (
              leaveRequests.slice(0, 12).map((request) => (
                <div className="invoice-row billing-invoice-row" key={request.id}>
                  <div>
                    <strong>
                      {request.staffName} ·{" "}
                      {leaveTypeLabels[request.leaveType as keyof typeof leaveTypeLabels] ??
                        request.leaveType}
                    </strong>
                    <span>
                      {request.startsAt} - {request.endsAt} · {request.hours ?? 0}h
                    </span>
                    <small>{request.reason ?? "-"}</small>
                  </div>
                  <StatusPill status={request.status} />
                  {request.status === "REQUESTED" && (
                    <div className="invoice-actions">
                      <form action={updateLeaveRequestStatusAction}>
                        <input name="leaveRequestId" type="hidden" value={request.id} />
                        <input name="status" type="hidden" value="APPROVED" />
                        <button type="submit" disabled={!canMutate}>
                          {hrLabels.approveLeave}
                        </button>
                      </form>
                      <form action={updateLeaveRequestStatusAction}>
                        <input name="leaveRequestId" type="hidden" value={request.id} />
                        <input name="status" type="hidden" value="REJECTED" />
                        <button type="submit" disabled={!canMutate}>
                          {hrLabels.rejectLeave}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <EmptyState label={hrLabels.emptyLeave} />
            )}
          </div>
        </section>
        ) : null}
      </section>
        </>
      ) : null}

      {activeStaffSection === "payroll" ? (
        <>
      <section className="panel">
        <PanelHeader icon={WalletCards} title={labels.accruals} action={`${accruals.length}`} />
        <div className="payroll-accrual-list">
          {accruals.length > 0 ? (
            accruals.map((accrual) => (
              <article className="payroll-accrual-card" key={accrual.id}>
                <div>
                  <span className="code-chip">{formatServiceInstanceCode(accrual.serviceCode)}</span>
                  <strong>
                    {accrual.patientName} · {accrual.serviceName}
                  </strong>
                  <small>
                    {accrual.earnedProgressPercent}% · {accrual.ruleName ?? labels.defaultRule} ·{" "}
                    {accrual.createdAt}
                  </small>
                </div>
                <StatusPill status={accrual.status} />
                <strong>{formatVnd(accrual.totalAmount)}</strong>
                <div className="payroll-line-list">
                  {accrual.lines.map((line) => (
                    <span key={line.id}>
                      {line.userName} · {displayStatus(line.role, language)} ·{" "}
                      {formatVnd(line.amount)}
                    </span>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <EmptyState label={labels.emptyAccruals} />
          )}
        </div>
      </section>

      <section className="panel">
        <PanelHeader icon={FileText} title={labels.payrollRuns} action={`${payrollRuns.length}`} />
        <div className="invoice-list">
          {payrollRuns.length > 0 ? (
            payrollRuns.map((run) => (
              <div className="invoice-row billing-invoice-row" key={run.id}>
                <div>
                  <strong>{run.periodStart} - {run.periodEnd}</strong>
                  <span>
                    {formatVnd(run.netAmount)} · {run.lineCount} lines ·{" "}
                    {run.clinicName ?? uiText[language].allClinics}
                  </span>
                  <small>
                    {labels.gross}: {formatVnd(run.grossAmount)} · {labels.deduction}:{" "}
                    {formatVnd(run.deductionAmount)}
                  </small>
                  <small>
                    {labels.generated} {run.generatedAt}
                    {run.approvedAt ? ` · ${labels.approvedAt} ${run.approvedAt}` : ""}
                    {run.paidAt ? ` · ${labels.paidAt} ${run.paidAt}` : ""}
                  </small>
                </div>
                <StatusPill status={run.status} />
                <div className="invoice-actions">
                  <Link href={`/staff/payroll-export?runId=${encodeURIComponent(run.id)}`}>
                    {hrLabels.exportPayroll}
                  </Link>
                  {run.status === "DRAFT" && (
                    <form
                      action={approvePayrollRunAction}
                      onSubmit={(event) => {
                        if (!window.confirm(labels.confirmApproveRun)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input name="payrollRunId" type="hidden" value={run.id} />
                      <button type="submit" disabled={!canMutate}>
                        {labels.approve}
                      </button>
                    </form>
                  )}
                  {run.status === "APPROVED" && (
                    <form
                      action={markPayrollRunPaidAction}
                      onSubmit={(event) => {
                        if (!window.confirm(labels.confirmMarkPaid)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input name="payrollRunId" type="hidden" value={run.id} />
                      <button type="submit" disabled={!canMutate}>
                        {labels.markPaid}
                      </button>
                    </form>
                  )}
                  {(run.status === "DRAFT" || run.status === "APPROVED") && (
                    <form
                      action={voidPayrollRunAction}
                      onSubmit={(event) => {
                        if (!window.confirm(labels.confirmVoidRun)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input name="payrollRunId" type="hidden" value={run.id} />
                      <button type="submit" disabled={!canMutate}>
                        {labels.void}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))
          ) : (
            <EmptyState label={labels.emptyRuns} />
          )}
        </div>
      </section>
        </>
      ) : null}
    </section>
  );
}

function StaffTodayList({
  emptyLabel,
  limit = 5,
  items,
  title,
  tone,
}: {
  emptyLabel: string;
  limit?: number | null;
  items: Array<{
    id: string;
    employeeCode: string;
    fullName: string;
    clinicName: string | null;
  }>;
  title: string;
  tone: "absent" | "future" | "leave" | "pending" | "present";
}) {
  const visibleItems = limit == null ? items : items.slice(0, limit);

  return (
    <div className="staff-today-list">
      <strong>{title}</strong>
      {items.length > 0 ? (
        <div>
          {visibleItems.map((item) => (
            <span className={`staff-today-pill ${tone}`} key={item.id}>
              <span aria-hidden="true" />
              <span>
                {item.fullName}
                <small>
                  {item.employeeCode}
                  {item.clinicName ? ` · ${item.clinicName}` : ""}
                </small>
              </span>
            </span>
          ))}
          {limit != null && items.length > limit ? <small>+{items.length - limit}</small> : null}
        </div>
      ) : (
        <small>{emptyLabel}</small>
      )}
    </div>
  );
}

