import "server-only";

import { getUnifiedEarningsWorkspace } from "@/features/earnings/server/get-unified-earnings";
import { canAccessView } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";
import type { TaskInboxItemSummary } from "@/lib/task-inbox-types";

export async function getStaffOperationsSignals(
  session: AppSession,
): Promise<TaskInboxItemSummary[]> {
  if (!canAccessView(session, "staff")) {
    return [];
  }

  const model = await getUnifiedEarningsWorkspace(session, { scope: "management" });

  return model.issues.map((issue) => ({
    id: `staff-ops:${issue.id}`,
    sourceId: issue.id,
    kind: "hr",
    priority: issue.priority,
    title: issue.title,
    detail: issue.detail,
    href: issue.href,
    dueAt: issue.dueAt,
    patientName: null,
    clinicName: issue.clinicName,
    status: issue.status,
    assignedToName: null,
    actionable: false,
    actionUrl: issue.href,
  }));
}
