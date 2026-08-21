import "server-only";

import { getReportsWorkspace } from "@/lib/reports";
import type { AppSession } from "@/lib/session";

export type ReportsRouteParams = {
  clinicId?: string | null;
  from?: string | null;
  to?: string | null;
};

export async function loadReportsWorkspace(
  session: AppSession,
  params: ReportsRouteParams,
) {
  return getReportsWorkspace(session, {
    clinicId: params.clinicId,
    from: params.from,
    to: params.to,
  });
}
