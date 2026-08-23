import { getCareOperationsModel } from "@/features/patient-access/server/get-care-operations";
import { requireViewSession } from "@/lib/auth";
import { CareWorkspace } from "@/workspaces/care/CareWorkspace";

export default async function CarePage({
  searchParams,
}: {
  searchParams: Promise<{
    notice?: string | string[];
    appointmentId?: string | string[];
  }>;
}) {
  const session = await requireViewSession("crm");
  const [model, params] = await Promise.all([getCareOperationsModel(session), searchParams]);
  const notice = Array.isArray(params.notice) ? params.notice[0] : params.notice;
  const appointmentId = Array.isArray(params.appointmentId) ? params.appointmentId[0] : params.appointmentId;

  return (
    <CareWorkspace
      model={model}
      notice={notice ?? null}
      selectedAppointmentId={appointmentId ?? null}
      session={session}
    />
  );
}
