import "server-only";

import { hasAnyRole, type AppRole } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";

export type ActionKey =
  | "appointment.create"
  | "appointment.update"
  | "appointment.cancel"
  | "patient.create"
  | "patient.update"
  | "patient.archive"
  | "clinical.note.create"
  | "clinical.note.sign"
  | "clinical.note.amend"
  | "treatment.plan.create"
  | "treatment.plan.accept"
  | "treatment.service.delete"
  | "treatment.service.progress"
  | "billing.receipt.record"
  | "billing.balance.allocate"
  | "billing.invoice.create"
  | "billing.invoice.issue"
  | "billing.invoice.void"
  | "billing.payment.record"
  | "billing.payment.refund"
  | "file.upload"
  | "file.delete"
  | "file.export"
  | "staff.manage"
  | "payroll.manage"
  | "settings.manage";

const actionRoles: Record<ActionKey, AppRole[]> = {
  "appointment.create": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK"],
  "appointment.update": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK"],
  "appointment.cancel": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK"],
  "patient.create": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "FRONT_DESK"],
  "patient.update": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK"],
  "patient.archive": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"],
  "clinical.note.create": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST"],
  "clinical.note.sign": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST"],
  "clinical.note.amend": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST"],
  "treatment.plan.create": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST"],
  "treatment.plan.accept": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "FRONT_DESK"],
  "treatment.service.delete": ["OWNER"],
  "treatment.service.progress": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST"],
  "billing.receipt.record": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "FRONT_DESK", "BILLING"],
  "billing.balance.allocate": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "FRONT_DESK", "BILLING"],
  "billing.invoice.create": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "BILLING"],
  "billing.invoice.issue": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "BILLING"],
  "billing.invoice.void": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "BILLING"],
  "billing.payment.record": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "FRONT_DESK", "BILLING"],
  "billing.payment.refund": ["OWNER", "AREA_MANAGER", "BILLING"],
  "file.upload": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK"],
  "file.delete": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"],
  "file.export": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST"],
  "staff.manage": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"],
  "payroll.manage": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"],
  "settings.manage": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"],
};

export function canPerformAction(session: AppSession, action: ActionKey) {
  return hasAnyRole(session, actionRoles[action] ?? []);
}

export function allowedRolesForAction(action: ActionKey) {
  return [...(actionRoles[action] ?? [])];
}

export function requireAction(session: AppSession, action: ActionKey) {
  if (!canPerformAction(session, action)) {
    throw new ActionPermissionError(action, session.role);
  }
}

export class ActionPermissionError extends Error {
  constructor(
    public readonly action: ActionKey,
    public readonly role: AppRole,
  ) {
    super(`Role ${role} cannot perform ${action}.`);
    this.name = "ActionPermissionError";
  }
}
