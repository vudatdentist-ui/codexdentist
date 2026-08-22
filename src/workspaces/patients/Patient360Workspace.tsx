import { WorkspaceChrome } from "@/features/navigation/ui/WorkspaceChrome";
import type { AppSession } from "@/lib/session";
import { Patient360Experience } from "./Patient360Experience";
import type { Patient360WorkspaceModel } from "./get-patient-360-workspace";

export function Patient360Workspace({
  model,
  session,
}: {
  model: Patient360WorkspaceModel;
  session: AppSession;
}) {
  return (
    <WorkspaceChrome activeWorkspace="patients" session={session}>
      <Patient360Experience model={model} session={session} />
    </WorkspaceChrome>
  );
}
