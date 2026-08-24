import type { ViewKey } from "@/lib/permissions";

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
    permissionView: "reports",
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
