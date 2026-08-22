import "server-only";

import { getDashboardWorkspace } from "@/lib/dashboard";
import type { DashboardAppointmentSummary } from "@/lib/dashboard-types";
import type { AppSession } from "@/lib/session";
import { getTaskInboxWorkspace } from "@/lib/task-inbox";
import type { TaskInboxItemSummary } from "@/lib/task-inbox-types";

export type TodayAppointmentRow = {
  id: string;
  time: string;
  patientName: string;
  detail: string;
  meta: string;
  status: string;
  actionLabel: string;
  href: string;
};

export type TodayAttentionRow = {
  id: string;
  title: string;
  detail: string;
  meta: string | null;
  priority: "high" | "medium" | "low";
  actionLabel: string;
  href: string;
};

export type TodayWorkspaceModel = {
  dateLabel: string;
  message: string | null;
  activeAppointments: TodayAppointmentRow[];
  attention: TodayAttentionRow[];
  upcoming: TodayAppointmentRow[];
};

export async function getTodayWorkspace(session: AppSession): Promise<TodayWorkspaceModel> {
  const [dashboard, inbox] = await Promise.all([
    getDashboardWorkspace(session),
    getTaskInboxWorkspace(session),
  ]);

  const activeAppointments = dashboard.appointments
    .filter((appointment) => isActiveAppointment(appointment.status))
    .slice(0, 5)
    .map(toAppointmentRow);
  const activeIds = new Set(activeAppointments.map((appointment) => appointment.id));
  const upcoming = dashboard.appointments
    .filter(
      (appointment) =>
        !activeIds.has(appointment.id) &&
        !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(normalizeStatus(appointment.status)),
    )
    .slice(0, 8)
    .map(toAppointmentRow);

  const attention = inbox.items
    .filter((item) => item.kind !== "learning")
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority))
    .slice(0, 7)
    .map(toAttentionRow);

  return {
    dateLabel: new Intl.DateTimeFormat("vi-VN", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date()),
    message: dashboard.message ?? inbox.message,
    activeAppointments,
    attention,
    upcoming,
  };
}

function toAppointmentRow(appointment: DashboardAppointmentSummary): TodayAppointmentRow {
  return {
    id: appointment.id,
    time: appointment.time,
    patientName: appointment.patientName,
    detail: appointment.procedure,
    meta: [appointment.providerName, appointment.clinicName].filter(Boolean).join(" · "),
    status: appointment.status,
    actionLabel: appointmentActionLabel(appointment.status),
    href: "/schedule",
  };
}

function toAttentionRow(item: TaskInboxItemSummary): TodayAttentionRow {
  const href = item.actionUrl ?? item.href;

  return {
    id: item.id,
    title: item.title,
    detail: item.detail,
    meta: [item.patientName, item.clinicName, item.dueAt].filter(Boolean).join(" · ") || null,
    priority: item.priority,
    actionLabel: taskActionLabel(item),
    href: href === "/dashboard" ? "/work" : href,
  };
}

function normalizeStatus(status: string) {
  return status.trim().replaceAll("-", "_").replaceAll(" ", "_").toUpperCase();
}

function isActiveAppointment(status: string) {
  return ["ARRIVED", "IN_CHAIR", "REQUESTED"].includes(normalizeStatus(status));
}

function appointmentActionLabel(status: string) {
  switch (normalizeStatus(status)) {
    case "ARRIVED":
      return "Bắt đầu";
    case "IN_CHAIR":
      return "Mở";
    case "REQUESTED":
      return "Xác nhận";
    default:
      return "Mở lịch";
  }
}

function taskActionLabel(item: TaskInboxItemSummary) {
  if (item.status === "FAILED") {
    return "Xử lý";
  }

  switch (item.kind) {
    case "crm":
      return "Liên hệ";
    case "billing":
      return "Xem";
    case "inventory":
      return "Xử lý";
    case "hr":
      return "Xem";
    case "schedule":
      return "Mở lịch";
    default:
      return "Mở";
  }
}

function priorityRank(priority: TaskInboxItemSummary["priority"]) {
  if (priority === "high") return 0;
  if (priority === "medium") return 1;
  return 2;
}
