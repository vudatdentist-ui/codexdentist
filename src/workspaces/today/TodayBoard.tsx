"use client";

import { CalendarDays, CheckCheck, Search } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { DashboardAppointmentSummary } from "@/lib/dashboard-types";
import type { TaskInboxItemSummary } from "@/lib/task-inbox-types";
import { appointmentHref, appointmentStatus, flowCounts, flowStages, sortTasks } from "./model";
import styles from "./today.module.css";

type Language = "vi" | "en";
const statusLabels: Record<Language, Record<string, string>> = {
  vi: { REQUESTED: "Cần xác nhận", CONFIRMED: "Đã hẹn", ARRIVED: "Đang chờ", IN_CHAIR: "Đang điều trị", COMPLETED: "Hoàn tất", CANCELLED: "Đã hủy", NO_SHOW: "Không đến", NEEDS_FOLLOW_UP: "Cần tái hẹn" },
  en: { REQUESTED: "Unconfirmed", CONFIRMED: "Booked", ARRIVED: "Waiting", IN_CHAIR: "In treatment", COMPLETED: "Completed", CANCELLED: "Cancelled", NO_SHOW: "No-show", NEEDS_FOLLOW_UP: "Follow-up" },
};

export function TodayBoard({ appointments, language }: {
  appointments: DashboardAppointmentSummary[];
  language: Language;
}) {
  const [stage, setStage] = useState("ALL");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(8);
  const vi = language === "vi";
  const counts = flowCounts(appointments);
  const filtered = appointments.filter((item) =>
    (stage === "ALL" || appointmentStatus(item.status) === stage) &&
    `${item.patientName} ${item.providerName} ${item.procedure}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ).sort((a, b) => (a.startsAt ?? a.time).localeCompare(b.startsAt ?? b.time));
  return (
    <section className={styles.board} aria-labelledby="today-flow-title">
      <header className={styles.heading}>
        <div><p>{vi ? "TẠI PHÒNG KHÁM" : "IN THE CLINIC"}</p><h2 id="today-flow-title">{vi ? "Bệnh nhân hôm nay" : "Patients today"}</h2></div>
        <Link href="/schedule" className={styles.textLink}><CalendarDays size={16} />{vi ? "Lịch đầy đủ" : "Full schedule"}</Link>
      </header>
      <div className={styles.stages} role="group" aria-label={vi ? "Trạng thái lịch hẹn" : "Appointment status"}>
        {flowStages.map((key) => (
          <button key={key} type="button" aria-pressed={stage === key} onClick={() => { setStage(stage === key ? "ALL" : key); setLimit(8); }}>
            <strong>{counts[key]}</strong><span>{statusLabels[language][key]}</span>
          </button>
        ))}
      </div>
      <div className={styles.toolbar}>
        <button className={styles.filter} type="button" aria-pressed={stage === "ALL"} onClick={() => { setStage("ALL"); setLimit(8); }}>{vi ? "Tất cả" : "All"} · {appointments.length}</button>
        <label className={styles.search}><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(8); }} placeholder={vi ? "Tìm bệnh nhân, bác sĩ…" : "Find patient, provider…"} aria-label={vi ? "Tìm trong lịch hôm nay" : "Search today's appointments"} /></label>
      </div>
      <p className={styles.result} aria-live="polite">{filtered.length} {vi ? "lịch hẹn" : "appointments"}{stage !== "ALL" ? ` · ${statusLabels[language][stage]}` : ""}</p>
      <div className={styles.appointments}>
        {filtered.slice(0, limit).map((item) => {
          const status = appointmentStatus(item.status);
          return <article key={item.id} className={styles.appointment} data-stage={status}>
            <time dateTime={item.startsAt}>{item.time}</time>
            <div className={styles.patient}><strong>{item.patientName}</strong><span>{item.procedure}</span><small>{item.providerName} · {item.clinicName}</small></div>
            <div className={styles.appointmentAction}><span className={styles.status}>{statusLabels[language][status] ?? item.status}</span><Link href={appointmentHref(item)} aria-label={`${vi ? "Mở lịch hẹn của" : "Open appointment for"} ${item.patientName}`}>{vi ? "Mở lịch hẹn" : "Open appointment"}</Link></div>
          </article>;
        })}
        {!filtered.length && <div className={styles.empty}><CalendarDays size={24} /><strong>{appointments.length ? (vi ? "Không có lịch hẹn phù hợp" : "No matching appointments") : (vi ? "Chưa có lịch hẹn hôm nay" : "No appointments today")}</strong>{appointments.length > 0 && <button type="button" onClick={() => { setStage("ALL"); setQuery(""); }}>{vi ? "Xóa bộ lọc" : "Clear filters"}</button>}</div>}
      </div>
      {filtered.length > limit && <button className={styles.more} type="button" onClick={() => setLimit(limit + 8)}>{vi ? "Xem thêm" : "Show more"} ({filtered.length - limit})</button>}
    </section>
  );
}

export function TodayTasks({ items, language, renderAction }: {
  items: TaskInboxItemSummary[];
  language: Language;
  renderAction: (item: TaskInboxItemSummary) => ReactNode;
}) {
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(6);
  const vi = language === "vi";
  const ordered = sortTasks(items);
  const filtered = ordered.filter((item) => filter === "all" || (filter === "high" ? item.priority === "high" : item.id.startsWith("work-")));
  const priorities = vi ? { high: "Ưu tiên cao", medium: "Bình thường", low: "Ưu tiên thấp" } : { high: "High priority", medium: "Normal", low: "Low priority" };
  return <section className={styles.board} aria-labelledby="today-tasks-title" id="today-tasks">
    <header className={styles.heading}><div><p>{vi ? "CẦN THEO DÕI" : "FOLLOW THROUGH"}</p><h2 id="today-tasks-title">{vi ? "Việc cần xử lý" : "Action queue"}</h2></div><span className={styles.total}>{items.length}</span></header>
    <div className={styles.toolbar} role="group" aria-label={vi ? "Lọc công việc" : "Filter tasks"}>
      {[["all", vi ? "Tất cả" : "All"], ["high", vi ? "Ưu tiên cao" : "High priority"], ["work", vi ? "Việc được giao" : "Assigned tasks"]].map(([key, label]) => <button className={styles.filter} type="button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setLimit(6); }}>{label}</button>)}
    </div>
    <p className={styles.result} aria-live="polite">{filtered.length} {vi ? "mục · Ưu tiên cao trước, sau đó theo hạn xử lý" : "items · Priority first, then due date"}</p>
    <div className={styles.tasks}>
      {filtered.slice(0, limit).map((item) => <article className={styles.task} key={item.id} data-priority={item.priority}>
        <div className={styles.taskTop}><span className={styles.priority}>{priorities[item.priority]}</span>{item.dueAt && <time dateTime={item.dueAtIso ?? undefined}>{item.dueAt}</time>}</div>
        <strong>{item.title}</strong><p>{item.detail}</p>
        {(item.patientName || item.clinicName) && <span className={styles.taskContext}>{[item.patientName, item.clinicName].filter(Boolean).join(" · ")}</span>}
        <div className={styles.taskBottom}><small>{item.assignedToName ?? (vi ? "Chưa có người phụ trách" : "No assignee")}</small>{renderAction(item)}</div>
      </article>)}
      {!filtered.length && <div className={styles.empty}><CheckCheck size={24} /><strong>{items.length ? (vi ? "Không có việc trong nhóm này" : "No tasks in this group") : (vi ? "Không có việc cần xử lý" : "Nothing to handle")}</strong>{items.length > 0 && <button type="button" onClick={() => setFilter("all")}>{vi ? "Xem tất cả" : "Show all"}</button>}</div>}
    </div>
    {filtered.length > limit && <button className={styles.more} type="button" onClick={() => setLimit(limit + 6)}>{vi ? "Xem thêm" : "Show more"} ({filtered.length - limit})</button>}
  </section>;
}
