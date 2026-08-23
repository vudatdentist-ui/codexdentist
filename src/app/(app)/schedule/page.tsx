import { getPatientAccessModel } from "@/features/patient-access/server/get-patient-access";
import { requireViewSession } from "@/lib/auth";
import { ScheduleWorkspace } from "@/workspaces/schedule/ScheduleWorkspace";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string | string[];
    notice?: string | string[];
  }>;
}) {
  const session = await requireViewSession("schedule");
  const params = await searchParams;
  const rawDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const rawNotice = Array.isArray(params.notice) ? params.notice[0] : params.notice;
  const model = await getPatientAccessModel(session, rawDate);

  return <ScheduleWorkspace model={model} notice={rawNotice ?? null} session={session} />;
}
