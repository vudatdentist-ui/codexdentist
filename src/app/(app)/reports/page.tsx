import { logoutAction } from "@/app/(app)/actions";
import { requireViewSession } from "@/lib/auth";
import { loadAppShellContext } from "@/server/app-shell/loadAppShellContext";
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
  const [shell, data] = await Promise.all([
    loadAppShellContext(session),
    loadReportsWorkspace(session, {
      clinicId: params?.clinicId,
      from: params?.from,
      to: params?.to,
    }),
  ]);

  return (
    <AppShellV2
      activeView="reports"
      allowedViews={shell.allowedViews}
      context={shell.context}
      notifications={shell.notifications}
      signOutAction={logoutAction}
      title={{ vi: "Báo cáo", en: "Reports" }}
    >
      <ReportsWorkspace data={data} />
    </AppShellV2>
  );
}
