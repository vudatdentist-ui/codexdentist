import { requireViewSession } from "@/lib/auth";
import { getPatient360Workspace } from "@/workspaces/patients/get-patient-360-workspace";
import { Patient360Workspace } from "@/workspaces/patients/Patient360Workspace";

export default async function JourneyPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const patientId = firstValue(params?.patientId);
  const session = await requireViewSession("journey");
  const model = await getPatient360Workspace(session, patientId);

  return <Patient360Workspace model={model} session={session} />;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
