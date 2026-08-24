import type { AppRole, ViewKey } from "@/lib/permissions";

export type ProductWorkspaceKey =
  | "today"
  | "schedule"
  | "patients"
  | "treatment"
  | "work"
  | "care"
  | "operations"
  | "settings";

export type ProductWorkspace = {
  key: ProductWorkspaceKey;
  label: string;
  href: string;
  permissionView: ViewKey;
  allowedRoles?: AppRole[];
  roleHrefs?: Array<{ roles: AppRole[]; href: string }>;
  group: "daily" | "system";
};

export const productWorkspaces: ProductWorkspace[] = [
  {
    key: "today",
    label: "Hôm nay",
    href: "/today",
    permissionView: "dashboard",
    group: "daily",
  },
  {
    key: "schedule",
    label: "Lịch hẹn",
    href: "/schedule",
    permissionView: "schedule",
    group: "daily",
  },
  {
    key: "patients",
    label: "Bệnh nhân",
    href: "/patients",
    permissionView: "patients",
    group: "daily",
  },
  {
    key: "treatment",
    label: "Điều trị",
    href: "/treatment",
    permissionView: "treatment",
    group: "daily",
  },
  {
    key: "work",
    label: "Công việc",
    href: "/work",
    permissionView: "dashboard",
    group: "daily",
  },
  {
    key: "care",
    label: "Chăm sóc",
    href: "/crm",
    permissionView: "crm",
    group: "daily",
  },
  {
    key: "operations",
    label: "Vận hành",
    href: "/operations",
    permissionView: "billing",
    allowedRoles: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "BILLING"],
    roleHrefs: [
      {
        roles: ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"],
        href: "/operations",
      },
      {
        roles: ["BILLING"],
        href: "/operations/finance",
      },
    ],
    group: "system",
  },
  {
    key: "settings",
    label: "Cài đặt",
    href: "/settings",
    permissionView: "settings",
    group: "system",
  },
];

export function getProductWorkspace(key: ProductWorkspaceKey) {
  return productWorkspaces.find((workspace) => workspace.key === key) ?? productWorkspaces[0];
}

export function productWorkspaceHref(workspace: ProductWorkspace, roles: AppRole[]) {
  return (
    workspace.roleHrefs?.find((candidate) => candidate.roles.some((role) => roles.includes(role)))?.href ??
    workspace.href
  );
}
