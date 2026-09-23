"use client";

import { ArrowRight, Building2, CalendarDays, CheckCircle2, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { completeWorkItemAction, createWorkItemAction, retryFailedNotificationAction } from "@/app/(app)/dashboard/actions";
import { useAppLanguage } from "@/components/AppLanguage";
import { NotificationComposer } from "@/components/WorkspaceNotifications";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, PanelHeader, StatusPill } from "@/components/suite-primitives";
import { formatVnd, type Appointment, type Clinic } from "@/lib/data";
import type { DashboardWorkspace } from "@/lib/dashboard-types";
import type { TaskInboxWorkspace } from "@/lib/task-inbox-types";
import { summarizeClinicDay } from "@/workspaces/clinic-day";

const statusNames: Record<string, [string, string]> = {
  REQUESTED: ["Chờ xác nhận", "Requested"], CONFIRMED: ["Đã xác nhận", "Confirmed"], ARRIVED: ["Đã đến", "Arrived"],
  IN_CHAIR: ["Đang trên ghế", "In chair"], COMPLETED: ["Hoàn tất", "Completed"], CANCELLED: ["Đã hủy", "Cancelled"],
  NO_SHOW: ["Không đến", "No-show"], HIGH: ["Cao", "High"], MEDIUM: ["Trung bình", "Medium"], LOW: ["Thấp", "Low"],
  DENTIST: ["Bác sĩ", "Dentist"], HYGIENIST: ["Điều dưỡng", "Hygienist"], OWNER: ["Chủ hệ thống", "Owner"],
  AREA_MANAGER: ["Quản lý khu vực", "Area manager"], CLINIC_MANAGER: ["Quản lý phòng khám", "Clinic manager"],
  FRONT_DESK: ["Lễ tân", "Front desk"], BILLING: ["Thu ngân", "Billing"],
};
const notices: Record<string, [string, string]> = {
  "task-created": ["Đã giao công việc.", "Task assigned."], "task-completed": ["Đã hoàn tất công việc.", "Task completed."],
  "notification-sent": ["Đã gửi thông báo.", "Notification sent."],
  "notification-target-missing": ["Chọn ít nhất một nhóm hoặc người nhận.", "Choose at least one recipient."],
  "notification-missing": ["Nhập tiêu đề và nội dung thông báo.", "Enter a subject and message."],
  "notification-denied": ["Bạn không có quyền gửi thông báo.", "You cannot send notifications."],
  "notification-retried": ["Đã gửi lại thông báo.", "Notification retried."],
};

export function Dashboard({ collection, dashboardWorkspace, production, todayVisits, utilization, visibleClinics, visibleAppointments, taskInboxWorkspace }: {
  collection: number; dashboardWorkspace?: DashboardWorkspace | null; production: number; todayVisits: number;
  utilization: number; visibleClinics: Clinic[]; visibleAppointments: Appointment[]; taskInboxWorkspace?: TaskInboxWorkspace | null;
}) {
  const { language } = useAppLanguage();
  const vi = language === "vi";
  const text = (v: string, e: string) => vi ? v : e;
  const status = (value: string) => statusNames[value.toUpperCase().replace(/[ -]/g, "_")]?.[vi ? 0 : 1] ?? value;
  const search = useSearchParams();
  const noticeKey = visibleActionNoticeParam(search.get("notice"));
  const notice = noticeKey ? notices[noticeKey]?.[vi ? 0 : 1] ?? text("Chưa hoàn tất thao tác. Kiểm tra thông tin và thử lại.", "The action could not be completed. Review the information and retry.") : null;
  const clinicIds = new Set(visibleClinics.map(clinic => clinic.id));
  const clinics = (dashboardWorkspace?.clinicSummaries ?? []).filter(clinic => clinicIds.has(clinic.clinicId));
  const day = summarizeClinicDay(clinics, clinicIds);
  const hasSummary = Boolean(dashboardWorkspace);
  const total = hasSummary ? day.appointments : todayVisits;
  const appointments = dashboardWorkspace?.appointments.filter(item => clinicIds.has(item.clinicId)) ?? visibleAppointments.filter(item => clinicIds.has(item.clinicId)).slice(0, 10).map(item => ({
    id: item.id, time: item.time, patientName: item.patient, providerName: item.provider, procedure: item.procedure, status: item.status,
    clinicName: visibleClinics.find(clinic => clinic.id === item.clinicId)?.name ?? "",
  }));
  const items = taskInboxWorkspace?.items ?? [];
  const updated = dashboardWorkspace?.generatedAt ?? taskInboxWorkspace?.generatedAt;
  return <section className="view-stack narrative-day">
    {dashboardWorkspace?.message && <div className="schedule-alert" role="status">{dashboardWorkspace.message}</div>}
    {notice && <div className="schedule-alert action" role="status">{notice}</div>}
    <div className="day-opening"><div className="day-context"><span>{text("Trong phạm vi phòng khám đang chọn", "For the selected clinics")}</span>{updated && <small>{text("Cập nhật", "Updated")}: {updated}</small>}</div>
      <Link className="primary-button" href="/schedule"><CalendarDays size={17} aria-hidden="true" />{text("Mở lịch hẹn", "Open appointments")}<ArrowRight size={16} aria-hidden="true" /></Link>
    </div>
    <dl className="day-pulse" aria-label={text("Tình hình lịch hẹn", "Appointment overview")}>
      <div><dt>{text("Lịch hẹn hôm nay", "Appointments today")}</dt><dd data-day-total>{total}</dd></div>
      <div><dt>{text("Đang trên ghế", "In chair")}</dt><dd>{hasSummary ? day.inChair : "—"}</dd></div>
      <div><dt>{text("Lượt hẹn hoàn tất", "Completed visits")}</dt><dd>{hasSummary ? day.completed : "—"}</dd></div>
    </dl>
    <div className="day-work-grid">
      <section className="panel day-appointments" aria-labelledby="day-appointments-title">
        <div className="day-section-heading"><div><p className="workspace-chapter">01 / {text("Tiếp đón", "Welcome")}</p><h2 id="day-appointments-title">{text("Lịch hẹn hôm nay", "Today's appointments")}</h2></div><Link className="workspace-text-link" href="/schedule">{text("Xem lịch", "View schedule")}<ArrowRight size={16} aria-hidden="true" /></Link></div>
        <ol className="day-appointment-list">{appointments.map(item => <li key={item.id}><time>{item.time}</time><div className="day-appointment-person"><strong>{item.patientName}</strong><span>{item.procedure}</span><small>{item.providerName} · {item.clinicName}</small></div><StatusPill status={item.status} label={status(item.status)} /></li>)}</ol>
        {!appointments.length && <EmptyState label={total > 0 ? text("Mở lịch để xem các lượt hẹn của phòng khám này.", "Open the schedule to see this clinic's appointments.") : text("Chưa có lịch hẹn hôm nay. Thêm lịch hẹn từ màn hình Lịch hẹn.", "No appointments today. Add a visit from the schedule.")} />}
        {total > appointments.length && <p className="day-preview-note">{text(`Hiển thị ${appointments.length} / ${total} lượt hẹn. Mở lịch để xem đầy đủ.`, `Showing ${appointments.length} of ${total} visits. Open the schedule for the full list.`)}</p>}
      </section>
      <section className="panel day-tasks" aria-labelledby="day-tasks-title">
        <div className="day-section-heading"><div><p className="workspace-chapter">02 / {text("Tiếp nối", "Follow through")}</p><h2 id="day-tasks-title">{text("Việc cần xử lý", "Work to follow up")}</h2></div></div>
        <p className="day-scope-note">{text("Thông báo và công việc trong phạm vi bạn được truy cập.", "Notifications and work across your accessible clinics.")}</p>
        {taskInboxWorkspace?.message && <div className="schedule-alert">{taskInboxWorkspace.message}</div>}
        <div className="day-task-list">{items.slice(0, 12).map(item => <article className="day-task" key={item.id}>
          <strong>{item.title}</strong><p>{item.detail}</p><small>{[item.patientName, item.clinicName, item.assignedToName, item.dueAt].filter(Boolean).join(" · ")}</small>
          <div className="day-task-actions"><StatusPill status={item.priority} label={status(item.priority)} />
            {item.kind === "notification" && item.status === "FAILED" && item.sourceId ? <form action={retryFailedNotificationAction}><input name="notificationId" type="hidden" value={item.sourceId} /><button className="secondary-button compact-button" type="submit" disabled={!taskInboxWorkspace?.canMutate}>{text("Gửi lại", "Retry notification")}</button></form>
            : item.actionable && item.sourceId ? <form action={completeWorkItemAction}><input name="workItemId" type="hidden" value={item.sourceId} /><button className="secondary-button compact-button" type="submit" disabled={!taskInboxWorkspace?.canMutate}><CheckCircle2 size={15} aria-hidden="true" />{text("Hoàn tất", "Complete")}</button></form>
            : <Link className="workspace-text-link" href={item.href}>{text("Mở công việc", "Open task")}<ArrowRight size={15} aria-hidden="true" /></Link>}
          </div>
        </article>)}</div>
        {!items.length && <EmptyState label={text("Chưa có công việc cần xử lý.", "No work to follow up right now.")} />}
        {items.length > 12 && <p className="day-preview-note">{text(`Hiển thị 12 / ${items.length} mục. Mở Thông báo để xem tất cả.`, `Showing 12 of ${items.length} items. Open Notifications for the full list.`)}</p>}
      </section>
    </div>
    {taskInboxWorkspace?.canMutate && <section className="panel day-handoff" aria-label={text("Giao việc cho đội ngũ", "Team handoff")}>
      <details><summary>{text("Giao một công việc", "Assign a task")}</summary><form action={createWorkItemAction} className="staff-form compact task-inbox-form">
        <label>{text("Công việc", "Task")}<input name="title" required /></label>
        <label>{text("Bệnh nhân (không bắt buộc)", "Patient (optional)")}<select name="patientId"><option value="">{text("Chọn bệnh nhân", "Select patient")}</option>{taskInboxWorkspace.patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name} - {patient.phone}</option>)}</select></label>
        <label>{text("Người phụ trách", "Assignee")}<select name="assignedToId"><option value="">{text("Chọn người phụ trách", "Select assignee")}</option>{taskInboxWorkspace.users.map(user => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
        <label>{text("Mức ưu tiên", "Priority")}<select name="priority" defaultValue="medium">{["high", "medium", "low"].map(value => <option key={value} value={value}>{status(value)}</option>)}</select></label>
        <label>{text("Hạn xử lý", "Due date")}<input name="dueAt" type="date" /></label><label>{text("Ghi chú", "Notes")}<input name="detail" /></label>
        <button className="primary-button" type="submit">{text("Giao công việc", "Assign task")}</button>
      </form></details>
      <details><summary>{text("Gửi thông báo cho đội ngũ", "Send a team notification")}</summary><NotificationComposer currentPath="/dashboard" language={language} workspace={taskInboxWorkspace} /></details>
    </section>}
    <section className="day-practice-review" aria-labelledby="day-review-title">
      <div className="day-section-heading"><div><p className="workspace-chapter">03 / {text("Nhìn lại", "Review")}</p><h2 id="day-review-title">{text("Tình hình phòng khám", "The practice at a glance")}</h2></div><Link href="/reports" className="workspace-text-link">{text("Xem báo cáo", "View reports")}<ArrowRight size={16} aria-hidden="true" /></Link></div>
      <dl className="day-financial-summary"><div><dt>{text("Đã thu hôm nay", "Collected today")}</dt><dd>{formatVnd(hasSummary ? day.collected : collection)}</dd></div><div><dt>{text("Doanh thu", "Production")}</dt><dd>{formatVnd(production)}</dd></div><div><dt>{text("Hiệu suất ghế", "Chair utilization")}</dt><dd>{utilization}%</dd></div></dl>
      <details className="panel day-review-details"><summary><Building2 size={18} aria-hidden="true" />{text("Chi tiết từng phòng khám", "Clinic-by-clinic detail")}</summary><div className="day-clinic-list">{clinics.map(clinic => <article key={clinic.clinicId}><div><strong>{clinic.name}</strong><small>{clinic.city} · {clinic.chairs} {text("ghế", "chairs")}</small></div><dl><div><dt>{text("Lịch hẹn", "Visits")}</dt><dd>{clinic.todayAppointments}</dd></div><div><dt>{text("Đang trên ghế", "In chair")}</dt><dd>{clinic.inChair}</dd></div><div><dt>{text("Đã thu", "Collected")}</dt><dd>{formatVnd(clinic.collectedToday)}</dd></div></dl></article>)}</div></details>
      <div className="day-review-grid">
        <section className="panel"><PanelHeader icon={ShieldCheck} title={text("Những điểm cần lưu ý", "Items needing attention")} /><p className="day-scope-note">{text("Tất cả phòng khám bạn được truy cập", "All your accessible clinics")}</p>
          <div className="day-risk-list">{(dashboardWorkspace?.risks ?? []).map(risk => <Link key={risk.label} href={risk.href}><div><strong>{risk.label}</strong><small>{risk.detail}</small></div><span>{risk.value}</span><ArrowRight size={16} aria-hidden="true" /></Link>)}</div>
          {!dashboardWorkspace?.risks.length && <EmptyState label={text("Chưa có thông tin cần lưu ý.", "No attention items available.")} />}
        </section>
        <section className="panel"><PanelHeader icon={UsersRound} title={text("Lịch làm việc của đội ngũ", "The team's appointments")} /><p className="day-scope-note">{text("Đang xử lý / tổng lượt hẹn trong các phòng khám bạn được truy cập", "Active / total visits across your accessible clinics")}</p>
          <div className="dashboard-provider-list">{(dashboardWorkspace?.providerLoads ?? []).map(provider => <div className="dashboard-provider-row" key={provider.providerId}><div><strong>{provider.name}</strong><span>{status(provider.role)}</span></div><span>{provider.activeCount} / {provider.appointmentCount}</span></div>)}</div>
          {!dashboardWorkspace?.providerLoads.length && <EmptyState label={text("Chưa có lịch hẹn của đội ngũ hôm nay.", "No team appointments today.")} />}
        </section>
      </div>
    </section>
  </section>;
}
