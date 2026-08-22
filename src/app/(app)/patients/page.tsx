import { requireViewSession } from "@/lib/auth";
import { getPatient360Workspace } from "@/workspaces/patients/get-patient-360-workspace";
import { Patient360Workspace } from "@/workspaces/patients/Patient360Workspace";

export default async function PatientsPage() {
  const session = await requireViewSession("patients");
  const model = await getPatient360Workspace(session);

  return <Patient360Workspace model={model} session={session} />;
}
