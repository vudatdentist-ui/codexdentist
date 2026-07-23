"use client";

import {
  Activity,
  BarChart3,
  ClipboardList,
  Download,
  Inbox,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import {
  EmptyState,
  MetricCard,
  PanelHeader,
  RecordTile,
  StatusPill as BaseStatusPill,
} from "@/components/suite-primitives";
import { formatVnd, type Clinic } from "@/lib/data";
import type { ReportsWorkspace } from "@/lib/reports-types";

const reportsText = {
  vi: {
    aging: "Tuổi nợ",
    amount: "Số tiền",
    completed: "hoàn tất",
    collected: "đã thu",
    collection: "Thu tiền",
    collectionRatio: "Tỷ lệ thu",
    consentRenewals: "Đồng ý cần gia hạn",
    count: "Số lượng",
    daily: "Hằng ngày",
    close: "Đóng",
    details: "Chi tiết",
    drilldown: "Phân tích chi tiết",
    filter: "Lọc báo cáo",
    from: "Từ ngày",
    exportCsv: "Xuất CSV",
    generated: "Cập nhật",
    generatedDemo: "Demo",
    heading: "Hiệu suất phòng khám và tín hiệu rủi ro",
    live: "Live",
    monthToDate: "Tháng hiện tại",
    newPatients: "Bệnh nhân mới",
    noData: "Chưa có dữ liệu trong phạm vi này",
    open: "còn mở",
    openBalance: "Công nợ mở",
    operationalReporting: "Báo cáo vận hành",
    operationalCaveat:
      "Số liệu phục vụ điều hành nội bộ; không thay thế báo cáo kế toán, thuế hoặc kiểm toán.",
    operationalSignals: "Tín hiệu vận hành",
    overdue: "quá hạn",
    overdueInvoices: "Hóa đơn quá hạn",
    period: "Kỳ báo cáo",
    production: "Doanh thu",
    productionByClinic: "Doanh thu theo phòng khám",
    providerPerformance: "Hiệu suất bác sĩ",
    reportTable: "Bảng báo cáo phòng khám",
    sourceRevenue: "Doanh thu theo nguồn",
    sourceCost: "Chi phí nguồn",
    sourceRoi: "ROI",
    sourceDrilldown: "Nguồn",
    commissionDue: "Hoa hồng phải trả",
    serviceMix: "Cơ cấu dịch vụ",
    serviceDrilldown: "Dịch vụ",
    sourceMix: "Nguồn bệnh nhân",
    providerDrilldown: "Bác sĩ",
    trend: "Xu hướng 7 ngày",
    to: "Đến ngày",
    visits: "lượt hẹn",
    allClinics: "Tất cả phòng khám",
    clinicScope: "Phạm vi phòng khám",
    chainScope: "Phạm vi chuỗi",
    unassignedChain: "Chưa gán chuỗi",
    databaseLive: "",
    demoMode: "",
  },
  en: {
    aging: "A/R aging",
    amount: "Amount",
    completed: "completed",
    collected: "collected",
    collection: "Collection",
    collectionRatio: "Collection ratio",
    consentRenewals: "Consent renewals",
    count: "Count",
    daily: "Daily",
    close: "Close",
    details: "Details",
    drilldown: "Drilldown",
    filter: "Filter report",
    from: "From",
    exportCsv: "Export CSV",
    generated: "Updated",
    generatedDemo: "Demo",
    heading: "Clinic performance and risk signals",
    live: "Live",
    monthToDate: "Month to date",
    newPatients: "New patients",
    noData: "No data in this scope",
    open: "open",
    openBalance: "Open balance",
    operationalReporting: "Operational reporting",
    operationalCaveat:
      "Operational management metrics only; not a substitute for accounting, tax, or audited financial reports.",
    operationalSignals: "Operational signals",
    overdue: "overdue",
    overdueInvoices: "Overdue invoices",
    period: "Reporting period",
    production: "Production",
    productionByClinic: "Production by clinic",
    providerPerformance: "Provider performance",
    reportTable: "Clinic report table",
    sourceRevenue: "Revenue by source",
    sourceCost: "Source cost",
    sourceRoi: "ROI",
    sourceDrilldown: "Source",
    commissionDue: "Commission due",
    serviceMix: "Service mix",
    serviceDrilldown: "Service",
    sourceMix: "Patient source mix",
    providerDrilldown: "Provider",
    trend: "7-day trend",
    to: "To",
    visits: "visits",
    allClinics: "All clinics",
    clinicScope: "Clinic scope",
    chainScope: "Chain scope",
    unassignedChain: "Unassigned chain",
    databaseLive: "",
    demoMode: "",
  },
} satisfies Record<Language, Record<string, string>>;

const reportStatusText: Record<Language, Record<string, string>> = {
  vi: {
    DENTIST: "Nha sĩ",
    HYGIENIST: "Điều dưỡng nha khoa",
    FRONT_DESK: "Lễ tân",
    BILLING: "Thu ngân",
    OWNER: "Chủ hệ thống",
    AREA_MANAGER: "Quản lý khu vực",
    CLINIC_MANAGER: "Quản lý phòng khám",
  },
  en: {},
};

export function ReportsPanel({
  reportsWorkspace,
  visibleClinicIds,
  visibleClinics,
}: {
  reportsWorkspace?: ReportsWorkspace | null;
  visibleClinicIds: Set<string>;
  visibleClinics: Clinic[];
}) {
  const { language } = useAppLanguage();
  const text = reportsText[language];
  const searchParams = useSearchParams();
  const [reportDrilldown, setReportDrilldown] = useState<{
    kind: "service" | "provider" | "source";
    key: string;
  } | null>(null);
  const fallbackReports = visibleClinics.map((clinic) => ({
    clinicId: clinic.id,
    chainId: clinic.chainId ?? null,
    chainName: clinic.chainName ?? null,
    name: clinic.name,
    city: clinic.city,
    todayVisits: clinic.todayVisits,
    production: clinic.production,
    collection: clinic.collection,
    openBalance: clinic.production - clinic.collection,
    overdueInvoices: Math.max(Math.round(clinic.pendingClaims / 3), 1),
    consentRenewals: clinic.pendingClaims,
    patientCount: clinic.todayVisits * 18,
    newPatients: Math.max(Math.round(clinic.todayVisits / 4), 1),
    collectionRatio:
      clinic.production > 0
        ? Math.round((clinic.collection / clinic.production) * 100)
        : 0,
  }));
  const reportSource = reportsWorkspace?.clinicReports ?? fallbackReports;
  const visibleReports = reportSource.filter((clinic) =>
    visibleClinicIds.has(clinic.clinicId),
  );
  const reportSummary = {
    production: sumBy(visibleReports, "production"),
    collection: sumBy(visibleReports, "collection"),
    openBalance: sumBy(visibleReports, "openBalance"),
    collectionRatio: collectionRatio(visibleReports),
    visits: sumBy(visibleReports, "todayVisits"),
    newPatients: visibleReports.reduce(
      (total, clinic) => total + (clinic.newPatients ?? 0),
      0,
    ),
    overdueInvoices: sumBy(visibleReports, "overdueInvoices"),
  };
  const topProduction = Math.max(
    ...visibleReports.map((clinic) => clinic.production),
    1,
  );
  const topTrend = Math.max(
    ...(reportsWorkspace?.trend ?? []).flatMap((point) => [
      point.production,
      point.collection,
    ]),
    1,
  );
  const topAging = Math.max(
    ...(reportsWorkspace?.aging ?? []).map((bucket) => bucket.amount),
    1,
  );
  const topServiceMix = Math.max(
    ...(reportsWorkspace?.serviceMix ?? []).map((item) => item.production),
    1,
  );
  const topPatientSourceMix = Math.max(
    ...(reportsWorkspace?.patientSourceMix ?? []).map((item) => item.patientCount),
    1,
  );
  const topPatientSourceRevenue = Math.max(
    ...(reportsWorkspace?.patientSourceMix ?? []).flatMap((item) => [
      item.production,
      item.collection,
    ]),
    1,
  );
  const summaryMetrics = [
    { label: text.production, value: formatVnd(reportSummary.production), tone: "violet" as const },
    { label: text.collection, value: formatVnd(reportSummary.collection), tone: "green" as const },
    { label: text.openBalance, value: formatVnd(reportSummary.openBalance), tone: "amber" as const },
    { label: text.collectionRatio, value: `${reportSummary.collectionRatio}%`, tone: "teal" as const },
    { label: text.visits, value: String(reportSummary.visits), tone: "blue" as const },
    { label: text.newPatients, value: String(reportSummary.newPatients), tone: "green" as const },
  ];
  const signals = [
    { title: text.overdueInvoices, value: String(reportSummary.overdueInvoices) },
    { title: text.consentRenewals, value: String(sumBy(visibleReports, "consentRenewals")) },
    ...(reportsWorkspace?.signals ?? []).slice(1, 6),
  ];
  const selectedService = reportDrilldown?.kind === "service"
    ? (reportsWorkspace?.serviceMix ?? []).find((item) => item.label === reportDrilldown.key)
    : null;
  const selectedProvider = reportDrilldown?.kind === "provider"
    ? (reportsWorkspace?.providerPerformance ?? []).find((provider) => provider.providerId === reportDrilldown.key)
    : null;
  const selectedSource = reportDrilldown?.kind === "source"
    ? (reportsWorkspace?.patientSourceMix ?? []).find((item) => item.source === reportDrilldown.key)
    : null;
  const filterFrom = searchParams.get("from") ?? reportsWorkspace?.filters.from ?? "";
  const filterTo = searchParams.get("to") ?? reportsWorkspace?.filters.to ?? "";
  const filterClinicId = searchParams.get("clinicId") ?? reportsWorkspace?.filters.clinicId ?? "all";
  const exportParams = new URLSearchParams();

  if (filterFrom) {
    exportParams.set("from", filterFrom);
  }

  if (filterTo) {
    exportParams.set("to", filterTo);
  }

  if (filterClinicId !== "all") {
    exportParams.set("clinicId", filterClinicId);
  }

  const exportHref = `/reports/export${exportParams.size ? `?${exportParams.toString()}` : ""}`;

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">{text.operationalReporting}</p>
          <h2>{text.heading}</h2>
          <span className="toolbar-subtitle">
            {text.period}: {reportsWorkspace?.periodLabel ?? text.monthToDate}
          </span>
        </div>
        <div className="accounting-toolbar-actions">
          <Link className="secondary-button compact-button" href={exportHref}>
            <Download size={14} />
            {text.exportCsv}
          </Link>
          <SourceBadge source={reportsWorkspace?.source} />
        </div>
      </div>

      {reportsWorkspace?.message && (
        <div className="schedule-alert">{workspaceMessageText(reportsWorkspace.message, language)}</div>
      )}

      <p className="module-ai-note">{text.operationalCaveat}</p>

      <form className="reports-filter-bar" action="/reports">
        <label>
          {text.from}
          <input name="from" type="date" defaultValue={filterFrom} />
        </label>
        <label>
          {text.to}
          <input name="to" type="date" defaultValue={filterTo} />
        </label>
        <label>
          {text.clinicScope}
          <select name="clinicId" defaultValue={filterClinicId}>
            <option value="all">{text.allClinics}</option>
            {visibleClinics.map((clinic) => (
              <option value={clinic.id} key={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button compact-button" type="submit">
          {text.filter}
        </button>
      </form>

      <section className="metric-grid reports-summary-grid">
        {summaryMetrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            tone={metric.tone}
          />
        ))}
      </section>

      <section className="content-grid two">
        <section className="panel">
          <PanelHeader
            icon={BarChart3}
            title={text.productionByClinic}
            action={`${text.generated}: ${reportsWorkspace?.generatedAt ?? text.generatedDemo}`}
          />
          <div className="bar-chart">
            {visibleReports.length > 0 ? (
              visibleReports.map((clinic) => (
                <div className="bar-row report-row" key={clinic.clinicId}>
                  <span>
                    <strong>{clinic.name}</strong>
                    <small>{clinic.city}</small>
                  </span>
                  <div>
                    <i
                      style={{
                        width: `${Math.max((clinic.production / topProduction) * 100, 8)}%`,
                      }}
                    />
                  </div>
                  <strong>{formatVnd(clinic.production)}</strong>
                </div>
              ))
            ) : (
              <EmptyState label={text.noData} />
            )}
          </div>
        </section>

        <section className="panel">
          <PanelHeader icon={Activity} title={text.operationalSignals} action={text.live} />
          <div className="record-grid">
            {signals.map((signal) => (
              <RecordTile
                title={signal.title}
                value={signal.value}
                key={signal.title}
              />
            ))}
          </div>
        </section>
      </section>

      <section className="content-grid two">
        <section className="panel">
          <PanelHeader icon={Activity} title={text.trend} action={text.monthToDate} />
          <div className="report-trend">
            {(reportsWorkspace?.trend ?? []).length > 0 ? (
              reportsWorkspace?.trend.map((point) => (
                <div className="report-trend-row" key={point.label}>
                  <span>{point.label}</span>
                  <div>
                    <i
                      className="production"
                      style={{
                        width: `${Math.max((point.production / topTrend) * 100, 4)}%`,
                      }}
                    />
                    <i
                      className="collection"
                      style={{
                        width: `${Math.max((point.collection / topTrend) * 100, 4)}%`,
                      }}
                    />
                  </div>
                  <strong>{point.visits}</strong>
                </div>
              ))
            ) : (
              <EmptyState label={text.noData} />
            )}
          </div>
        </section>

        <section className="panel">
          <PanelHeader icon={WalletCards} title={text.aging} action={text.openBalance} />
          <div className="report-aging-list">
            {(reportsWorkspace?.aging ?? []).length > 0 ? (
              reportsWorkspace?.aging.map((bucket) => (
                <div className="report-aging-row" key={bucket.label}>
                  <span>
                    <strong>{bucket.label}</strong>
                    <small>{bucket.count} {text.count}</small>
                  </span>
                  <div>
                    <i
                      style={{
                        width: `${Math.max((bucket.amount / topAging) * 100, bucket.amount > 0 ? 5 : 0)}%`,
                      }}
                    />
                  </div>
                  <strong>{formatVnd(bucket.amount)}</strong>
                </div>
              ))
            ) : (
              <EmptyState label={text.noData} />
            )}
          </div>
        </section>
      </section>

      <section className="content-grid two">
        <section className="panel">
          <PanelHeader icon={ClipboardList} title={text.serviceMix} action={text.production} />
          <div className="report-service-list">
            {(reportsWorkspace?.serviceMix ?? []).length > 0 ? (
              reportsWorkspace?.serviceMix.map((item) => (
                <button
                  className="report-service-row report-drilldown-row"
                  key={`${item.serviceCode ?? "manual"}-${item.label}`}
                  onClick={() => setReportDrilldown({ kind: "service", key: item.label })}
                  type="button"
                >
                  <span>
                    <strong>{item.label}</strong>
                    <small>
                      {item.serviceCode ?? "-"} · {item.quantity} {text.count}
                    </small>
                  </span>
                  <div>
                    <i
                      style={{
                        width: `${Math.max((item.production / topServiceMix) * 100, 6)}%`,
                      }}
                    />
                  </div>
                  <strong>
                    {formatVnd(item.production)}
                    <small>{formatVnd(item.collected)} {text.collected}</small>
                  </strong>
                </button>
              ))
            ) : (
              <EmptyState label={text.noData} />
            )}
          </div>
        </section>

        <section className="panel">
          <PanelHeader icon={UsersRound} title={text.providerPerformance} action={text.visits} />
          <div className="dashboard-provider-list">
            {(reportsWorkspace?.providerPerformance ?? []).length > 0 ? (
              reportsWorkspace?.providerPerformance.map((provider) => (
                <button
                  className="dashboard-provider-row report-drilldown-row"
                  key={provider.providerId}
                  onClick={() => setReportDrilldown({ kind: "provider", key: provider.providerId })}
                  type="button"
                >
                  <div>
                    <strong>{provider.name}</strong>
                    <span>{displayStatus(provider.role, language)}</span>
                  </div>
                  <span>
                    {provider.completed}/{provider.visits} {text.completed}
                  </span>
                </button>
              ))
            ) : (
              <EmptyState label={text.noData} />
            )}
          </div>
        </section>
      </section>

      <section className="content-grid two">
        <section className="panel">
          <PanelHeader icon={Inbox} title={text.sourceMix} action={text.newPatients} />
          <div className="report-service-list">
            {(reportsWorkspace?.patientSourceMix ?? []).length > 0 ? (
              reportsWorkspace?.patientSourceMix.map((item) => (
                <button
                  className="report-service-row report-drilldown-row"
                  key={item.source}
                  onClick={() => setReportDrilldown({ kind: "source", key: item.source })}
                  type="button"
                >
                  <span>
                    <strong>{item.source}</strong>
                    <small>
                      {item.newPatientCount} {text.newPatients}
                    </small>
                  </span>
                  <div>
                    <i
                      style={{
                        width: `${Math.max((item.patientCount / topPatientSourceMix) * 100, 6)}%`,
                      }}
                    />
                  </div>
                  <strong>{item.patientCount}</strong>
                </button>
              ))
            ) : (
              <EmptyState label={text.noData} />
            )}
          </div>
        </section>

        <section className="panel">
          <PanelHeader icon={BarChart3} title={text.sourceRevenue} action={text.collection} />
          <div className="report-service-list">
            {(reportsWorkspace?.patientSourceMix ?? []).length > 0 ? (
              reportsWorkspace?.patientSourceMix.map((item) => (
                <button
                  className="report-service-row report-drilldown-row"
                  key={`${item.source}-revenue`}
                  onClick={() => setReportDrilldown({ kind: "source", key: item.source })}
                  type="button"
                >
                  <span>
                    <strong>{item.source}</strong>
                    <small>
                      {formatVnd(item.collection)} {text.collected} · {text.sourceRoi}: {item.roiPercent == null ? "-" : `${item.roiPercent}%`}
                    </small>
                  </span>
                  <div>
                    <i
                      style={{
                        width: `${Math.max((item.production / topPatientSourceRevenue) * 100, item.production > 0 ? 6 : 0)}%`,
                      }}
                    />
                  </div>
                  <strong>
                    {formatVnd(item.production)}
                    <small>
                      {text.sourceCost}: {formatVnd(item.manualCost)} · {text.commissionDue}: {formatVnd(item.commissionDue)}
                    </small>
                  </strong>
                </button>
              ))
            ) : (
              <EmptyState label={text.noData} />
            )}
          </div>
        </section>
      </section>

      <section className="content-grid two">
        <section className="panel">
          <PanelHeader icon={BarChart3} title={text.productionByClinic} action={text.chainScope} />
          <div className="record-grid">
            {Array.from(
              visibleReports.reduce((chains, clinic) => {
                const chainName = clinic.chainName ?? text.unassignedChain;
                const current = chains.get(chainName) ?? {
                  production: 0,
                  collection: 0,
                  clinics: 0,
                };
                current.production += clinic.production;
                current.collection += clinic.collection;
                current.clinics += 1;
                chains.set(chainName, current);
                return chains;
              }, new Map<string, { production: number; collection: number; clinics: number }>()),
            ).map(([chainName, chain]) => (
              <RecordTile
                key={chainName}
                title={`${chainName} · ${chain.clinics}`}
                value={`${formatVnd(chain.production)} / ${formatVnd(chain.collection)}`}
              />
            ))}
          </div>
        </section>
      </section>

      {reportDrilldown && (
        <div
          className="progress-modal-backdrop"
          onClick={() => setReportDrilldown(null)}
          role="presentation"
        >
          <div
            className="progress-modal report-drilldown-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={text.drilldown}
          >
            <div className="progress-modal-header">
              <span>{text.drilldown}</span>
              <h3>
                {selectedService?.label ??
                  selectedProvider?.name ??
                  selectedSource?.source ??
                  text.details}
              </h3>
              <button
                aria-label={text.close}
                className="icon-button"
                onClick={() => setReportDrilldown(null)}
                type="button"
              >
                <X size={16} />
              </button>
            </div>
            <div className="record-grid">
              {selectedService && (
                <>
                  <RecordTile title={text.serviceDrilldown} value={selectedService.serviceCode ?? "-"} />
                  <RecordTile title={text.count} value={String(selectedService.quantity)} />
                  <RecordTile title={text.production} value={formatVnd(selectedService.production)} />
                  <RecordTile title={text.collection} value={formatVnd(selectedService.collected)} />
                  <RecordTile
                    title={text.collectionRatio}
                    value={
                      selectedService.production > 0
                        ? `${Math.round((selectedService.collected / selectedService.production) * 100)}%`
                        : "0%"
                    }
                  />
                </>
              )}
              {selectedProvider && (
                <>
                  <RecordTile title={text.providerDrilldown} value={displayStatus(selectedProvider.role, language)} />
                  <RecordTile title={text.visits} value={String(selectedProvider.visits)} />
                  <RecordTile title={text.completed} value={String(selectedProvider.completed)} />
                  <RecordTile
                    title={text.collectionRatio}
                    value={
                      selectedProvider.visits > 0
                        ? `${Math.round((selectedProvider.completed / selectedProvider.visits) * 100)}%`
                        : "0%"
                    }
                  />
                </>
              )}
              {selectedSource && (
                <>
                  <RecordTile title={text.sourceDrilldown} value={selectedSource.source} />
                  <RecordTile title={text.newPatients} value={String(selectedSource.newPatientCount)} />
                  <RecordTile title={text.production} value={formatVnd(selectedSource.production)} />
                  <RecordTile title={text.collection} value={formatVnd(selectedSource.collection)} />
                  <RecordTile title={text.sourceCost} value={formatVnd(selectedSource.manualCost)} />
                  <RecordTile title={text.commissionDue} value={formatVnd(selectedSource.commissionDue)} />
                  <RecordTile
                    title={text.sourceRoi}
                    value={selectedSource.roiPercent == null ? "-" : `${selectedSource.roiPercent}%`}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="panel">
        <PanelHeader icon={WalletCards} title={text.reportTable} action={text.daily} />
        <div className="report-table">
          {visibleReports.length > 0 ? (
            visibleReports.map((clinic) => (
              <div className="report-table-row" key={clinic.clinicId}>
                <strong>{clinic.name}</strong>
                <span>
                  {clinic.todayVisits} {text.visits}
                </span>
                <span>
                  {formatVnd(clinic.collection)} {text.collected}
                </span>
                <span>
                  {formatVnd(clinic.openBalance)} {text.open}
                </span>
                <span>
                  {clinic.overdueInvoices} {text.overdue}
                </span>
                <span>
                  {clinic.consentRenewals} {text.consentRenewals}
                </span>
              </div>
            ))
          ) : (
            <EmptyState label={text.noData} />
          )}
        </div>
      </section>
    </section>
  );
}

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { language } = useAppLanguage();
  const text = reportsText[language];

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? text.databaseLive : text.demoMode}
    </span>
  );
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

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();

  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}

function displayStatus(status: string, language: Language) {
  return reportStatusText[language][status] ?? status;
}

function sumBy<T extends Record<K, number>, K extends keyof T>(items: T[], key: K) {
  return items.reduce((total, item) => total + item[key], 0);
}

function collectionRatio(clinics: Array<{ production: number; collection: number }>) {
  const production = clinics.reduce((total, clinic) => total + clinic.production, 0);
  const collection = clinics.reduce((total, clinic) => total + clinic.collection, 0);

  return production > 0 ? Math.round((collection / production) * 100) : 0;
}
