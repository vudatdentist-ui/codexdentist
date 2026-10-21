import "server-only";

import { hasAnyRole } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";

export function superAdminEmails() {
  return (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdminSession(session: AppSession) {
  // Trial/demo workspaces are self-service identities, never platform operators.
  return !session.isDemo && session.workspaceExpiresAt === null &&
    hasAnyRole({ ...session, activeClinicId: null }, ["OWNER"]) &&
    superAdminEmails().includes(session.email.toLowerCase());
}
