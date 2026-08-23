import { notFound } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { getTreatmentCasesWorkspace } from "@/workspaces/treatment/get-treatment-cases-workspace";
import { TreatmentCasesWorkspace } from "@/workspaces/treatment/TreatmentCasesWorkspace";

export default async function TreatmentCasePage({
  params,
}: {
  params: Promise<{ patientId: string; treatmentServiceId: string }>;
}) {
  const { patientId, treatmentServiceId } = await params;
  const session = await requireViewSession("treatment");
  const model = await getTreatmentCasesWorkspace(session, {
    patientId,
    treatmentServiceId,
  });

  if (!model.treatmentCase || model.treatmentCase.patientId !== patientId) {
    notFound();
  }

  return <TreatmentCasesWorkspace model={model} session={session} />;
}
