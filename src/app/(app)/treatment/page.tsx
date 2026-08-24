import { requireViewSession } from "@/lib/auth";
import { getTreatmentCasesWorkspace } from "@/workspaces/treatment/get-treatment-cases-workspace";
import { TreatmentCasesWorkspace } from "@/workspaces/treatment/TreatmentCasesWorkspace";

export default async function TreatmentPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const patientId = firstValue(params?.patientId);
  const session = await requireViewSession("treatment");
  const model = await getTreatmentCasesWorkspace(session, { patientId });

  return <TreatmentCasesWorkspace model={model} session={session} />;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
