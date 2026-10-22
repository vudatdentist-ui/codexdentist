import { roleLabels, type AppRole } from "@/lib/permissions";
export function staffRoleTitle(role: AppRole) { return roleLabels[role] ?? role; }
