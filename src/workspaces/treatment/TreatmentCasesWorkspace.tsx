import { WorkspaceChrome } from "@/features/navigation/ui/WorkspaceChrome";
import type { AppSession } from "@/lib/session";
import { TreatmentCasesExperience } from "./TreatmentCasesExperience";
import type { TreatmentCasesWorkspaceModel } from "./get-treatment-cases-workspace";

export function TreatmentCasesWorkspace({
  model,
  session,
}: {
  model: TreatmentCasesWorkspaceModel;
  session: AppSession;
}) {
  return (
    <WorkspaceChrome activeWorkspace="treatment" session={session}>
      <TreatmentCasesExperience model={model} />
    </WorkspaceChrome>
  );
}
