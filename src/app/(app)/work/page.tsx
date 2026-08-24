import { getClinicalExecutionSignals } from "@/features/work/server/get-clinical-execution-signals";
import { getStaffOperationsSignals } from "@/features/work/server/get-staff-operations-signals";
import { requireViewSession } from "@/lib/auth";
import { getTaskInboxWorkspace } from "@/lib/task-inbox";
import { WorkWorkspace } from "@/workspaces/work/WorkWorkspace";

export default async function WorkPage() {
  const session = await requireViewSession("dashboard");
  const [workspace, executionSignals, staffOperationsSignals] = await Promise.all([
    getTaskInboxWorkspace(session),
    getClinicalExecutionSignals(session),
    getStaffOperationsSignals(session),
  ]);

  return (
    <WorkWorkspace
      session={session}
      workspace={{
        ...workspace,
        items: [...staffOperationsSignals, ...executionSignals, ...workspace.items],
      }}
    />
  );
}
