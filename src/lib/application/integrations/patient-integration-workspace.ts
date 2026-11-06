import "server-only";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { patientAccessWhere } from "@/lib/patient-access";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import { hasAnyRole } from "@/lib/permissions";
import { canPerformAction } from "@/lib/actions/permissions";
import { findOptionalProviderConnection, optionalConnectionIsVerified, optionalProviderFail } from "./optional-provider-settings";
import type { OptionalProvider } from "@/features/integrations/optional-provider";
export async function getPatientIntegrationWorkspace(session: AppSession, patientId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(patientId)) optionalProviderFail("integration-patient-not-found", 404);
  const patient = await prisma.patient.findFirst({ where: { ...patientAccessWhere(session), id: patientId,
    clinicId: { in: accessibleClinicIds(session) } }, select: { id: true, clinicId: true } });
  if (!patient) optionalProviderFail("integration-patient-not-found", 404);
  const scoped = { ...session, activeClinicId: patient.clinicId };
  const allowed: Record<string, boolean> = { chatwoot: hasAnyRole(scoped, ["OWNER", "FRONT_DESK"]),
    medplum: canPerformAction(scoped, "interop.patient.export"), novu: canPerformAction(scoped, "settings.manage") };
  const services = await Promise.all((["chatwoot", "medplum", "novu"] as OptionalProvider[]).map(async provider => {
    if (session.isDemo || !allowed[provider]) return { provider, allowed: false, enabled: false };
    const connection = await findOptionalProviderConnection(prisma, { organizationId: session.organizationId, clinicId: patient.clinicId, provider });
    return { provider, allowed: true, enabled: Boolean(connection && connection.status === "ACTIVE" && optionalConnectionIsVerified(connection)) };
  }));
  return { patientId: patient.id, clinicId: patient.clinicId, canManage: canPerformAction(scoped, "settings.manage"), services };
}
