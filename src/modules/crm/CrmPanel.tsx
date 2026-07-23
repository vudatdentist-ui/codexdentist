"use client";

import { Bell, Inbox, MessageSquareText, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  addCrmActivityAction,
  convertCrmLeadToPatientAction,
  createCrmLeadAction,
  generateCrmRecallTasksAction,
  updateCrmLeadStatusAction,
} from "@/app/(app)/crm/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, MetricCard, PanelHeader, RecordTile, StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import type { CrmWorkspace } from "@/lib/crm-types";
import type { PatientWorkspace } from "@/lib/patient-types";

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { t } = useAppLanguage();

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? t.databaseLive : t.demoMode}
    </span>
  );
}

function workspaceMessageText(message: string | null | undefined, language: Language) {
  if (!message || language !== "vi") {
    return message;
  }

  const viMessages: Record<string, string> = {
    "Chưa tải được dữ liệu. Vui lòng thử lại sau.":
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
  };

  return viMessages[message] ?? message;
}

function noticeText(notice: string | null, language: Language) {
  const notices: Record<string, Record<Language, string>> = {
    "crm-lead-created": { vi: "Đã tạo lead CRM.", en: "CRM lead created." },
    "crm-activity-created": { vi: "Đã tạo hoạt động CRM.", en: "CRM activity created." },
    "crm-lead-updated": { vi: "Đã cập nhật trạng thái lead CRM.", en: "CRM lead status updated." },
    "crm-lead-converted": { vi: "Đã chuyển hoặc liên kết lead với bệnh nhân.", en: "CRM lead converted or linked to a patient." },
    "crm-lead-phone-required": { vi: "Cần số điện thoại trước khi chuyển lead thành bệnh nhân.", en: "A phone number is required before converting a CRM lead to a patient." },
    "crm-recalls-generated": { vi: "Đã tạo task recall từ dịch vụ điều trị đang mở.", en: "Recall tasks generated from open patient treatment services." },
    "crm-denied": { vi: "Tài khoản này không thể thay đổi hồ sơ CRM.", en: "This role cannot change CRM records." },
    "crm-missing": { vi: "Điền đủ trường CRM bắt buộc.", en: "Complete the required CRM fields." },
    "crm-patient-not-found": { vi: "Không tìm thấy bệnh nhân hoặc lead CRM.", en: "The CRM patient or lead could not be found." },
    "crm-database": { vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.", en: "The change could not be saved. Please try again." },
  };

  return notice ? notices[notice]?.[language] ?? null : null;
}

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();

  return noticeText(notice, language);
}

function displayStatus(status: string, language: Language) {
  const viStatus: Record<string, string> = {
    NEW: "Mới",
    CONTACTED: "Đã liên hệ",
    CONSULT_BOOKED: "Đã đặt tư vấn",
    VISITED: "Đã đến",
    CONVERTED: "Đã chuyển đổi",
    LOST: "Mất lead",
    RECALL: "Recall",
    CALL: "Gọi điện",
    ZALO: "Zalo",
    SMS: "SMS",
    EMAIL: "Email",
    NOTE: "Ghi chú",
    TASK: "Công việc",
    VISIT: "Đến khám",
    FOLLOW_UP: "Chăm sóc lại",
    PHONE: "Điện thoại",
    PUSH: "Push",
    IN_APP: "Trong app",
  };

  return language === "vi" ? viStatus[status] ?? status : status;
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();

  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}

export function CrmPanel({
  crmWorkspace,
  patientWorkspace,
  visibleClinicIds,
}: {
  crmWorkspace?: CrmWorkspace | null;
  patientWorkspace?: PatientWorkspace | null;
  visibleClinicIds: Set<string>;
}) {
  const { language } = useAppLanguage();
  const searchParams = useSearchParams();
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const canMutate = crmWorkspace?.canMutate ?? false;
  const patients = (
    crmWorkspace?.patients ??
    patientWorkspace?.patients.map((patient) => ({
      id: patient.id,
      name: patient.name,
      phone: patient.phone,
      clinicId: patient.clinicId,
    })) ??
    []
  ).filter((patient) => visibleClinicIds.has(patient.clinicId));
  const leads = (crmWorkspace?.leads ?? []).filter(
    (lead) => !lead.clinicId || visibleClinicIds.has(lead.clinicId),
  );
  const activities = (crmWorkspace?.activities ?? []).filter(
    (activity) => !activity.clinicId || visibleClinicIds.has(activity.clinicId),
  );
  const labels =
    language === "vi"
      ? {
          heading: "CSKH, lead, recall và lịch chăm sóc",
          createLead: "Tạo lead",
          addActivity: "Thêm hoạt động",
          leads: "Lead CSKH",
          activities: "Hoạt động",
          patient: "Bệnh nhân",
          name: "Tên",
          phone: "Điện thoại",
          source: "Nguồn",
          campaign: "Chiến dịch",
          followUp: "Ngày chăm sóc tiếp",
          subject: "Nội dung",
          body: "Ghi chú",
          cancel: "Hủy",
          status: "Trạng thái",
          close: "Đóng",
          save: "Lưu",
          empty: "Chưa có dữ liệu CSKH",
          recall: "Recall",
          recallConfirm:
            "Tạo task recall tự động từ dịch vụ điều trị chưa hoàn tất? Hệ thống sẽ bỏ qua bệnh nhân đã có lịch hẹn hoặc recall mở.",
          open: "Đang mở",
          lead: "Lead",
          task: "Công việc",
          newLead: "Lead mới",
          none: "Không có",
          type: "Loại",
          channel: "Kênh",
          completed: "Đã hoàn tất",
          convertConfirm:
            "Chuyển lead này thành hồ sơ bệnh nhân? Nếu số điện thoại đã tồn tại, hệ thống sẽ liên kết lead với bệnh nhân đó.",
          convertLead: "Chuyển thành bệnh nhân",
          followUpQueue: "Việc chăm sóc cần làm",
          generateRecalls: "Tạo recall tự động",
          channelCaveat:
            "Chỉ ghi nhận hoạt động CSKH khi bệnh nhân đã đồng ý kênh liên hệ phù hợp; gửi SMS/Zalo/email thật cần cấu hình provider và chính sách opt-out.",
          queueTab: "Cần chăm sóc",
          leadsTab: "Lead",
          activitiesTab: "Lịch sử hoạt động",
        }
      : {
          heading: "CRM, leads, recalls, and follow-up work",
          createLead: "Create lead",
          addActivity: "Add activity",
          leads: "CRM leads",
          activities: "Activities",
          patient: "Patient",
          name: "Name",
          phone: "Phone",
          source: "Source",
          campaign: "Campaign",
          followUp: "Next follow-up",
          subject: "Subject",
          body: "Notes",
          cancel: "Cancel",
          status: "Status",
          close: "Close",
          save: "Save",
          empty: "No CRM records yet",
          recall: "Recall",
          recallConfirm:
            "Generate recall tasks from unfinished treatment services? Patients with a future appointment or open recall will be skipped.",
          open: "Open",
          lead: "Lead",
          task: "Task",
          newLead: "New lead",
          none: "None",
          type: "Type",
          channel: "Channel",
          completed: "Completed",
          convertConfirm:
            "Convert this lead to a patient record? If the phone already exists, the lead will be linked to that patient.",
          convertLead: "Convert to patient",
          followUpQueue: "Follow-up queue",
          generateRecalls: "Generate recalls",
          channelCaveat:
            "Record CRM outreach only when the patient has consented to the channel; real SMS/Zalo/email delivery requires provider setup and opt-out policy.",
          queueTab: "Follow-up",
          leadsTab: "Leads",
          activitiesTab: "Activity history",
        };
  const [crmModal, setCrmModal] = useState<"lead" | "activity" | null>(null);
  const [crmSection, setCrmSection] = useState<"queue" | "leads" | "activities">("queue");
  const openActivities = [...activities]
    .filter((activity) => !activity.completedAt)
    .sort(
      (left, right) =>
        Date.parse(left.dueAtIso ?? left.createdAtIso) -
        Date.parse(right.dueAtIso ?? right.createdAtIso),
    );
  const crmSectionTabs = [
    { key: "queue", label: labels.queueTab, count: openActivities.length },
    { key: "leads", label: labels.leadsTab, count: leads.length },
    { key: "activities", label: labels.activitiesTab, count: activities.length },
  ] as const;

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">CRM</p>
          <h2>{labels.heading}</h2>
        </div>
        <div className="invoice-actions">
          <form
            action={generateCrmRecallTasksAction}
            onSubmit={(event) => {
              if (!window.confirm(labels.recallConfirm)) {
                event.preventDefault();
              }
            }}
          >
            <button type="submit" disabled={!canMutate}>
              <Bell size={16} />
              {labels.generateRecalls}
            </button>
          </form>
          <SourceBadge source={crmWorkspace?.source} />
        </div>
      </div>

      {(crmWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(crmWorkspace?.message, language)}
        </div>
      )}

      <div className="schedule-alert">
        {labels.channelCaveat}
      </div>

      <div className="metric-grid">
        <MetricCard label={labels.leads} value={String(leads.length)} tone="blue" />
        <MetricCard
          label={labels.recall}
          value={String(leads.filter((lead) => lead.status === "RECALL").length)}
          tone="teal"
        />
        <MetricCard label={labels.activities} value={String(activities.length)} tone="green" />
        <MetricCard
          label={labels.open}
          value={String(activities.filter((activity) => !activity.completedAt).length)}
          tone="violet"
        />
      </div>

      <div className="service-action-row">
        <button
          className="primary-button"
          type="button"
          disabled={!canMutate}
          onClick={() => setCrmModal("lead")}
        >
          <Inbox size={16} />
          {labels.createLead}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!canMutate}
          onClick={() => setCrmModal("activity")}
        >
          <MessageSquareText size={16} />
          {labels.addActivity}
        </button>
      </div>

      <nav className="crm-section-tabs" aria-label={labels.heading}>
        {crmSectionTabs.map((tab) => (
          <button
            className={crmSection === tab.key ? "active" : ""}
            key={tab.key}
            type="button"
            onClick={() => setCrmSection(tab.key)}
          >
            {tab.label}
            <span>{tab.count}</span>
          </button>
        ))}
      </nav>

      {crmModal === "lead" && (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={labels.createLead}
          onClick={() => setCrmModal(null)}
        >
          <form
            action={createCrmLeadAction}
            className="progress-modal crm-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={() => setCrmModal(null)}
          >
            <div className="progress-modal-header">
              <div>
                <span>{labels.lead}</span>
                <h3>{labels.createLead}</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setCrmModal(null)}
                aria-label={labels.close}
              >
                <X size={18} />
              </button>
            </div>
            <div className="progress-modal-grid modal-form-grid">
            <label>
              {labels.patient}
              <select name="patientId" disabled={!canMutate}>
                <option value="">{labels.newLead}</option>
                {patients.map((patient) => (
                  <option value={patient.id} key={patient.id}>
                    {patient.name} - {patient.phone ?? "-"}
                  </option>
                ))}
              </select>
            </label>
            <input name="clinicId" type="hidden" value="all" />
            <label>
              {labels.name}
              <input name="name" disabled={!canMutate} required />
            </label>
            <label>
              {labels.phone}
              <input name="phone" disabled={!canMutate} />
            </label>
            <label>
              {labels.source}
              <input name="source" placeholder="Facebook, referral, walk-in" disabled={!canMutate} />
            </label>
            <label>
              {labels.campaign}
              <input name="campaignName" disabled={!canMutate} />
            </label>
            <label>
              {labels.followUp}
              <input name="nextFollowUpAt" type="date" disabled={!canMutate} />
            </label>
            <label className="clinical-wide">
              {labels.body}
              <textarea name="note" disabled={!canMutate} />
            </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setCrmModal(null)}>
                {labels.cancel}
              </button>
            <button className="primary-button" type="submit" disabled={!canMutate}>
              <Inbox size={16} />
              {labels.createLead}
            </button>
            </div>
          </form>
        </div>
      )}

      {crmModal === "activity" && (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={labels.addActivity}
          onClick={() => setCrmModal(null)}
        >
          <form
            action={addCrmActivityAction}
            className="progress-modal crm-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={() => setCrmModal(null)}
          >
            <div className="progress-modal-header">
              <div>
                <span>{labels.task}</span>
                <h3>{labels.addActivity}</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setCrmModal(null)}
                aria-label={labels.close}
              >
                <X size={18} />
              </button>
            </div>
            <div className="progress-modal-grid modal-form-grid">
            <label>
              {labels.lead}
              <select name="leadId" disabled={!canMutate}>
                <option value="">{labels.none}</option>
                {leads.map((lead) => (
                  <option value={lead.id} key={lead.id}>
                    {lead.name} - {displayStatus(lead.status, language)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.patient}
              <select name="patientId" disabled={!canMutate}>
                <option value="">{labels.none}</option>
                {patients.map((patient) => (
                  <option value={patient.id} key={patient.id}>
                    {patient.name} - {patient.phone ?? "-"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.type}
              <select name="type" disabled={!canMutate} defaultValue="CALL">
                <option value="CALL">{displayStatus("CALL", language)}</option>
                <option value="ZALO">{displayStatus("ZALO", language)}</option>
                <option value="SMS">{displayStatus("SMS", language)}</option>
                <option value="EMAIL">{displayStatus("EMAIL", language)}</option>
                <option value="NOTE">{displayStatus("NOTE", language)}</option>
                <option value="TASK">{displayStatus("TASK", language)}</option>
                <option value="FOLLOW_UP">{displayStatus("FOLLOW_UP", language)}</option>
              </select>
            </label>
            <label>
              {labels.channel}
              <select name="channel" disabled={!canMutate} defaultValue="PHONE">
                <option value="PHONE">{displayStatus("PHONE", language)}</option>
                <option value="ZALO">{displayStatus("ZALO", language)}</option>
                <option value="SMS">{displayStatus("SMS", language)}</option>
                <option value="EMAIL">{displayStatus("EMAIL", language)}</option>
                <option value="IN_APP">{displayStatus("IN_APP", language)}</option>
              </select>
            </label>
            <label>
              {labels.subject}
              <input name="subject" disabled={!canMutate} required />
            </label>
            <label>
              {labels.followUp}
              <input name="dueAt" type="date" disabled={!canMutate} />
            </label>
            <label className="clinical-wide">
              {labels.body}
              <textarea name="body" disabled={!canMutate} />
            </label>
            <label>
              <input name="completed" type="checkbox" disabled={!canMutate} />
              {labels.completed}
            </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setCrmModal(null)}>
                {labels.cancel}
              </button>
            <button className="primary-button" type="submit" disabled={!canMutate}>
              <MessageSquareText size={16} />
              {labels.addActivity}
            </button>
            </div>
          </form>
        </div>
      )}

      {crmSection === "queue" && (
      <section className="content-grid service-management-grid">
        <section className="panel">
          <PanelHeader icon={Bell} title={labels.followUpQueue} action={`${openActivities.length}`} />
          <div className="record-grid">
            {openActivities.length > 0 ? (
              openActivities.slice(0, 8).map((activity) => (
                <RecordTile
                  key={activity.id}
                  title={`${displayStatus(activity.type, language)} · ${activity.subject}`}
                  value={`${activity.actorName ?? "-"} · ${
                    activity.dueAt ?? activity.createdAt
                  }`}
                />
              ))
            ) : (
              <EmptyState label={labels.empty} />
            )}
          </div>
        </section>
      </section>
      )}

      {crmSection === "leads" && (
      <section className="content-grid service-management-grid">
        <section className="panel">
          <PanelHeader icon={Inbox} title={labels.leads} action={`${leads.length}`} />
          <div className="invoice-list">
            {leads.length > 0 ? (
              leads.map((lead) => (
                <div className="invoice-row billing-invoice-row" key={lead.id}>
                  <div>
                    <strong>{lead.name}</strong>
                    <span>
                      {lead.phone ?? "-"} · {lead.source ?? "-"} · {lead.campaignName ?? "-"}
                    </span>
                    <small>{lead.nextFollowUpAt ?? lead.createdAt}</small>
                  </div>
                  <StatusPill status={lead.status} />
                  <form action={updateCrmLeadStatusAction}>
                    <input name="leadId" type="hidden" value={lead.id} />
                    <select name="status" defaultValue={lead.status} disabled={!canMutate}>
                      <option value="NEW">{displayStatus("NEW", language)}</option>
                      <option value="CONTACTED">{displayStatus("CONTACTED", language)}</option>
                      <option value="CONSULT_BOOKED">{displayStatus("CONSULT_BOOKED", language)}</option>
                      <option value="VISITED">{displayStatus("VISITED", language)}</option>
                      <option value="CONVERTED">{displayStatus("CONVERTED", language)}</option>
                      <option value="RECALL">{displayStatus("RECALL", language)}</option>
                      <option value="LOST">{displayStatus("LOST", language)}</option>
                    </select>
                    <button type="submit" disabled={!canMutate}>
                      {labels.save}
                    </button>
                  </form>
                  {!lead.patientId && lead.status !== "CONVERTED" && (
                    <form
                      action={convertCrmLeadToPatientAction}
                      onSubmit={(event) => {
                        if (!window.confirm(labels.convertConfirm)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input name="leadId" type="hidden" value={lead.id} />
                      <button type="submit" disabled={!canMutate || !lead.phone}>
                        {labels.convertLead}
                      </button>
                    </form>
                  )}
                </div>
              ))
            ) : (
              <EmptyState label={labels.empty} />
            )}
          </div>
        </section>
      </section>
      )}

      {crmSection === "activities" && (
      <section className="content-grid service-management-grid">
        <section className="panel">
          <PanelHeader icon={MessageSquareText} title={labels.activities} action={`${activities.length}`} />
          <div className="record-grid">
            {activities.length > 0 ? (
              activities.slice(0, 12).map((activity) => (
                <RecordTile
                  key={activity.id}
                  title={`${displayStatus(activity.type, language)} · ${activity.subject}`}
                  value={`${activity.actorName ?? "-"} · ${
                    activity.completedAt ?? activity.dueAt ?? activity.createdAt
                  }`}
                />
              ))
            ) : (
              <EmptyState label={labels.empty} />
            )}
          </div>
        </section>
      </section>
      )}

    </section>
  );
}

