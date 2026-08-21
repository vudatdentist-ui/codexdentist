import "server-only";

import { accessibleViews } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";
import { getTaskInboxWorkspace } from "@/lib/task-inbox";

export async function loadAppShellContext(session: AppSession) {
  const taskInboxWorkspace = await getTaskInboxWorkspace(session);

  return {
    allowedViews: accessibleViews(session),
    context: {
      fullName: session.fullName,
      organizationName: session.organizationName,
      role: session.role,
      clinics: session.clinics.map((clinic) => ({
        id: clinic.id,
        name: clinic.name,
      })),
    },
    notifications: taskInboxWorkspace.items.slice(0, 20),
  };
}
