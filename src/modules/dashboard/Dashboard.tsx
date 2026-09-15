"use client";

import { Activity, Building2, CalendarDays, CheckCircle2, Inbox, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { completeWorkItemAction, createWorkItemAction, retryFailedNotificationAction } from "@/app/(app)/dashboard/actions";
import { createInAppNotificationAction } from "@/app/(app)/notifications/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, MetricCard, PanelHeader, StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import { formatVnd, type Appointment, type Clinic } from "@/lib/data";
import type { DashboardWorkspace } from "@/lib/dashboard-types";
import type { TaskInboxWorkspace } from "@/lib/task-inbox-types";

const dashboardText = {
  vi: {
    chairUtilization: "Hiệu suất ghế",
    chairs: "ghế",
    collected: "Đã thu",
    compare: "So sánh",
    liveAppointmentFlow: "Luồng lịch hẹn hôm nay",
    open: "Mở",
    production: "Doanh thu",
    todayVisits: "Lượt hẹn hôm nay",
    visits: "lượt hẹn",
  },
  en: {
    chairUtilization: "Chair utilization",
    chairs: "chairs",
    collected: "Collected",
    compare: "Compare",
    liveAppointmentFlow: "Live appointment flow",
    open: "Open",
    production: "Production",
    todayVisits: "Today's visits",
    visits: "visits",
  },
};

const statusText: Record<Language, Record<string, string>> = {
  vi: {
    high: "Cao",
    medium: "Trung bình",
    low: "Thấp",
    notification: "Thông báo",
    work_item: "Công việc",
    DENTIST: "Nha sĩ",
    HYGIENIST: "Điều dưỡng",
    FRONT_DESK: "Lễ tân",
    BILLING: "Thu ngân",
    OWNER: "Chủ hệ thống",
    AREA_MANAGER: "Quản lý khu vực",
    CLINIC_MANAGER: "Quản lý phòng khám",
    Confirmed: "Đã xác nhận",
    Arrived: "Đã đến",
    "In chair": "Đang trên ghế",
    Completed: "Hoàn tất",
    Cancelled: "Đã hủy",
    "No-show": "Không đến",
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
    "task-created": { vi: "Đã tạo công việc.", en: "Task created." },
    "task-completed": { vi: "Đã hoàn tất công việc.", en: "Task completed." },
    "notification-sent": { vi: "Đã gửi thông báo.", en: "Notification sent." },
    "notification-target-missing": { vi: "Chọn ít nhất một nhóm hoặc người nhận.", en: "Choose at least one target." },
    "notification-missing": { vi: "Nhập đủ tiêu đề và nội dung thông báo.", en: "Enter notification subject and body." },
    "notification-denied": { vi: "Bạn không có quyền gửi thông báo.", en: "You cannot send notifications." },
    "notification-database": { vi: "Không lưu được thông báo vào cơ sở dữ liệu.", en: "Could not save notification." },
    "notification-retried": { vi: "Đã gửi lại thông báo.", en: "Notification retried." },
  };
  return notice ? notices[notice]?.[language] ?? notice : null;
}

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();
  return noticeText(notice, language);
}

function workspaceMessageText(message: string | null | undefined, _language: Language) {
  return message;
}

function sumBy<T extends Record<K, number>, K extends keyof T>(items: T[], key: K) {
  return items.reduce((total, item) => total + item[key], 0);
}

export function Dashboard({
  collection,
  dashboardWorkspace,
  production,
  todayVisits,
  utilization,
  visibleClinics,
  visibleAppointments,
  taskInboxWorkspace,
}: {
  collection: number;
  dashboardWorkspace?: DashboardWorkspace | null;
  production: number;
  todayVisits: number;
  utilization: number;
  visibleClinics: Clinic[];
  visibleAppointments: Appointment[];
  taskInboxWorkspace?: TaskInboxWorkspace | null;
}) {
  const { language } = useAppLanguage();
  const searchParams = useSearchParams();
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const text = dashboardText[language];
  const inboxItems = taskInboxWorkspace?.items ?? [];
  const dashboardLabels =
    language === "vi"
      ? {
          commandCenter: "Điều hành hôm nay",
          commandSubtitle: "Theo dõi lịch hẹn, luồng bệnh nhân, thu tiền và rủi ro cần xử lý.",
          patientFlow: "Luồng bệnh nhân hôm nay",
          clinics: "Phòng khám",
          risks: "Tín hiệu cần xử lý",
          providers: "Tải bác sĩ/phụ tá",
          appointments: "Lịch hẹn sắp tới",
          emptyAppointments: "Chưa có lịch hẹn trong hôm nay",
          emptyProviders: "Chưa có tải nhân sự trong hôm nay",
          emptyRisks: "Không có tín hiệu rủi ro",
          updated: "Cập nhật",
          inChair: "Đang điều trị",
          completed: "Hoàn tất",
          collectedToday: "Thu hôm nay",
        }
      : {
          commandCenter: "Today command center",
          commandSubtitle: "Track appointments, patient flow, collections, and operational risk.",
          patientFlow: "Today's patient flow",
          clinics: "Clinics",
          risks: "Signals to handle",
          providers: "Provider load",
          appointments: "Upcoming appointments",
          emptyAppointments: "No appointments today",
          emptyProviders: "No provider load today",
          emptyRisks: "No risk signals",
          updated: "Updated",
          inChair: "In chair",
          completed: "Completed",
          collectedToday: "Collected today",
        };
  const dashboardMetrics =
    [
      { label: text.todayVisits, value: String(todayVisits), detail: null, tone: "blue" as const },
      { label: text.chairUtilization, value: `${utilization}%`, detail: null, tone: "teal" as const },
      { label: text.production, value: formatVnd(production), detail: null, tone: "violet" as const },
      { label: text.collected, value: formatVnd(collection), detail: null, tone: "green" as const },
    ];
  const fallbackDashboardClinics =
    visibleClinics.map((clinic) => ({
      clinicId: clinic.id,
      chainId: clinic.chainId ?? null,
      chainName: clinic.chainName ?? null,
      name: clinic.name,
      city: clinic.city,
      chairs: clinic.chairs,
      providers: clinic.doctors,
      todayAppointments: clinic.todayVisits,
      inChair: 0,
      completed: 0,
      utilization: clinic.utilization,
      collectedToday: clinic.collection,
    }));
  const visibleClinicIdSet = useMemo(
    () => new Set(visibleClinics.map((clinic) => clinic.id)),
    [visibleClinics],
  );
  const dashboardClinics = (
    dashboardWorkspace?.clinicSummaries ?? fallbackDashboardClinics
  ).filter((clinic) => visibleClinicIdSet.has(clinic.clinicId));
  const scopedDashboardMetrics =
    dashboardWorkspace
      ? [
          {
            label: dashboardMetrics[0].label,
            value: String(sumBy(dashboardClinics, "todayAppointments")),
            tone: "blue" as const,
          },
          {
            label: dashboardMetrics[1].label,
            value: `${Math.round(
              dashboardClinics.reduce((total, clinic) => total + clinic.utilization, 0) /
                Math.max(dashboardClinics.length, 1),
            )}%`,
            tone: "teal" as const,
          },
          dashboardWorkspace.metrics[2] ?? dashboardMetrics[2],
          {
            label: dashboardMetrics[3].label,
            value: formatVnd(sumBy(dashboardClinics, "collectedToday")),
            tone: "green" as const,
          },
        ]
      : dashboardMetrics;
  const dashboardAppointments =
    (dashboardWorkspace?.appointments?.filter((appointment) =>
      visibleClinicIdSet.has(appointment.clinicId),
    ) ??
    visibleAppointments.slice(0, 8).map((appointment) => ({
      id: appointment.id,
      clinicId: appointment.clinicId,
      time: appointment.time,
      patientName: appointment.patient,
      providerName: appointment.provider,
      clinicName:
        visibleClinics.find((clinic) => clinic.id === appointment.clinicId)?.name ??
        appointment.clinicId,
      procedure: appointment.procedure,
      status: appointment.status,
    }))).slice(0, 8);
  const dashboardFlow =
    dashboardWorkspace
      ? dashboardWorkspace.flow.map((step) => ({
          ...step,
          count: dashboardAppointments.filter((appointment) => appointment.status === step.key).length,
        }))
      : [
      { key: "REQUESTED", label: "Yêu cầu", count: 0 },
      { key: "CONFIRMED", label: "Đã hẹn", count: todayVisits },
      { key: "ARRIVED", label: "Đã đến", count: 0 },
      { key: "IN_CHAIR", label: "Đang điều trị", count: 0 },
      { key: "COMPLETED", label: "Hoàn tất", count: 0 },
    ];
  const inboxLabels =
    language === "vi"
      ? {
          action: "Việc cần xử lý",
          empty: "Không có việc cần xử lý",
          generated: "Cập nhật",
          create: "Tạo công việc",
          complete: "Hoàn tất",
          patient: "Bệnh nhân",
          assignee: "Người phụ trách",
          due: "Hạn xử lý",
          priority: "Ưu tiên",
          detail: "Ghi chú xử lý",
          title: "Trung tâm thông báo và công việc",
          notificationForm: "Gửi thông báo",
          taskForm: "Giao việc nội bộ",
        }
      : {
          action: "Tasks",
          empty: "No pending tasks",
          generated: "Updated",
          create: "Create task",
          complete: "Complete",
          patient: "Patient",
          assignee: "Assignee",
          due: "Due",
          priority: "Priority",
          detail: "Task note",
          title: "Notifications and task inbox",
          notificationForm: "Send notification",
          taskForm: "Create internal task",
        };
  const retryNotificationLabel = language === "vi" ? "Gửi lại" : "Retry";
  const notificationLabels =
    language === "vi"
      ? {
          actionUrl: "Link hành động",
          allSystem: "Toàn hệ thống",
          body: "Nội dung",
          bodyPlaceholder: "Viết nội dung cần thông báo.",
          chains: "Chuỗi",
          clinics: "Chi nhánh",
          high: "Cao",
          low: "Thấp",
          medium: "Trung bình",
          priority: "Ưu tiên",
          roles: "Nhóm vai trò",
          send: "Gửi thông báo",
          subject: "Tiêu đề",
          subjectPlaceholder: "Ví dụ: Họp giao ban cuối ngày",
          targets: "Gửi tới",
          users: "Người nhận cụ thể",
        }
      : {
          actionUrl: "Action link",
          allSystem: "Whole system",
          body: "Body",
          bodyPlaceholder: "Write the announcement.",
          chains: "Chains",
          clinics: "Branches",
          high: "High",
          low: "Low",
          medium: "Medium",
          priority: "Priority",
          roles: "Role groups",
          send: "Send notification",
          subject: "Subject",
          subjectPlaceholder: "Example: End-of-day huddle",
          targets: "Send to",
          users: "Specific recipients",
        };
  const notificationRoles = [
    "OWNER",
    "AREA_MANAGER",
    "CLINIC_MANAGER",
    "DENTIST",
    "HYGIENIST",
    "FRONT_DESK",
    "BILLING",
  ];

  return (
    <section className="view-stack">
      <section className="dashboard-command-panel">
        <div className="dashboard-command-copy">
          <p className="eyebrow">{dashboardLabels.commandCenter}</p>
          <h2>{dashboardLabels.commandCenter}</h2>
          <span>{dashboardLabels.commandSubtitle}</span>
        </div>
        <div className="dashboard-command-status">
          <SourceBadge source={dashboardWorkspace?.source} />
          <span>
            {dashboardLabels.updated}: {dashboardWorkspace?.generatedAt ?? taskInboxWorkspace?.generatedAt ?? "-"}
          </span>
        </div>
        {scopedDashboardMetrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            tone={metric.tone}
          />
        ))}
      </section>

      {dashboardWorkspace?.message && (
        <div className="schedule-alert">{workspaceMessageText(dashboardWorkspace.message, language)}</div>
      )}

      <section className="panel dashboard-flow-panel">
        <PanelHeader icon={Activity} title={dashboardLabels.patientFlow} action={text.liveAppointmentFlow} />
        <div className="dashboard-flow">
          {dashboardFlow.map((step, index) => (
            <div className="dashboard-flow-step" key={step.key}>
              <span>{step.label}</span>
              <strong>{step.count}</strong>
              {index < dashboardFlow.length - 1 && <i />}
            </div>
          ))}
        </div>
      </section>

      <section className="panel dashboard-inbox-panel">
        <PanelHeader
          icon={Inbox}
          title={inboxLabels.title}
          action={`${inboxItems.length}`}
        />
        {taskInboxWorkspace?.message && (
          <div className="schedule-alert">{workspaceMessageText(taskInboxWorkspace.message, language)}</div>
        )}
        {notice && <div className="schedule-alert action">{notice}</div>}
        {taskInboxWorkspace?.canMutate ? (
        <details className="dashboard-compose-details">
          <summary>{inboxLabels.notificationForm}</summary>
        <form action={createInAppNotificationAction} className="notification-compose-form dashboard-notification-form">
          <input name="redirectTo" type="hidden" value="/dashboard" />
          <div className="notification-compose-grid">
            <label>
              <span>{notificationLabels.subject}</span>
              <input
                name="subject"
                required
                placeholder={notificationLabels.subjectPlaceholder}
                disabled={!taskInboxWorkspace?.canMutate}
              />
            </label>
            <label>
              <span>{notificationLabels.priority}</span>
              <select name="priority" defaultValue="medium" disabled={!taskInboxWorkspace?.canMutate}>
                <option value="high">{notificationLabels.high}</option>
                <option value="medium">{notificationLabels.medium}</option>
                <option value="low">{notificationLabels.low}</option>
              </select>
            </label>
          </div>
          <label>
            <span>{notificationLabels.body}</span>
            <textarea
              name="body"
              rows={2}
              required
              placeholder={notificationLabels.bodyPlaceholder}
              disabled={!taskInboxWorkspace?.canMutate}
            />
          </label>
          <div className="notification-compose-grid">
            <label>
              <span>{notificationLabels.actionUrl}</span>
              <input name="actionUrl" placeholder="/schedule" disabled={!taskInboxWorkspace?.canMutate} />
            </label>
            <button className="primary-button compact-button" type="submit" disabled={!taskInboxWorkspace?.canMutate}>
              <Inbox size={15} />
              {notificationLabels.send}
            </button>
          </div>
          <div className="notification-targets">
            <div className="notification-targets-title">{notificationLabels.targets}</div>
            <label className="notification-check">
              <input name="targetSystem" type="checkbox" value="true" disabled={!taskInboxWorkspace?.canMutate} />
              <span>{notificationLabels.allSystem}</span>
            </label>
            <details className="notification-target-section" open>
              <summary>{notificationLabels.roles}</summary>
              <div className="notification-check-grid">
                {notificationRoles.map((role) => (
                  <label className="notification-check" key={role}>
                    <input name="targetRoles" type="checkbox" value={role} disabled={!taskInboxWorkspace?.canMutate} />
                    <span>{displayStatus(role, language)}</span>
                  </label>
                ))}
              </div>
            </details>
            {(taskInboxWorkspace?.chains ?? []).length > 0 && (
              <details className="notification-target-section" open>
                <summary>{notificationLabels.chains}</summary>
                <div className="notification-check-grid">
                  {(taskInboxWorkspace?.chains ?? []).map((chain) => (
                    <label className="notification-check" key={chain.id}>
                      <input name="targetChainIds" type="checkbox" value={chain.id} disabled={!taskInboxWorkspace?.canMutate} />
                      <span>{chain.name}</span>
                    </label>
                  ))}
                </div>
              </details>
            )}
            <details className="notification-target-section" open>
              <summary>{notificationLabels.clinics}</summary>
              <div className="notification-check-grid">
                {(taskInboxWorkspace?.clinics ?? []).map((clinic) => (
                  <label className="notification-check" key={clinic.id}>
                    <input name="targetClinicIds" type="checkbox" value={clinic.id} disabled={!taskInboxWorkspace?.canMutate} />
                    <span>{clinic.name}</span>
                  </label>
                ))}
              </div>
            </details>
            <details className="notification-target-section" open>
              <summary>{notificationLabels.users}</summary>
              <div className="notification-check-grid">
                {(taskInboxWorkspace?.users ?? []).map((user) => (
                  <label className="notification-check" key={user.id}>
                    <input name="targetUserIds" type="checkbox" value={user.id} disabled={!taskInboxWorkspace?.canMutate} />
                    <span>{user.fullName}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
        </form>
        </details>
        ) : null}
        {taskInboxWorkspace?.canMutate ? (
        <details className="dashboard-compose-details">
          <summary>{inboxLabels.taskForm}</summary>
        <form action={createWorkItemAction} className="staff-form compact task-inbox-form">
          <input name="title" placeholder={inboxLabels.create} disabled={!taskInboxWorkspace?.canMutate} required />
          <select name="patientId" disabled={!taskInboxWorkspace?.canMutate}>
            <option value="">{inboxLabels.patient}</option>
            {(taskInboxWorkspace?.patients ?? []).map((patient) => (
              <option value={patient.id} key={patient.id}>
                {patient.name} - {patient.phone}
              </option>
            ))}
          </select>
          <select name="assignedToId" disabled={!taskInboxWorkspace?.canMutate}>
            <option value="">{inboxLabels.assignee}</option>
            {(taskInboxWorkspace?.users ?? []).map((user) => (
              <option value={user.id} key={user.id}>
                {user.fullName}
              </option>
            ))}
          </select>
          <select name="priority" defaultValue="medium" disabled={!taskInboxWorkspace?.canMutate}>
            <option value="high">{displayStatus("high", language)}</option>
            <option value="medium">{displayStatus("medium", language)}</option>
            <option value="low">{displayStatus("low", language)}</option>
          </select>
          <input name="dueAt" type="date" disabled={!taskInboxWorkspace?.canMutate} />
          <input name="detail" placeholder={inboxLabels.detail} disabled={!taskInboxWorkspace?.canMutate} />
          <button className="primary-button compact-button" type="submit" disabled={!taskInboxWorkspace?.canMutate}>
            <Inbox size={15} />
            {inboxLabels.create}
          </button>
        </form>
        </details>
        ) : null}
        <div className="invoice-list task-inbox-list">
          {inboxItems.length > 0 ? (
            inboxItems.slice(0, 12).map((item) => (
              <div className="invoice-row billing-invoice-row task-inbox-row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {displayStatus(item.kind, language)} · {item.detail}
                  </span>
                  <small>
                    {item.patientName ?? item.clinicName ?? "-"}
                    {item.dueAt ? ` · ${item.dueAt}` : ""}
                    {item.assignedToName ? ` · ${item.assignedToName}` : ""}
                  </small>
                </div>
                <StatusPill status={item.priority} />
                {item.kind === "notification" && item.status === "FAILED" && item.sourceId ? (
                  <form action={retryFailedNotificationAction}>
                    <input name="notificationId" type="hidden" value={item.sourceId} />
                    <button className="secondary-button compact-button task-action-button" type="submit" disabled={!taskInboxWorkspace?.canMutate}>
                      {retryNotificationLabel}
                    </button>
                  </form>
                ) : item.actionable && item.sourceId ? (
                  <form action={completeWorkItemAction}>
                    <input name="workItemId" type="hidden" value={item.sourceId} />
                    <button className="secondary-button compact-button task-action-button" type="submit" disabled={!taskInboxWorkspace?.canMutate}>
                      <CheckCircle2 size={15} />
                      {inboxLabels.complete}
                    </button>
                  </form>
                ) : (
                  <Link className="secondary-button compact-button task-action-button" href={item.href}>
                    {inboxLabels.action}
                  </Link>
                )}
              </div>
            ))
          ) : (
            <EmptyState label={inboxLabels.empty} />
          )}
        </div>
        {taskInboxWorkspace?.generatedAt && (
          <p className="billing-panel-note">
            {inboxLabels.generated}: {taskInboxWorkspace.generatedAt}
          </p>
        )}
      </section>

      <div className="content-grid two">
        <section className="panel">
          <PanelHeader
            icon={Building2}
            title={dashboardLabels.clinics}
            action={text.compare}
          />
          <div className="dashboard-clinic-grid">
            {dashboardClinics.map((clinic) => (
              <div className="dashboard-clinic-card" key={clinic.clinicId}>
                <div>
                  <strong>{clinic.name}</strong>
                  <span>
                    {clinic.city} · {clinic.chairs} {text.chairs} · {clinic.providers} {language === "vi" ? "nhân sự" : "staff"}
                  </span>
                </div>
                <div className="dashboard-clinic-stats">
                  <span>{clinic.todayAppointments} {text.visits}</span>
                  <span>{clinic.inChair} {dashboardLabels.inChair}</span>
                  <span>{clinic.completed} {dashboardLabels.completed}</span>
                  <span>{formatVnd(clinic.collectedToday)} {dashboardLabels.collectedToday}</span>
                </div>
                <div className="clinic-stats">
                  <div
                    className="progress"
                    aria-label={`${clinic.utilization}% ${text.chairUtilization}`}
                  >
                    <i style={{ width: `${clinic.utilization}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelHeader
            icon={CalendarDays}
            title={dashboardLabels.appointments}
            action={text.open}
          />
          <div className="timeline">
            {dashboardAppointments.length > 0 ? (
              dashboardAppointments.map((appointment) => (
                <div className="timeline-item" key={appointment.id}>
                <time>{appointment.time}</time>
                <div>
                  <strong>{appointment.patientName}</strong>
                  <span>
                    {appointment.procedure} · {appointment.providerName} · {appointment.clinicName}
                  </span>
                </div>
                <StatusPill status={appointment.status} />
                </div>
              ))
            ) : (
              <EmptyState label={dashboardLabels.emptyAppointments} />
            )}
          </div>
        </section>
      </div>

      <section className="content-grid two">
        <section className="panel">
          <PanelHeader icon={ShieldCheck} title={dashboardLabels.risks} action={text.open} />
          <div className="dashboard-risk-grid">
            {(dashboardWorkspace?.risks ?? []).length > 0 ? (
              dashboardWorkspace?.risks.map((risk) => (
                <Link className={`dashboard-risk-card tone-${risk.tone}`} href={risk.href} key={risk.label}>
                  <span>{risk.label}</span>
                  <strong>{risk.value}</strong>
                  <small>{risk.detail}</small>
                </Link>
              ))
            ) : (
              <EmptyState label={dashboardLabels.emptyRisks} />
            )}
          </div>
        </section>

        <section className="panel">
          <PanelHeader icon={UsersRound} title={dashboardLabels.providers} action={text.liveAppointmentFlow} />
          <div className="dashboard-provider-list">
            {(dashboardWorkspace?.providerLoads ?? []).length > 0 ? (
              dashboardWorkspace?.providerLoads.map((provider) => (
                <div className="dashboard-provider-row" key={provider.providerId}>
                  <div>
                    <strong>{provider.name}</strong>
                    <span>{displayStatus(provider.role, language)}</span>
                  </div>
                  <span>{provider.activeCount}/{provider.appointmentCount}</span>
                </div>
              ))
            ) : (
              <EmptyState label={dashboardLabels.emptyProviders} />
            )}
          </div>
        </section>
      </section>
    </section>
  );
}

