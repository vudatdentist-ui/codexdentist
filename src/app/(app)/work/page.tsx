import { getClinicalExecutionSignals } from "@/features/work/server/get-clinical-execution-signals";
import { requireViewSession } from "@/lib/auth";
import { getTaskInboxWorkspace } from "@/lib/task-inbox";
import { WorkWorkspace } from "@/workspaces/work/WorkWorkspace";

export default async function WorkPage() {
  const session = await requireViewSession("dashboard");
  const [workspace, executionSignals] = await Promise.all([
    getTaskInboxWorkspace(session),
    getClinicalExecutionSignals(session),
  ]);

  return (
    <WorkWorkspace
      session={session}
      workspace={{
        ...workspace,
        items: [...executionSignals, ...workspace.items],
      }}
    />
  );
}
