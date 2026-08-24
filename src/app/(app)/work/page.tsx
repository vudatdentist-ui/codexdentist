import { getClinicalExecutionSignals } from "@/features/work/server/get-clinical-execution-signals";
import { getFinanceOperationsSignals } from "@/features/work/server/get-finance-operations-signals";
import { getStaffOperationsSignals } from "@/features/work/server/get-staff-operations-signals";
import { requireViewSession } from "@/lib/auth";
import { getTaskInboxWorkspace } from "@/lib/task-inbox";
import { WorkWorkspace } from "@/workspaces/work/WorkWorkspace";

export default async function WorkPage() {
  const session = await requireViewSession("dashboard");
  const [
    workspace,
    executionSignals,
    staffOperationsSignals,
    financeOperationsSignals,
  ] = await Promise.all([
    getTaskInboxWorkspace(session),
    getClinicalExecutionSignals(session),
    getStaffOperationsSignals(session),
    getFinanceOperationsSignals(session),
  ]);

  return (
    <WorkWorkspace
      session={session}
      workspace={{
        ...workspace,
        items: [
          ...financeOperationsSignals,
          ...staffOperationsSignals,
          ...executionSignals,
          ...workspace.items,
        ],
      }}
    />
  );
}
