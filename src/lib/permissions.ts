import type { AppSession } from "@/lib/session";

export type AppRole =
  | "OWNER"
  | "AREA_MANAGER"
  | "CLINIC_MANAGER"
  | "DENTIST"
  | "HYGIENIST"
  | "FRONT_DESK"
  | "BILLING"
  | "PATIENT";

export type ViewKey =
  | "dashboard"
  | "schedule"
  | "patients"
  | "journey"
  | "clinical"
  | "treatment"
  | "billing"
  | "accounting"
  | "services"
  | "staff"
  | "crm"
  | "inventory"
  | "pharmacy"
  | "forms"
  | "learning"
  | "employee-app"
  | "reports"
  | "community"
  | "patient-app"
  | "settings";

export const viewRoutes: Record<ViewKey, string> = {
  dashboard: "/dashboard",
  schedule: "/schedule",
  patients: "/patients",
  journey: "/journey",
  clinical: "/clinical",
  treatment: "/treatment",
  billing: "/billing",
  accounting: "/accounting",
  services: "/services",
  staff: "/staff",
  crm: "/crm",
  inventory: "/inventory",
  pharmacy: "/pharmacy",
  forms: "/forms",
  learning: "/learning",
  "employee-app": "/employee-app",
  reports: "/reports",
  community: "/community",
  "patient-app": "/patient-app",
  settings: "/settings",
};

export const roleLabels: Record<AppRole, string> = {
  OWNER: "Owner",
  AREA_MANAGER: "Area manager",
  CLINIC_MANAGER: "Clinic manager",
  DENTIST: "Dentist",
  HYGIENIST: "Hygienist",
  FRONT_DESK: "Front desk",
  BILLING: "Billing",
  PATIENT: "Patient",
};

const rolePriority: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
  "BILLING",
  "PATIENT",
];

const viewAccess: Record<ViewKey, AppRole[]> = {
  dashboard: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"],
  schedule: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK"],
  patients: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK", "BILLING"],
  journey: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK", "BILLING"],
  clinical: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST"],
  treatment: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "FRONT_DESK", "BILLING"],
  billing: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "FRONT_DESK", "BILLING"],
  accounting: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"],
  services: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "BILLING"],
  staff: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"],
  crm: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK"],
  inventory: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "FRONT_DESK"],
  pharmacy: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST"],
  forms: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK"],
  learning: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK", "BILLING"],
  "employee-app": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK", "BILLING"],
  reports: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"],
  community: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK", "BILLING"],
  "patient-app": ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "FRONT_DESK", "PATIENT"],
  settings: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"],
};

export type RoleSource = AppRole | Pick<AppSession, "role" | "roles" | "roleAssignments">;

export function effectiveRoles(source: RoleSource): AppRole[] {
  if (typeof source === "string") {
    return [source];
  }

  const roles = new Set<AppRole>();

  roles.add(source.role);
  source.roles?.forEach((role) => roles.add(role));
  source.roleAssignments
    ?.filter((assignment) => assignment.organizationId)
    .forEach((assignment) => roles.add(assignment.role));

  return rolePriority.filter((role) => roles.has(role));
}

export function primaryRoleForRoles(roles: AppRole[]) {
  const roleSet = new Set(roles);

  return rolePriority.find((role) => roleSet.has(role)) ?? "PATIENT";
}

export function hasAnyRole(source: RoleSource, roles: AppRole[]) {
  const allowed = new Set(roles);

  return effectiveRoles(source).some((role) => allowed.has(role));
}

export function canAccessView(source: RoleSource, view: ViewKey) {
  return hasAnyRole(source, viewAccess[view]);
}

export function accessibleViews(source: RoleSource) {
  return Object.keys(viewRoutes).filter((view) =>
    canAccessView(source, view as ViewKey),
  ) as ViewKey[];
}

export function defaultViewForRole(source: RoleSource): ViewKey {
  const roles = effectiveRoles(source);

  if (roles.length === 1 && roles[0] === "PATIENT") {
    return "patient-app";
  }

  return accessibleViews(source)[0] ?? "schedule";
}

export function canUseAllClinics(source: RoleSource) {
  return hasAnyRole(source, ["OWNER", "AREA_MANAGER"]);
}
