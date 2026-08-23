import "server-only";

import {
  canAccessFinanceOperations,
  getFinanceOperations,
} from "@/features/finance/server/get-finance-operations";
import type { AppSession } from "@/lib/session";
import type { TaskInboxItemSummary } from "@/lib/task-inbox-types";

export async function getFinanceOperationsSignals(
  session: AppSession,
): Promise<TaskInboxItemSummary[]> {
  if (!canAccessFinanceOperations(session)) {
    return [];
  }

  const model = await getFinanceOperations(session);

  return model.issues.map((issue) => ({
    id: `finance:${issue.id}`,
    sourceId: issue.id,
    kind: "billing",
    priority: issue.priority,
    title: issue.title,
    detail: issue.detail,
    href: issue.href,
    dueAt: issue.dueAt,
    patientName: issue.patientName,
    clinicName: issue.clinicName,
    status: issue.status,
    assignedToName: null,
    actionable: false,
    actionUrl: issue.href,
  }));
}
