import { notFound } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { getPatient360Workspace } from "@/workspaces/patients/get-patient-360-workspace";
import { Patient360Workspace } from "@/workspaces/patients/Patient360Workspace";

export default async function Patient360Page({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const { patientId } = await params;
  const session = await requireViewSession("patients");
  const model = await getPatient360Workspace(session, patientId);

  if (!model.selectedPatientId) {
    notFound();
  }

  return <Patient360Workspace model={model} session={session} />;
}
