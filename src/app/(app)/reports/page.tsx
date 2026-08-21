import { requireViewSession } from "@/lib/auth";
import { accessibleViews } from "@/lib/permissions";
import { AppShellV2 } from "@/shared/layout/AppShell/AppShell";
import { loadReportsWorkspace } from "@/workspaces/reports/loadReportsWorkspace";
import { ReportsWorkspace } from "@/workspaces/reports/ReportsWorkspace";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    clinicId?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const session = await requireViewSession("reports");
  const params = await searchParams;
  const data = await loadReportsWorkspace(session, {
    clinicId: params?.clinicId,
    from: params?.from,
    to: params?.to,
  });

  return (
    <AppShellV2
      activeView="reports"
      allowedViews={accessibleViews(session)}
      session={session}
      title={{ vi: "Báo cáo", en: "Reports" }}
    >
      <ReportsWorkspace data={data} />
    </AppShellV2>
  );
}
