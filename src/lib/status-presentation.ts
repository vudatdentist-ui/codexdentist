import type { Appointment, Invoice, TreatmentPlan } from "@/lib/data";

export function appointmentStatusLabel(status: string): Appointment["status"] {
  const labels: Record<string, Appointment["status"]> = {
    REQUESTED: "Requested",
    CONFIRMED: "Confirmed",
    ARRIVED: "Arrived",
    IN_CHAIR: "In chair",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    NO_SHOW: "No-show",
  };

  return labels[status] ?? "Confirmed";
}

export function invoiceStatusLabel(status: string, dueDate: Date): Invoice["status"] {
  if (status !== "PAID" && status !== "VOID" && dueDate < new Date()) {
    return "Overdue";
  }

  const labels: Record<string, Invoice["status"]> = {
    DRAFT: "Draft",
    OPEN: "Open",
    PARTIAL: "Partial",
    PAID: "Paid",
    OVERDUE: "Overdue",
    VOID: "Void",
  };

  return labels[status] ?? "Open";
}

export function treatmentStatusLabel(status: string): TreatmentPlan["status"] {
  const labels: Record<string, TreatmentPlan["status"]> = {
    DRAFT: "Draft",
    PRESENTED: "Presented",
    ACCEPTED: "Accepted",
    IN_PROGRESS: "In progress",
    COMPLETED: "Completed",
    DECLINED: "Declined",
  };

  return labels[status] ?? "Draft";
}
