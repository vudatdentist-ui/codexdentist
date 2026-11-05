import "server-only";
import type { ReactNode } from "react";
import type { AppSession } from "@/lib/session";
import { accessibleViews, effectiveRoles, roleLabels } from "@/lib/permissions";
import { OperationsWorkspaceShell } from "./OperationsWorkspaceShell";

export function OperationsWorkspaceFrame({ view, session, children }: {
  view: "imaging" | "lab" | "sterilization";
  session: AppSession;
  children: ReactNode;
}) {
  return <OperationsWorkspaceShell view={view} permittedViews={accessibleViews(session)}
    userName={session.fullName} organizationName={session.organizationName}
    roleLabel={roleLabels[effectiveRoles(session)[0] ?? session.role]}>
    {children}
  </OperationsWorkspaceShell>;
}
