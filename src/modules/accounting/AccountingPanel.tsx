"use client";

import { BarChart3, ClipboardList, FileText, Settings, WalletCards, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  createAccountingEntryAction,
  updateAccountingBudgetTargetAction,
} from "@/app/(app)/accounting/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { MoneyInput } from "@/components/MoneyInput";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, MetricCard, PanelHeader, StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import { formatVnd, type Clinic } from "@/lib/data";
import type {
  AccountingBudgetTargetSummary,
  AccountingCategorySummary,
  AccountingEntrySummary,
  AccountingPnLLine,
  AccountingSummary,
  AccountingWorkspace,
} from "@/lib/accounting-types";

function normalizeSearchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase();
}

function matchesAccountingSearch(query: string, values: Array<string | number | null | undefined>) {
  if (!query) return true;
  return values.some((value) => normalizeSearchText(value).includes(query));
}

function vietnamTodayDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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
    "accounting-entry-created": { vi: "\u0110\u00e3 l\u01b0u b\u00fat to\u00e1n k\u1ebf to\u00e1n.", en: "Accounting entry saved." },
    "accounting-budget-updated": { vi: "\u0110\u00e3 c\u1eadp nh\u1eadt ng\u00e2n s\u00e1ch m\u1ee5c ti\u00eau.", en: "Accounting budget target updated." },
    "accounting-denied": { vi: "Vai tr\u00f2 n\u00e0y kh\u00f4ng th\u1ec3 s\u1eeda d\u1eef li\u1ec7u k\u1ebf to\u00e1n.", en: "This role cannot change accounting records." },
    "accounting-missing": { vi: "C\u1ea7n \u0111i\u1ec1n \u0111\u1ee7 th\u00f4ng tin k\u1ebf to\u00e1n b\u1eaft bu\u1ed9c.", en: "Complete the required accounting fields." },
    "accounting-kind-mismatch": { vi: "Lo\u1ea1i b\u00fat to\u00e1n kh\u00f4ng kh\u1edbp v\u1edbi danh m\u1ee5c.", en: "Entry kind and category do not match." },
    "accounting-attachment-type": { vi: "Ch\u1ee9ng t\u1eeb k\u1ebf to\u00e1n ph\u1ea3i l\u00e0 file \u1ea3nh.", en: "Accounting attachments must be image files." },
    "accounting-attachment-large": { vi: "\u1ea2nh ch\u1ee9ng t\u1eeb k\u1ebf to\u00e1n ph\u1ea3i nh\u1ecf h\u01a1n ho\u1eb7c b\u1eb1ng 15 MB.", en: "Accounting attachment images must be 15 MB or smaller." },
    "accounting-database": { vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.", en: "The change could not be saved. Please try again." },
  };

  return notice ? notices[notice]?.[language] ?? null : null;
}

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();
  return noticeText(notice, language);
}

function displayStatus(status: string, language: Language) {
  const viStatus: Record<string, string> = {
    OK: "Trong ng\u01b0\u1ee1ng",
    WATCH: "C\u1ea7n theo d\u00f5i",
    OVER: "V\u01b0\u1ee3t ng\u01b0\u1ee1ng",
    INFO: "Th\u00f4ng tin",
    INCOME: "Thu",
    EXPENSE: "Chi",
    TRANSFER: "Chuy\u1ec3n kho\u1ea3n",
  };

  return language === "vi" ? viStatus[status] ?? status : status;
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();
  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}
export function AccountingPanel({
  accountingWorkspace,
  visibleClinics,
}: {
  accountingWorkspace?: AccountingWorkspace | null;
  visibleClinics: Clinic[];
}) {
  const { language } = useAppLanguage();
  const searchParams = useSearchParams();
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const labels =
    language === "vi"
      ? {
          addEntry: "Thêm thu/chi",
          all: "Tất cả",
          allClinics: "Toàn hệ thống",
          amount: "Số tiền",
          attachment: "Ảnh chứng từ",
          attachmentOpen: "Mở ảnh chứng từ",
          budget: "Ngân sách mục tiêu",
          budgetEdit: "Chỉnh ngân sách",
          budgetHelp: "Các ngưỡng ngân sách được dùng để cảnh báo P&L tháng.",
          budgetModalTitle: "Chỉnh ngân sách mục tiêu",
          bankTransfer: "Chuyển khoản",
          category: "Danh mục",
          clinic: "Phòng khám",
          close: "Đóng",
          collections: "Tiền thu bệnh nhân",
          description: "Mô tả",
          entryBook: "Sổ thu chi",
          expense: "Chi",
          expensePercent: "Tỷ lệ chi phí",
          expenses: "Tổng chi phí",
          filterKind: "Loại bút toán",
          generated: "Cập nhật",
          heading: "Quản trị thu chi, P&L và ngân sách vận hành phòng khám",
          income: "Thu",
          kind: "Loại",
          ledgerSearch: "Tìm mô tả, nhà cung cấp, tham chiếu",
          manual: "Thủ công",
          method: "Phương thức",
          month: "Tháng",
          noCategory: "Chưa có danh mục phù hợp",
          noEntries: "Chưa có bút toán trong tháng này",
          occurredAt: "Ngày phát sinh",
          paymentRef: "Mã tham chiếu",
          pnl: "P&L tháng",
          profit: "Lợi nhuận vận hành",
          profitPercent: "Biên lợi nhuận",
          save: "Lưu",
          source: "Nguồn",
          target: "Mục tiêu %",
          threshold: "Cảnh báo %",
          transfer: "Chuyển khoản nội bộ",
          vendor: "Nhà cung cấp / đối tượng",
          viewPeriod: "Xem kỳ",
          pnlTab: "P&L tháng",
          ledgerTab: "Sổ thu chi",
          budgetTab: "Ngân sách",
        }
      : {
          addEntry: "Add income/expense",
          all: "All",
          allClinics: "Organization",
          amount: "Amount",
          attachment: "Receipt image",
          attachmentOpen: "Open receipt image",
          budget: "Budget targets",
          budgetEdit: "Edit budget",
          budgetHelp: "Budget thresholds drive monthly P&L warnings.",
          budgetModalTitle: "Edit budget targets",
          bankTransfer: "Bank transfer",
          category: "Category",
          clinic: "Clinic",
          close: "Close",
          collections: "Patient collections",
          description: "Description",
          entryBook: "Income and expense book",
          expense: "Expense",
          expensePercent: "Expense ratio",
          expenses: "Total expenses",
          filterKind: "Entry kind",
          generated: "Updated",
          heading: "Manage cash entries, monthly P&L, and clinic operating budgets",
          income: "Income",
          kind: "Kind",
          ledgerSearch: "Search description, vendor, reference",
          manual: "Manual",
          method: "Method",
          month: "Month",
          noCategory: "No matching category",
          noEntries: "No entries this month",
          occurredAt: "Date",
          paymentRef: "Reference",
          pnl: "Monthly P&L",
          profit: "Operating profit",
          profitPercent: "Profit margin",
          save: "Save",
          source: "Source",
          target: "Target %",
          threshold: "Warning %",
          transfer: "Transfer",
          vendor: "Vendor / counterparty",
          viewPeriod: "View",
          pnlTab: "Monthly P&L",
          ledgerTab: "Ledger",
          budgetTab: "Budgets",
        };
  const workspace = accountingWorkspace;
  const categories = workspace?.categories ?? [];
  const expenseCategories = categories.filter((category) => category.kind === "EXPENSE");
  const [entryKind, setEntryKind] = useState<"INCOME" | "EXPENSE" | "TRANSFER">("EXPENSE");
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [ledgerClinicFilter, setLedgerClinicFilter] = useState("all");
  const [ledgerKindFilter, setLedgerKindFilter] = useState("all");
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [accountingSection, setAccountingSection] = useState<"pnl" | "ledger" | "budget">("pnl");
  const canMutate = workspace?.canMutate ?? false;
  const periodMonth = workspace?.periodMonth ?? vietnamTodayDate().slice(0, 7);
  const visibleClinicIds = useMemo(
    () => new Set(visibleClinics.map((clinic) => clinic.id)),
    [visibleClinics],
  );
  const scopedAccountingEntries = useMemo(
    () =>
      (workspace?.entries ?? []).filter(
        (entry) => entry.clinicId === null || visibleClinicIds.has(entry.clinicId),
      ),
    [workspace?.entries, visibleClinicIds],
  );
  const scopedBudgetTargets = useMemo(
    () =>
      (workspace?.budgetTargets ?? []).filter(
        (target) => target.clinicId === null || visibleClinicIds.has(target.clinicId),
      ),
    [workspace?.budgetTargets, visibleClinicIds],
  );
  const entries = scopedAccountingEntries;
  const summary = useMemo(
    () => buildScopedAccountingSummary(periodMonth, scopedAccountingEntries),
    [periodMonth, scopedAccountingEntries],
  );
  const pnlLines = useMemo(
    () =>
      buildScopedAccountingPnlLines({
        categories,
        budgetTargets: scopedBudgetTargets,
        collections: summary.collections,
        entries: scopedAccountingEntries,
      }),
    [categories, scopedBudgetTargets, summary.collections, scopedAccountingEntries],
  );
  const entryCategoryOptions = categories.filter((category) => category.kind === entryKind);
  const ledgerSearchQuery = normalizeSearchText(ledgerQuery);
  const filteredEntries = entries.filter((entry) => {
    const matchesClinic =
      ledgerClinicFilter === "all" ||
      (ledgerClinicFilter === "organization" ? !entry.clinicId : entry.clinicId === ledgerClinicFilter);
    const matchesKind = ledgerKindFilter === "all" || entry.kind === ledgerKindFilter;
    const matchesSearch =
      !ledgerSearchQuery ||
      matchesAccountingSearch(ledgerSearchQuery, [
        entry.description,
        entry.vendor,
        entry.reference,
        entry.paymentMethod,
        entry.categoryName,
        entry.categoryCode,
        entry.clinicName,
        entry.amount,
        accountingSourceLabel(entry.sourceType, language),
      ]);

    return matchesClinic && matchesKind && matchesSearch;
  });
  const warningLines = pnlLines.filter((line) => line.status === "OVER" || line.status === "WATCH");
  const expensePnlLines = pnlLines.filter((line) => line.kind === "EXPENSE");
  const accountingSectionTabs = [
    { key: "pnl", label: labels.pnlTab, count: warningLines.length },
    { key: "ledger", label: labels.ledgerTab, count: filteredEntries.length },
    { key: "budget", label: labels.budgetTab, count: expensePnlLines.length },
  ] as const;

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">Accounting</p>
          <h2>{labels.heading}</h2>
        </div>
        <div className="accounting-toolbar-actions">
          <button
            className="primary-button compact-button"
            type="button"
            onClick={() => setEntryModalOpen(true)}
            disabled={!canMutate || entryCategoryOptions.length === 0}
          >
            <WalletCards size={16} />
            {labels.addEntry}
          </button>
          <form className="accounting-period-form" method="get">
            <label>
              {labels.month}
              <input name="month" type="month" defaultValue={periodMonth} />
            </label>
            <button className="secondary-button compact-button" type="submit">
              {labels.viewPeriod}
            </button>
          </form>
          <SourceBadge source={workspace?.source} />
        </div>
      </div>

      {(workspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(workspace?.message, language)}
        </div>
      )}

      <div className="metric-grid">
        <MetricCard
          label={labels.collections}
          value={formatVnd(summary.collections)}
          tone="green"
        />
        <MetricCard
          label={labels.expenses}
          value={formatVnd(summary.totalExpenses)}
          tone="amber"
        />
        <MetricCard
          label={labels.profit}
          value={formatVnd(summary.operatingProfit)}
          tone={summary.operatingProfit >= 0 ? "blue" : "rose"}
        />
        <MetricCard
          label={labels.profitPercent}
          value={`${summary.profitPercent}%`}
          tone={summary.profitPercent >= 15 ? "teal" : "rose"}
        />
      </div>

      <nav className="accounting-section-tabs" aria-label={labels.heading}>
        {accountingSectionTabs.map((tab) => (
          <button
            className={accountingSection === tab.key ? "active" : ""}
            key={tab.key}
            type="button"
            onClick={() => setAccountingSection(tab.key)}
          >
            {tab.label}
            <span>{tab.count}</span>
          </button>
        ))}
      </nav>

      {accountingSection === "pnl" && (
      <section className="content-grid accounting-layout">
        <section className="panel">
          <PanelHeader icon={BarChart3} title={labels.pnl} action={periodMonth} />
          <div className="accounting-pnl-list">
            {pnlLines.map((line) => (
              <div className="accounting-pnl-row" key={line.categoryId}>
                <div>
                  <strong>{line.categoryName}</strong>
                  <small>
                    {line.percentOfCollections}% / {line.targetPercent ?? "-"}%
                    {line.warningPercent ? ` · ${labels.threshold} ${line.warningPercent}%` : ""}
                  </small>
                </div>
                <span>{formatVnd(line.amount)}</span>
                <StatusPill status={line.status} />
              </div>
            ))}
          </div>
          {warningLines.length > 0 && (
            <div className="schedule-alert action accounting-warning">
              {warningLines
                .slice(0, 3)
                .map((line) => `${line.categoryName} ${line.percentOfCollections}%`)
                .join(" · ")}
            </div>
          )}
        </section>
      </section>
      )}

      {accountingSection === "ledger" && (
      <section className="content-grid accounting-layout">
        <section className="panel">
          <PanelHeader icon={ClipboardList} title={labels.entryBook} action={`${filteredEntries.length}/${entries.length}`} />
          <div className="accounting-ledger-filters">
            <input
              value={ledgerQuery}
              onChange={(event) => setLedgerQuery(event.target.value)}
              placeholder={labels.ledgerSearch}
            />
            <select value={ledgerClinicFilter} onChange={(event) => setLedgerClinicFilter(event.target.value)}>
              <option value="all">{labels.all}</option>
              <option value="organization">{labels.allClinics}</option>
              {visibleClinics.map((clinic) => (
                <option value={clinic.id} key={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
            <select value={ledgerKindFilter} onChange={(event) => setLedgerKindFilter(event.target.value)}>
              <option value="all">{labels.all}</option>
              <option value="INCOME">{labels.income}</option>
              <option value="EXPENSE">{labels.expense}</option>
              <option value="TRANSFER">{labels.transfer}</option>
            </select>
          </div>
          <div className="invoice-list">
            {filteredEntries.length > 0 ? (
              filteredEntries.slice(0, 80).map((entry) => (
                <div className="invoice-row billing-invoice-row accounting-entry-row" key={entry.id}>
                  <div>
                    <strong>
                      {entry.description} · {formatVnd(entry.amount)}
                    </strong>
                    <span>
                      {entry.occurredAt} · {entry.categoryName} · {entry.clinicName ?? labels.allClinics}
                    </span>
                    <small>
                      {accountingSourceLabel(entry.sourceType, language)}
                      {entry.vendor ? ` · ${entry.vendor}` : ""}
                      {entry.reference ? ` · ${entry.reference}` : ""}
                      {entry.attachmentFileName ? ` · ${entry.attachmentFileName}` : ""}
                    </small>
                    {entry.attachmentUrl && (
                      <a
                        className="accounting-attachment-link"
                        href={entry.attachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {entry.attachmentThumbnailUrl ? (
                          <img src={entry.attachmentThumbnailUrl} alt="" />
                        ) : (
                          <FileText size={16} />
                        )}
                        {labels.attachmentOpen}
                      </a>
                    )}
                  </div>
                  <StatusPill status={entry.kind} />
                </div>
              ))
            ) : (
              <EmptyState label={labels.noEntries} />
            )}
          </div>
        </section>
      </section>
      )}

      {accountingSection === "budget" && (
      <section className="content-grid accounting-layout">
        <section className="panel">
          <PanelHeader icon={Settings} title={labels.budget} action={labels.expensePercent} />
          <div className="accounting-budget-summary">
            <p>{labels.budgetHelp}</p>
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={() => setBudgetModalOpen(true)}
              disabled={!canMutate}
            >
              <Settings size={16} />
              {labels.budgetEdit}
            </button>
          </div>
          <div className="accounting-budget-summary-list">
            {expensePnlLines.map((line) => (
              <div className="accounting-budget-summary-row" key={line.categoryId}>
                <div>
                  <strong>{line.categoryName}</strong>
                  <small>
                    {line.percentOfCollections}% / {line.targetPercent ?? "-"}%
                    {line.warningPercent ? ` · ${labels.threshold} ${line.warningPercent}%` : ""}
                  </small>
                </div>
                <StatusPill status={line.status} />
              </div>
            ))}
          </div>
        </section>
      </section>
      )}

      {entryModalOpen && (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={labels.addEntry}
          onClick={() => setEntryModalOpen(false)}
        >
          <form
            action={createAccountingEntryAction}
            className="progress-modal accounting-entry-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={() => setEntryModalOpen(false)}
          >
            <div className="progress-modal-header">
              <span>
                <WalletCards size={18} />
              </span>
              <h3>{labels.addEntry}</h3>
              <button
                className="icon-button"
                type="button"
                onClick={() => setEntryModalOpen(false)}
                aria-label={labels.close}
              >
                <X size={18} />
              </button>
            </div>
            <div className="progress-modal-grid modal-form-grid accounting-entry-modal-grid">
              <label>
                {labels.clinic}
                <select name="clinicId" disabled={!canMutate}>
                  <option value="">{labels.allClinics}</option>
                  {visibleClinics.map((clinic) => (
                    <option value={clinic.id} key={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {labels.kind}
                <select
                  name="kind"
                  value={entryKind}
                  onChange={(event) => setEntryKind(event.target.value as "INCOME" | "EXPENSE" | "TRANSFER")}
                  disabled={!canMutate}
                >
                  <option value="EXPENSE">{labels.expense}</option>
                  <option value="INCOME">{labels.income}</option>
                  <option value="TRANSFER">{labels.transfer}</option>
                </select>
              </label>
              <label>
                {labels.category}
                <select name="categoryId" disabled={!canMutate} required>
                  {entryCategoryOptions.length === 0 && <option value="">{labels.noCategory}</option>}
                  {entryCategoryOptions.map((category) => (
                    <option value={category.id} key={category.id}>
                      {language === "en" && category.nameEn ? category.nameEn : category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {labels.amount}
                <MoneyInput name="amount" disabled={!canMutate} required />
              </label>
              <label>
                {labels.occurredAt}
                <input name="occurredAt" type="date" defaultValue={vietnamTodayDate()} disabled={!canMutate} required />
              </label>
              <label>
                {labels.vendor}
                <input name="vendor" disabled={!canMutate} />
              </label>
              <label>
                {labels.method}
                <select name="paymentMethod" disabled={!canMutate} defaultValue="bank_transfer">
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">{labels.bankTransfer}</option>
                  <option value="card">Card</option>
                  <option value="internal_transfer">Internal transfer</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                {labels.paymentRef}
                <input name="reference" disabled={!canMutate} />
              </label>
              <label className="patient-wide">
                {labels.attachment}
                <input name="attachment" type="file" accept="image/*" disabled={!canMutate} />
              </label>
              <label className="patient-wide">
                {labels.description}
                <textarea name="description" disabled={!canMutate} required />
              </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setEntryModalOpen(false)}>
                {labels.close}
              </button>
              <button className="primary-button" type="submit" disabled={!canMutate || entryCategoryOptions.length === 0}>
                <WalletCards size={16} />
                {labels.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {budgetModalOpen && (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={labels.budgetModalTitle}
          onClick={() => setBudgetModalOpen(false)}
        >
          <div
            className="progress-modal accounting-budget-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="progress-modal-header">
              <span>
                <Settings size={18} />
              </span>
              <h3>{labels.budgetModalTitle}</h3>
              <button
                className="icon-button"
                type="button"
                onClick={() => setBudgetModalOpen(false)}
                aria-label={labels.close}
              >
                <X size={18} />
              </button>
            </div>
            <div className="accounting-budget-list accounting-budget-modal-list">
              {expenseCategories.map((category) => (
                <form
                  action={updateAccountingBudgetTargetAction}
                  className="accounting-budget-row"
                  key={category.id}
                  onSubmit={() => setBudgetModalOpen(false)}
                >
                  <input name="categoryId" type="hidden" value={category.id} />
                  <input name="periodMonth" type="hidden" value={periodMonth} />
                  <div>
                    <strong>{language === "en" && category.nameEn ? category.nameEn : category.name}</strong>
                    <small>
                      {labels.target}: {category.targetPercent ?? "-"}% · {labels.threshold}:{" "}
                      {category.warningPercent ?? "-"}%
                    </small>
                  </div>
                  <select name="clinicId" disabled={!canMutate}>
                    <option value="">{labels.allClinics}</option>
                    {visibleClinics.map((clinic) => (
                      <option value={clinic.id} key={clinic.id}>
                        {clinic.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={labels.target}
                    name="targetPercent"
                    inputMode="decimal"
                    defaultValue={category.targetPercent ?? ""}
                    disabled={!canMutate}
                    required
                  />
                  <input
                    aria-label={labels.threshold}
                    name="warningPercent"
                    inputMode="decimal"
                    defaultValue={category.warningPercent ?? ""}
                    disabled={!canMutate}
                  />
                  <button type="submit" disabled={!canMutate}>
                    {labels.save}
                  </button>
                </form>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function buildScopedAccountingSummary(
  periodMonth: string,
  entries: AccountingEntrySummary[],
): AccountingSummary {
  const collections = sumScopedAccountingCategory(entries, "COLLECTIONS");
  const totalIncome = entries
    .filter((entry) => entry.kind === "INCOME")
    .reduce((total, entry) => total + entry.amount, 0);
  const totalExpenses = entries
    .filter((entry) => entry.kind === "EXPENSE")
    .reduce((total, entry) => total + entry.amount, 0);
  const operatingProfit = totalIncome - totalExpenses;

  return {
    periodMonth,
    collections,
    manualIncome: entries
      .filter((entry) => entry.kind === "INCOME" && entry.categoryCode !== "COLLECTIONS")
      .reduce((total, entry) => total + entry.amount, 0),
    totalIncome,
    totalExpenses,
    operatingProfit,
    profitPercent: scopedAccountingPercent(operatingProfit, collections),
    expensePercent: scopedAccountingPercent(totalExpenses, collections),
    clinicalPayrollPercent: scopedAccountingPercent(
      sumScopedAccountingCategory(entries, "CLINICAL_PAYROLL"),
      collections,
    ),
    opsPayrollPercent: scopedAccountingPercent(
      sumScopedAccountingCategory(entries, "OPS_PAYROLL"),
      collections,
    ),
    marketingPercent: scopedAccountingPercent(
      sumScopedAccountingCategory(entries, "MARKETING"),
      collections,
    ),
    labAndSuppliesPercent: scopedAccountingPercent(
      sumScopedAccountingCategory(entries, "LAB") +
        sumScopedAccountingCategory(entries, "SUPPLIES"),
      collections,
    ),
  };
}

function buildScopedAccountingPnlLines({
  budgetTargets,
  categories,
  collections,
  entries,
}: {
  budgetTargets: AccountingBudgetTargetSummary[];
  categories: AccountingCategorySummary[];
  collections: number;
  entries: AccountingEntrySummary[];
}): AccountingPnLLine[] {
  const targetByCategoryId = new Map(budgetTargets.map((target) => [target.categoryId, target]));

  return categories
    .map((category) => {
      const amount = entries
        .filter((entry) => entry.categoryId === category.id)
        .reduce((total, entry) => total + entry.amount, 0);
      const override = targetByCategoryId.get(category.id);
      const targetPercent = override?.targetPercent ?? category.targetPercent;
      const warningPercent = override?.warningPercent ?? category.warningPercent;
      const percentOfCollections = scopedAccountingPercent(amount, collections);
      const status: AccountingPnLLine["status"] =
        category.kind !== "EXPENSE" || !warningPercent
          ? "INFO"
          : percentOfCollections > warningPercent
            ? "OVER"
            : targetPercent && percentOfCollections > targetPercent
              ? "WATCH"
              : "OK";

      return {
        categoryId: category.id,
        categoryCode: category.code,
        categoryName: category.name,
        kind: category.kind,
        amount,
        percentOfCollections,
        targetPercent,
        warningPercent,
        status,
      };
    })
    .filter((line) => line.amount > 0 || line.kind === "EXPENSE");
}

function sumScopedAccountingCategory(entries: AccountingEntrySummary[], categoryCode: string) {
  return entries
    .filter((entry) => entry.categoryCode === categoryCode)
    .reduce((total, entry) => total + entry.amount, 0);
}

function scopedAccountingPercent(amount: number, base: number) {
  if (!base) {
    return 0;
  }

  return Math.round((amount / base) * 1000) / 10;
}

function accountingSourceLabel(sourceType: string, language: Language) {
  const labels: Record<string, { vi: string; en: string }> = {
    manual: { vi: "Nhập tay", en: "Manual" },
    billing_receipt: { vi: "Tự động từ Billing", en: "From Billing" },
    payroll_run: { vi: "Tự động từ Payroll", en: "From Payroll" },
    purchase_order: { vi: "Tự động từ đơn mua hàng", en: "From purchase order" },
    ai_demo_seed: { vi: "Dữ liệu mẫu AI", en: "AI sample data" },
    ai_demo_seed_detail: { vi: "Chi tiết mẫu AI", en: "AI sample detail" },
    demo_derived: { vi: "Demo", en: "Demo" },
  };

  return labels[sourceType]?.[language] ?? sourceType;
}

