import { requireViewSession } from "@/lib/auth";
import { getTodayWorkspace } from "@/workspaces/today/get-today-workspace";
import { TodayWorkspace } from "@/workspaces/today/TodayWorkspace";

export default async function TodayPage() {
  const session = await requireViewSession("dashboard");
  const model = await getTodayWorkspace(session);

  return <TodayWorkspace model={model} session={session} />;
}
