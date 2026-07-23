"use client";

import { Activity, CalendarDays, FileText, Smartphone, WalletCards, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  clockInCurrentStaffAction,
  clockOutCurrentStaffAction,
  createCurrentStaffLeaveRequestAction,
} from "@/app/(app)/employee-app/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import {
  EmptyState,
  MetricCard,
  PanelHeader,
  StatusPill as BaseStatusPill,
} from "@/components/suite-primitives";
import { formatVnd, type Clinic } from "@/lib/data";
import type { StaffPayrollWorkspace } from "@/lib/payroll-types";
import type { AppSession } from "@/lib/session";

const employeeNoticeText: Record<string, Record<Language, string>> = {
  "staff-profile-missing": {
    vi: "Không tìm thấy hồ sơ nhân sự trong phạm vi phòng khám này.",
    en: "The staff profile could not be found in this clinic scope.",
  },
  "staff-attendance-open": {
    vi: "Nhân viên này đang có log chấm công chưa ra ca.",
    en: "This staff member already has an open attendance log.",
  },
  "staff-clocked-in": {
    vi: "Đã ghi nhận vào ca.",
    en: "Clock-in recorded.",
  },
  "staff-attendance-missing": {
    vi: "Không tìm thấy log chấm công đang mở.",
    en: "The open attendance log could not be found.",
  },
  "staff-clocked-out": {
    vi: "Đã ghi nhận ra ca.",
    en: "Clock-out recorded.",
  },
  "staff-leave-missing": {
    vi: "Cần chọn nhân viên và kỳ nghỉ hợp lệ.",
    en: "Select a staff member and a valid leave period.",
  },
  "staff-leave-created": {
    vi: "Đã tạo đơn nghỉ phép.",
    en: "Leave request created.",
  },
  "staff-database": {
    vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.",
    en: "The change could not be saved. Please try again.",
  },
};

const employeeStatusText: Record<Language, Record<string, string>> = {
  vi: {
    APPROVED: "Đã duyệt",
    CLOSED: "Đã đóng",
    EARNED: "Đã phát sinh",
    NORMAL: "Bình thường",
    OPEN: "Đang mở",
    PAID: "Đã chi trả",
    REJECTED: "Từ chối",
    REQUESTED: "Đã yêu cầu",
    SCHEDULED: "Đã xếp ca",
    VOID: "Đã hủy",
  },
  en: {},
};

export function EmployeeAppPanel({
  session,
  staffPayrollWorkspace,
  visibleClinics,
}: {
  session: AppSession;
  staffPayrollWorkspace?: StaffPayrollWorkspace | null;
  visibleClinics: Clinic[];
}) {
  const { language, t } = useAppLanguage();
  const searchParams = useSearchParams();
  const notice = noticeText(visibleActionNoticeParam(searchParams.get("notice")), language);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [incomeFormulaOpen, setIncomeFormulaOpen] = useState(false);
  const staff = staffPayrollWorkspace?.staff ?? [];
  const currentStaff = staff.find((member) => member.userId === session.userId) ?? null;
  const currentStaffId = currentStaff?.id ?? "";
  const shifts = (staffPayrollWorkspace?.shifts ?? []).filter(
    (shift) => shift.staffProfileId === currentStaffId,
  );
  const attendanceLogs = (staffPayrollWorkspace?.attendanceLogs ?? []).filter(
    (log) => log.staffProfileId === currentStaffId,
  );
  const leaveRequests = (staffPayrollWorkspace?.leaveRequests ?? []).filter(
    (request) => request.staffProfileId === currentStaffId,
  );
  const accruals = (staffPayrollWorkspace?.accruals ?? []).filter((accrual) =>
    accrual.lines.some((line) => line.userId === session.userId),
  );
  const openAttendance = attendanceLogs.find((log) => !log.clockOutAt) ?? null;
  const allTimeCommission = accruals
    .filter((accrual) => accrual.status !== "VOID")
    .reduce(
      (total, accrual) =>
        total +
        accrual.lines
          .filter((line) => line.userId === session.userId)
          .reduce((lineTotal, line) => lineTotal + line.amount, 0),
      0,
    );
  const today = vietnamTodayDate();
  const currentMonthKey = today.slice(0, 7);
  const currentMonthLabel = currentMonthKey.split("-").reverse().join("/");
  const activePayrollPolicies = (staffPayrollWorkspace?.payrollPolicies ?? []).filter(
    (policy) => policy.active,
  );
  const payrollPolicy =
    activePayrollPolicies.find((policy) => policy.clinicId === currentStaff?.clinicId) ??
    activePayrollPolicies.find((policy) => policy.scopeKey === "all") ??
    null;
  const standardWorkdays = payrollPolicy?.standardWorkdays ?? 26;
  const monthAttendanceDays = new Set(
    attendanceLogs
      .map((log) => vietnamDateKeyFromIso(log.clockInAtIso))
      .filter((dateKey) => dateKey.startsWith(currentMonthKey)),
  );
  const workedDaysThisMonth = monthAttendanceDays.size;
  const baseSalary = currentStaff?.baseSalary ?? 0;
  const earnedBaseSalary = Math.min(
    baseSalary,
    Math.round((baseSalary / standardWorkdays) * Math.min(workedDaysThisMonth, standardWorkdays)),
  );
  const monthAccruals = accruals.filter(
    (accrual) =>
      accrual.status !== "VOID" &&
      vietnamMonthKeyFromIso(accrual.createdAtIso) === currentMonthKey,
  );
  const monthCommission = monthAccruals.reduce(
    (total, accrual) =>
      total +
      accrual.lines
        .filter((line) => line.userId === session.userId)
        .reduce((lineTotal, line) => lineTotal + line.amount, 0),
    0,
  );
  const approvedCommission = monthAccruals
    .filter((accrual) => accrual.status === "APPROVED" || accrual.status === "PAID")
    .reduce(
      (total, accrual) =>
        total +
        accrual.lines
          .filter((line) => line.userId === session.userId)
          .reduce((lineTotal, line) => lineTotal + line.amount, 0),
      0,
    );
  const pendingCommission = Math.max(monthCommission - approvedCommission, 0);
  const monthIncome = earnedBaseSalary + monthCommission;
  const deductionAmount = Math.max(
    0,
    Math.round(
      (monthIncome * ((payrollPolicy?.taxPercent ?? 0) + (payrollPolicy?.insurancePercent ?? 0))) /
        100 +
        (payrollPolicy?.otherDeductionAmount ?? 0),
    ),
  );
  const expectedNetIncome = Math.max(monthIncome - deductionAmount, 0);
  const canSelfService = Boolean(currentStaff?.active && staffPayrollWorkspace?.canMutate);
  const clinicName =
    currentStaff?.clinicName ?? visibleClinics[0]?.name ?? session.clinics[0]?.name ?? "-";
  const labels =
    language === "vi"
      ? {
          appTitle: "App nhân viên",
          approvedCommission: "Commission đã duyệt/đã trả",
          attendance: "Chấm công cá nhân",
          baseSalary: "Lương cứng",
          baseSalaryEstimate: "Lương cứng tạm tính",
          commission: "Commission",
          clockIn: "Vào ca",
          clockOutConfirm: "Xác nhận ra ca và đóng log chấm công hiện tại?",
          clockOut: "Ra ca",
          close: "Đóng",
          deductions: "Khấu trừ",
          expectedNet: "Thực nhận dự kiến",
          estimatedIncome: "Tổng thu nhập tháng này",
          formula: "Cách tính",
          formulaTitle: "Cách tính thu nhập tạm tính",
          incomeBreakdown: "Thu nhập tạm tính",
          leave: "Nghỉ phép",
          leaveType: "Loại nghỉ",
          myAccruals: "Lương dịch vụ của tôi",
          mySchedule: "Ca làm của tôi",
          noAttendance: "Chưa có log chấm công",
          noLeave: "Chưa có đơn nghỉ phép",
          noProfile: "Tài khoản này chưa có hồ sơ nhân sự.",
          noShifts: "Chưa có ca làm",
          note: "Ghi chú",
          openShift: "Đang mở",
          pendingCommission: "Commission chờ duyệt",
          reason: "Lý do",
          requestLeave: "Gửi đơn nghỉ",
          start: "Từ ngày",
          end: "Đến ngày",
          hours: "Số giờ",
          subtitle: "Chấm công, xem ca làm, gửi đơn nghỉ và theo dõi lương dịch vụ.",
        }
      : {
          appTitle: "Staff app",
          approvedCommission: "Approved/paid commission",
          attendance: "My attendance",
          baseSalary: "Base salary",
          baseSalaryEstimate: "Estimated base salary",
          commission: "Commission",
          clockIn: "Clock in",
          clockOutConfirm: "Confirm clock-out and close the current attendance log?",
          clockOut: "Clock out",
          close: "Close",
          deductions: "Deductions",
          expectedNet: "Expected net pay",
          estimatedIncome: "This month's income",
          formula: "Formula",
          formulaTitle: "Estimated income formula",
          incomeBreakdown: "Estimated income",
          leave: "Leave",
          leaveType: "Leave type",
          myAccruals: "My service pay",
          mySchedule: "My shifts",
          noAttendance: "No attendance logs yet",
          noLeave: "No leave requests yet",
          noProfile: "This account does not have a staff profile yet.",
          noShifts: "No shifts yet",
          note: "Note",
          openShift: "Open",
          pendingCommission: "Pending commission",
          reason: "Reason",
          requestLeave: "Request leave",
          start: "Start date",
          end: "End date",
          hours: "Hours",
          subtitle: "Clock in, view shifts, request leave, and track service pay.",
        };

  return (
    <section className="view-stack mobile-app-view employee-mobile-view">
      <div className="toolbar mobile-app-toolbar">
        <div>
          <p className="eyebrow">{labels.appTitle}</p>
          <h2>{labels.subtitle}</h2>
        </div>
        <SourceBadge source={staffPayrollWorkspace?.source} />
      </div>

      {(staffPayrollWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(staffPayrollWorkspace?.message, language)}
        </div>
      )}

      <div className="metric-grid">
        <MetricCard
          label={labels.estimatedIncome}
          value={formatVnd(monthIncome)}
          tone="green"
        />
        <MetricCard label={labels.baseSalaryEstimate} value={formatVnd(earnedBaseSalary)} tone="blue" />
        <MetricCard label={labels.commission} value={formatVnd(monthCommission)} tone="teal" />
        <MetricCard
          label={labels.deductions}
          value={formatVnd(deductionAmount)}
          tone="amber"
        />
        <MetricCard label={labels.expectedNet} value={formatVnd(expectedNetIncome)} tone="violet" />
      </div>

      <section className="content-grid portal-layout mobile-app-grid">
        <section className="panel">
          <PanelHeader icon={Smartphone} title={labels.appTitle} action={clinicName} />
          {currentStaff ? (
            <div className="phone-frame" aria-label={labels.appTitle}>
              <div className="phone-top">
                <span className="phone-brand">
                  <img src="/icons/codexmed-icon.svg" alt="" aria-hidden="true" />
              <span>Codexdentist</span>
                </span>
                <StatusPill status={openAttendance ? labels.openShift : "Ready"} />
              </div>
              <strong>{currentStaff.fullName}</strong>
              <p>
                {currentStaff.employeeCode} · {t.roles[currentStaff.role]} · {clinicName}
              </p>

              <div className="mobile-card employee-income-card">
                <div className="employee-income-card-header">
                  <span>
                    {labels.incomeBreakdown} · {currentMonthLabel}
                  </span>
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    onClick={() => setIncomeFormulaOpen(true)}
                  >
                    {labels.formula}
                  </button>
                </div>
                <div className="employee-income-row total">
                  <small>{labels.estimatedIncome}</small>
                  <strong>{formatVnd(monthIncome)}</strong>
                </div>
                <div className="employee-income-row">
                  <small>
                    {labels.baseSalaryEstimate} · {workedDaysThisMonth}/{standardWorkdays}
                  </small>
                  <strong>{formatVnd(earnedBaseSalary)}</strong>
                </div>
                <div className="employee-income-row">
                  <small>{labels.commission}</small>
                  <strong>{formatVnd(monthCommission)}</strong>
                </div>
                <div className="employee-income-row">
                  <small>{labels.approvedCommission}</small>
                  <strong>{formatVnd(approvedCommission)}</strong>
                </div>
                <div className="employee-income-row">
                  <small>{labels.pendingCommission}</small>
                  <strong>{formatVnd(pendingCommission)}</strong>
                </div>
                <div className="employee-income-row">
                  <small>{labels.deductions}</small>
                  <strong>{formatVnd(deductionAmount)}</strong>
                </div>
                <div className="employee-income-row total">
                  <small>{labels.expectedNet}</small>
                  <strong>{formatVnd(expectedNetIncome)}</strong>
                </div>
              </div>

              {openAttendance ? (
                <form
                  action={clockOutCurrentStaffAction}
                  className="staff-form compact"
                  onSubmit={(event) => {
                    if (!window.confirm(labels.clockOutConfirm)) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input name="outStatus" type="hidden" value="NORMAL" />
                  <button className="primary-button" type="submit" disabled={!canSelfService}>
                    <Activity size={16} />
                    {labels.clockOut}
                  </button>
                </form>
              ) : (
                <form action={clockInCurrentStaffAction} className="staff-form compact">
                  <label>
                    {labels.note}
                    <textarea name="note" disabled={!canSelfService} />
                  </label>
                  <button className="primary-button" type="submit" disabled={!canSelfService}>
                    <Activity size={16} />
                    {labels.clockIn}
                  </button>
                </form>
              )}

              <div className="mobile-card">
                <span>{labels.mySchedule}</span>
                {shifts.slice(0, 2).map((shift) => (
                  <small key={shift.id}>
                    {shift.startsAt} - {shift.endsAt} · {shift.roleOnShift ?? labels.mySchedule}
                  </small>
                ))}
                {shifts.length === 0 && <small>{labels.noShifts}</small>}
              </div>

              <button
                className="secondary-button"
                type="button"
                disabled={!canSelfService}
                onClick={() => setLeaveModalOpen(true)}
              >
                <FileText size={16} />
                {labels.requestLeave}
              </button>
            </div>
          ) : (
            <EmptyState label={labels.noProfile} />
          )}
        </section>

        <section className="panel">
          <PanelHeader icon={CalendarDays} title={labels.mySchedule} action={`${shifts.length}`} />
          <div className="portal-data-list">
            {shifts.length > 0 ? (
              shifts.slice(0, 8).map((shift) => (
                <div className="portal-row" key={shift.id}>
                  <span>{shift.startsAt}</span>
                  <strong>{shift.roleOnShift ?? labels.mySchedule}</strong>
                  <StatusPill status={shift.status} />
                </div>
              ))
            ) : (
              <EmptyState label={labels.noShifts} />
            )}
          </div>
        </section>
      </section>

      <section className="content-grid service-management-grid">
        <section className="panel">
          <PanelHeader icon={Activity} title={labels.attendance} action={`${attendanceLogs.length}`} />
          <div className="invoice-list">
            {attendanceLogs.length > 0 ? (
              attendanceLogs.slice(0, 8).map((log) => (
                <div className="invoice-row billing-invoice-row" key={log.id}>
                  <div>
                    <strong>{log.clockInAt}</strong>
                    <span>{log.clockOutAt ? log.clockOutAt : labels.openShift}</span>
                    {log.note && <small>{log.note}</small>}
                  </div>
                  <StatusPill status={log.clockOutAt ? log.outStatus ?? "CLOSED" : "OPEN"} />
                </div>
              ))
            ) : (
              <EmptyState label={labels.noAttendance} />
            )}
          </div>
        </section>

        <section className="panel">
          <PanelHeader icon={FileText} title={labels.leave} action={`${leaveRequests.length}`} />
          <div className="invoice-list">
            {leaveRequests.length > 0 ? (
              leaveRequests.slice(0, 8).map((request) => (
                <div className="invoice-row billing-invoice-row" key={request.id}>
                  <div>
                    <strong>{request.leaveType}</strong>
                    <span>
                      {request.startsAt} - {request.endsAt} · {request.hours ?? 0}h
                    </span>
                    <small>{request.reason ?? "-"}</small>
                  </div>
                  <StatusPill status={request.status} />
                </div>
              ))
            ) : (
              <EmptyState label={labels.noLeave} />
            )}
          </div>
        </section>
      </section>

      <section className="panel">
        <PanelHeader icon={WalletCards} title={labels.myAccruals} action={formatVnd(allTimeCommission)} />
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
                    {accrual.earnedProgressPercent}% · {accrual.createdAt}
                  </small>
                </div>
                <StatusPill status={accrual.status} />
                <strong>
                  {formatVnd(
                    accrual.lines
                      .filter((line) => line.userId === session.userId)
                      .reduce((total, line) => total + line.amount, 0),
                  )}
                </strong>
              </article>
            ))
          ) : (
            <EmptyState label={labels.myAccruals} />
          )}
        </div>
      </section>

      {incomeFormulaOpen && (
        <div
          aria-label={labels.formulaTitle}
          aria-modal="true"
          className="progress-modal-backdrop"
          onClick={() => setIncomeFormulaOpen(false)}
          role="dialog"
        >
          <div
            className="progress-modal employee-formula-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="progress-modal-header">
              <div>
                <span>{currentMonthLabel}</span>
                <h3>{labels.formulaTitle}</h3>
              </div>
              <button
                aria-label={labels.close}
                className="icon-button"
                type="button"
                onClick={() => setIncomeFormulaOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="employee-formula-list">
              <div>
                <span>{labels.baseSalaryEstimate}</span>
                <strong>
                  {formatVnd(baseSalary)} / {standardWorkdays} x {workedDaysThisMonth} ={" "}
                  {formatVnd(earnedBaseSalary)}
                </strong>
              </div>
              <div>
                <span>{labels.commission}</span>
                <strong>
                  {formatVnd(approvedCommission)} + {formatVnd(pendingCommission)} ={" "}
                  {formatVnd(monthCommission)}
                </strong>
              </div>
              <div>
                <span>{labels.deductions}</span>
                <strong>
                  {payrollPolicy
                    ? `${payrollPolicy.taxPercent + payrollPolicy.insurancePercent}% + ${formatVnd(
                        payrollPolicy.otherDeductionAmount,
                      )} = ${formatVnd(deductionAmount)}`
                    : formatVnd(deductionAmount)}
                </strong>
              </div>
              <div>
                <span>{labels.expectedNet}</span>
                <strong>
                  {formatVnd(monthIncome)} - {formatVnd(deductionAmount)} ={" "}
                  {formatVnd(expectedNetIncome)}
                </strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {leaveModalOpen && (
        <div
          aria-label={labels.requestLeave}
          aria-modal="true"
          className="progress-modal-backdrop"
          onClick={() => setLeaveModalOpen(false)}
          role="dialog"
        >
          <form
            action={createCurrentStaffLeaveRequestAction}
            className="progress-modal employee-leave-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={() => setLeaveModalOpen(false)}
          >
            <div className="progress-modal-header">
              <div>
                <span>{labels.leave}</span>
                <h3>{labels.requestLeave}</h3>
              </div>
              <button
                aria-label={labels.close}
                className="icon-button"
                type="button"
                onClick={() => setLeaveModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="progress-modal-grid">
              <label>
                {labels.leaveType}
                <select name="leaveType" defaultValue="ANNUAL" disabled={!canSelfService}>
                  <option value="ANNUAL">ANNUAL</option>
                  <option value="SICK">SICK</option>
                  <option value="UNPAID">UNPAID</option>
                  <option value="TRAINING">TRAINING</option>
                </select>
              </label>
              <label>
                {labels.start}
                <input
                  name="startsAt"
                  type="date"
                  defaultValue={today}
                  disabled={!canSelfService}
                  required
                />
              </label>
              <label>
                {labels.end}
                <input
                  name="endsAt"
                  type="date"
                  defaultValue={today}
                  disabled={!canSelfService}
                  required
                />
              </label>
              <label>
                {labels.hours}
                <input name="hours" inputMode="decimal" disabled={!canSelfService} />
              </label>
              <label className="clinical-wide">
                {labels.reason}
                <textarea name="reason" disabled={!canSelfService} />
              </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setLeaveModalOpen(false)}>
                {labels.close}
              </button>
              <button className="primary-button" type="submit" disabled={!canSelfService}>
                <FileText size={16} />
                {labels.requestLeave}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { t } = useAppLanguage();

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? t.databaseLive : t.demoMode}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();

  return (
    <BaseStatusPill label={displayStatus(status, language)} status={status} />
  );
}

function displayStatus(status: string, language: Language) {
  return employeeStatusText[language][status] ?? status;
}

function noticeText(notice: string | null, language: Language) {
  return notice ? employeeNoticeText[notice]?.[language] ?? null : null;
}

function workspaceMessageText(message: string | null | undefined, language: Language) {
  if (!message || language !== "vi") {
    return message;
  }

  const viMessages: Record<string, string> = {
    "Chưa có dữ liệu trong phạm vi hiện tại.":
      "Chưa có dữ liệu trong phạm vi hiện tại.",
  };

  return viMessages[message] ?? message;
}

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

function formatServiceInstanceCode(serviceCode: string) {
  const [patientCode, servicePart] = serviceCode.split("-");

  return patientCode && servicePart ? `${patientCode} • ${servicePart}` : serviceCode;
}
