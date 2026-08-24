import { requireViewSession } from "@/lib/auth";
import { getTaskInboxWorkspace } from "@/lib/task-inbox";
import { WorkWorkspace } from "@/workspaces/work/WorkWorkspace";

export default async function WorkPage() {
  const session = await requireViewSession("dashboard");
  const workspace = await getTaskInboxWorkspace(session);

  return <WorkWorkspace session={session} workspace={workspace} />;
}
