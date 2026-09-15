import type { DashboardAppointmentSummary } from "@/lib/dashboard-types";
import type { TaskInboxItemSummary } from "@/lib/task-inbox-types";

// Presentation only: server queries remain the authorization boundary.
export const flowStages = ["REQUESTED", "CONFIRMED", "ARRIVED", "IN_CHAIR", "COMPLETED"] as const;

export function appointmentStatus(status: string) {
  return status.trim().toUpperCase().replace(/[ -]+/g, "_");
}

export function flowCounts(appointments: DashboardAppointmentSummary[]) {
  return Object.fromEntries(flowStages.map((stage) => [
    stage, appointments.filter((item) => appointmentStatus(item.status) === stage).length,
  ])) as Record<(typeof flowStages)[number], number>;
}

export function scopedTasks(items: TaskInboxItemSummary[], clinicIds: Set<string>, narrowed: boolean) {
  return items.filter((item) => item.clinicId === null ||
    (item.clinicId === undefined ? !narrowed : clinicIds.has(item.clinicId)));
}

export function sortTasks(items: TaskInboxItemSummary[]) {
  const ranks = { high: 0, medium: 1, low: 2 };
  const dueTime = (item: TaskInboxItemSummary) => {
    const time = item.dueAtIso ? Date.parse(item.dueAtIso) : NaN;
    return Number.isFinite(time) ? time : Infinity;
  };
  return [...items].sort((a, b) => ranks[a.priority] - ranks[b.priority] || dueTime(a) - dueTime(b));
}

export function taskAction(item: TaskInboxItemSummary): "retry" | "complete" | "open" {
  // Notifications with an action URL are navigable, never WorkItem mutations.
  if (item.id.startsWith("notification-") && item.status === "FAILED" && item.sourceId) return "retry";
  if (item.id.startsWith("work-") && item.actionable && item.sourceId) return "complete";
  return "open";
}

export function appointmentHref(item: DashboardAppointmentSummary) {
  const params = new URLSearchParams();
  if (item.patientId) params.set("patientId", item.patientId);
  // Schedule already consumes patientId; do not invent an appointmentId deep link.
  return `/schedule${params.size ? `?${params}` : ""}`;
}
