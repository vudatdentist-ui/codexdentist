"use client";

import { CheckCircle2, FileText, Smartphone } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  acceptPortalTreatmentAction,
  confirmPortalAppointmentAction,
  payPortalInvoiceAction,
  renewPortalConsentAction,
} from "@/app/(app)/patient-app/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, PanelHeader, RecordTile, StatusPill } from "@/components/suite-primitives";
import { formatVnd } from "@/lib/data";
import type { PatientPortalWorkspace } from "@/lib/patient-portal-types";

const portalText = {
  vi: {
    acceptPlan: "Đồng ý kế hoạch",
    appointments: "Lịch hẹn",
    balance: "Công nợ",
    confirm: "Xác nhận",
    consent: "Đồng ý",
    dataTitle: "Dữ liệu cổng bệnh nhân",
    databaseLive: "",
    demoMode: "",
    emptyPatient: "Chưa liên kết hồ sơ bệnh nhân",
    files: "Tệp bệnh án",
    greeting: "Chào",
    heading: "Lịch hẹn, điều trị, đồng ý, thanh toán",
    mobileAria: "Xem trước ứng dụng bệnh nhân",
    mobileFlow: "Luồng ứng dụng bệnh nhân",
    noAppointmentPrefix: "Hồ sơ của bạn đang hoạt động tại",
    noServices: "Chưa có dịch vụ điều trị",
    notLinked: "Chưa liên kết",
    openInvoices: "Hóa đơn mở",
    patient: "Bệnh nhân",
    patientPortal: "Cổng bệnh nhân",
    pay: "Thanh toán",
    serviceProgress: "Tiến độ dịch vụ",
    services: "Dịch vụ",
    synced: "Đã đồng bộ",
    treatmentPlan: "Kế hoạch điều trị",
    treatmentPlans: "Kế hoạch điều trị",
    unknown: "Chưa rõ",
  },
  en: {
    acceptPlan: "Accept plan",
    appointments: "Appointments",
    balance: "Balance",
    confirm: "Confirm",
    consent: "Consent",
    dataTitle: "Patient portal data",
    databaseLive: "",
    demoMode: "",
    emptyPatient: "No linked patient profile",
    files: "Patient files",
    greeting: "Hi",
    heading: "Appointments, treatment, consent, payments",
    mobileAria: "Patient mobile app preview",
    mobileFlow: "Patient mobile flow",
    noAppointmentPrefix: "Your profile is active at",
    noServices: "No treatment services yet",
    notLinked: "Not linked",
    openInvoices: "Open invoices",
    patient: "Patient",
    patientPortal: "Patient portal",
    pay: "Pay",
    serviceProgress: "Service progress",
    services: "Services",
    synced: "Synced",
    treatmentPlan: "Treatment plan",
    treatmentPlans: "Treatment plans",
    unknown: "Unknown",
  },
} satisfies Record<Language, Record<string, string>>;

const noticeText: Record<string, Record<Language, string>> = {
  "portal-appointment-confirmed": {
    vi: "Đã xác nhận lịch hẹn.",
    en: "Appointment confirmed.",
  },
  "portal-invoice-paid": {
    vi: "Đã thanh toán hóa đơn.",
    en: "Invoice paid.",
  },
  "portal-plan-accepted": {
    vi: "Đã chấp nhận kế hoạch điều trị.",
    en: "Treatment plan accepted.",
  },
  "portal-consent-renewed": {
    vi: "Đã gia hạn đồng ý.",
    en: "Consent renewed.",
  },
  "portal-appointment-not-found": {
    vi: "Không tìm thấy lịch hẹn của bệnh nhân này.",
    en: "The appointment could not be found for this patient.",
  },
  "portal-invoice-not-found": {
    vi: "Không tìm thấy hóa đơn của bệnh nhân này.",
    en: "The invoice could not be found for this patient.",
  },
  "portal-plan-not-found": {
    vi: "Không tìm thấy kế hoạch điều trị của bệnh nhân này.",
    en: "The treatment plan could not be found for this patient.",
  },
  "portal-patient-not-found": {
    vi: "Không tìm thấy hồ sơ bệnh nhân cho tài khoản này.",
    en: "The patient profile could not be found for this account.",
  },
  "portal-database": {
    vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.",
    en: "The change could not be saved. Please try again.",
  },
};

export function PatientAppPanel({
  patientPortalWorkspace,
}: {
  patientPortalWorkspace?: PatientPortalWorkspace | null;
}) {
  const { language } = useAppLanguage();
  const text = portalText[language];
  const searchParams = useSearchParams();
  const notice = noticeFor(visibleActionNoticeParam(searchParams.get("notice")), language);
  const patient = patientPortalWorkspace?.patient ?? null;
  const appointments = patientPortalWorkspace?.appointments ?? [];
  const invoices = patientPortalWorkspace?.invoices ?? [];
  const treatmentPlans = patientPortalWorkspace?.treatmentPlans ?? [];
  const patientFiles = patientPortalWorkspace?.patientFiles ?? [];
  const treatmentServices = patientPortalWorkspace?.treatmentServices ?? [];
  const nextAppointment = appointments.find(
    (appointment) => appointment.status !== "Cancelled" && appointment.status !== "Completed",
  );
  const openInvoice = invoices.find(
    (invoice) => invoice.status !== "Paid" && invoice.status !== "Void",
  );
  const activePlan =
    treatmentPlans.find((plan) => plan.status !== "Completed") ?? treatmentPlans[0];
  const activeService =
    treatmentServices.find(
      (service) => service.status !== "Completed" && service.status !== "Cancelled",
    ) ?? treatmentServices[0];
  const canMutate = patientPortalWorkspace?.canMutate ?? false;

  return (
    <section className="view-stack mobile-app-view patient-mobile-view">
      <div className="toolbar mobile-app-toolbar">
        <div>
          <p className="eyebrow">{text.patientPortal}</p>
          <h2>{text.heading}</h2>
        </div>
        <SourceBadge source={patientPortalWorkspace?.source} />
      </div>

      {(patientPortalWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(patientPortalWorkspace?.message, language)}
        </div>
      )}

      <section className="content-grid portal-layout mobile-app-grid">
        <section className="panel">
          <PanelHeader icon={Smartphone} title={text.mobileFlow} action="Live" />
          {patient ? (
            <div className="phone-frame" aria-label={text.mobileAria}>
              <div className="phone-top">
                <span className="phone-brand">
                  <img src="/icons/codexmed-icon.svg" alt="" aria-hidden="true" />
              <span>Codexdentist</span>
                </span>
                <CheckCircle2 size={16} />
              </div>
              <strong>
                {text.greeting} {patient.name.split(" ").slice(-2).join(" ")}
              </strong>
              <p>
                {nextAppointment
                  ? `${nextAppointment.procedure} at ${patient.clinic} on ${nextAppointment.time}.`
                  : `${text.noAppointmentPrefix} ${patient.clinic}.`}
              </p>
              <div className="mobile-actions">
                {nextAppointment ? (
                  <form action={confirmPortalAppointmentAction}>
                    <input name="appointmentId" type="hidden" value={nextAppointment.id} />
                    <button type="submit" disabled={!canMutate}>
                      {text.confirm}
                    </button>
                  </form>
                ) : (
                  <button type="button" disabled>
                    {text.confirm}
                  </button>
                )}
                <form action={renewPortalConsentAction}>
                  <input name="patientId" type="hidden" value={patient.id} />
                  <button type="submit" disabled={!canMutate}>
                    {text.consent}
                  </button>
                </form>
                {openInvoice ? (
                  <form action={payPortalInvoiceAction}>
                    <input name="invoiceNo" type="hidden" value={openInvoice.id} />
                    <button type="submit" disabled={!canMutate}>
                      {text.pay}
                    </button>
                  </form>
                ) : (
                  <button type="button" disabled>
                    {text.pay}
                  </button>
                )}
              </div>
              {activePlan && (
                <div className="mobile-card">
                  <span>{text.treatmentPlan}</span>
                  <strong>{activePlan.title}</strong>
                  <small>
                    {formatVnd(activePlan.patientShare)} - {activePlan.status}
                  </small>
                  {activePlan.status === "Presented" && (
                    <form action={acceptPortalTreatmentAction}>
                      <input name="planId" type="hidden" value={activePlan.id} />
                      <button type="submit" disabled={!canMutate}>
                        {text.acceptPlan}
                      </button>
                    </form>
                  )}
                </div>
              )}
              {activeService && (
                <div className="mobile-card">
                  <span>{text.serviceProgress}</span>
                  <strong>
                    {formatServiceInstanceCode(activeService.serviceCode)} · {activeService.serviceName}
                  </strong>
                  <small>
                    {Math.round(activeService.currentProgressPercent)}% ·{" "}
                    {displayStatus(activeService.status, language)}
                  </small>
                  <div
                    className="journey-service-progress"
                    role="progressbar"
                    aria-valuenow={Math.round(activeService.currentProgressPercent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span className="journey-service-progress-track">
                      <i
                        className="journey-service-progress-fill"
                        style={{
                          width: `${Math.min(
                            Math.max(activeService.currentProgressPercent, 0),
                            100,
                          )}%`,
                        }}
                      />
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState label={text.emptyPatient} />
          )}
        </section>

        <section className="panel">
          <PanelHeader icon={FileText} title={text.dataTitle} action={text.synced} />
          <div className="portal-list">
            <RecordTile title={text.patient} value={patient?.name ?? text.notLinked} />
            <RecordTile
              title={text.consent}
              value={patient?.consent ? displayStatus(patient.consent, language) : text.unknown}
            />
            <RecordTile title={text.appointments} value={String(appointments.length)} />
            <RecordTile
              title={text.openInvoices}
              value={String(
                invoices.filter(
                  (invoice) => invoice.status !== "Paid" && invoice.status !== "Void",
                ).length,
              )}
            />
            <RecordTile title={text.treatmentPlans} value={String(treatmentPlans.length)} />
            <RecordTile title={text.services} value={String(treatmentServices.length)} />
            <RecordTile title={text.files} value={String(patientFiles.length)} />
            <RecordTile
              title={text.balance}
              value={formatVnd(
                invoices.reduce(
                  (total, invoice) => total + invoice.amount - (invoice.paidAmount ?? 0),
                  0,
                ),
              )}
            />
          </div>

          <div className="portal-data-list">
            {appointments.slice(0, 3).map((appointment) => (
              <div className="portal-row" key={appointment.id}>
                <span>{appointment.time}</span>
                <strong>{appointment.procedure}</strong>
                <StatusPill status={appointment.status} />
              </div>
            ))}
            {invoices.slice(0, 3).map((invoice) => (
              <div className="portal-row" key={invoice.id}>
                <span>{invoice.id}</span>
                <strong>{formatVnd(invoice.amount - (invoice.paidAmount ?? 0))}</strong>
                <StatusPill status={invoice.status} />
              </div>
            ))}
            {treatmentServices.slice(0, 4).map((service) => (
              <div className="portal-row" key={service.id}>
                <span>{formatServiceInstanceCode(service.serviceCode)}</span>
                <strong>
                  {service.serviceName} · {Math.round(service.currentProgressPercent)}%
                </strong>
                <StatusPill status={service.status} />
              </div>
            ))}
            {patientFiles.slice(0, 4).map((file) => (
              <div className="portal-row" key={file.id}>
                <span>{file.createdAt}</span>
                <strong>
                  <a href={file.url} target="_blank" rel="noreferrer">
                    {file.title}
                  </a>
                </strong>
                <StatusPill status={file.category} />
              </div>
            ))}
            {appointments.length === 0 &&
              invoices.length === 0 &&
              treatmentServices.length === 0 &&
              patientFiles.length === 0 && <EmptyState label={text.noServices} />}
          </div>
        </section>
      </section>
    </section>
  );
}

function noticeFor(notice: string | null, language: Language) {
  if (!notice) {
    return null;
  }

  return noticeText[notice]?.[language] ?? null;
}

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { language } = useAppLanguage();
  const text = portalText[language];

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
    "Tài khoản này chưa được liên kết với hồ sơ bệnh nhân.":
      "Chưa có dữ liệu trong phạm vi hiện tại.",
  };

  return viMessages[message] ?? message;
}

function displayStatus(status: string, language: Language) {
  const labels: Record<string, string> =
    language === "vi"
      ? {
          Accepted: "Đã đồng ý",
          ACCEPTED: "Đã đồng ý",
          Cancelled: "Đã hủy",
          Completed: "Hoàn tất",
          Confirmed: "Đã xác nhận",
          CONFIRMED: "Đã xác nhận",
          Granted: "Đã đồng ý",
          GRANTED: "Đã đồng ý",
          Paid: "Đã thanh toán",
          PAID: "Đã thanh toán",
          Partial: "Một phần",
          PARTIAL: "Một phần",
          Presented: "Đã tư vấn",
          Void: "Đã hủy",
        }
      : {};

  return labels[status] ?? status;
}

function formatServiceInstanceCode(serviceCode: string) {
  const match = serviceCode.match(/^([A-Z]+)(\d+)$/);

  if (!match) {
    return serviceCode;
  }

  return `${match[1]}${match[2].padStart(2, "0")}`;
}
