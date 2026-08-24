import { getUnifiedEarningsWorkspace } from "@/features/earnings/server/get-unified-earnings";
import { requireViewSession } from "@/lib/auth";
import { OperationsWorkspace } from "@/workspaces/operations/OperationsWorkspace";

export default async function OperationsPage() {
  const session = await requireViewSession("reports");
  const model = await getUnifiedEarningsWorkspace(session, { scope: "management" });

  return <OperationsWorkspace model={model} session={session} />;
}
