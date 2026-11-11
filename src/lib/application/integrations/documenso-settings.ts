import "server-only";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/env";
import { canPerformAction } from "@/lib/actions/permissions";
import { hasAnyRole } from "@/lib/permissions";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import type { AppSession } from "@/lib/session";
import { runSerializableTransaction } from "@/lib/transaction";
import { upsertIntegrationConnection } from "@/infrastructure/integrations/substrate";
import { writeIntegrationSecrets } from "@/infrastructure/integrations/credential-vault";
import type { IntegrationConnectionRecord } from "@/infrastructure/integrations/phase3-store";
import { documensoConnections, documensoConnectionSummary, hasActiveDocumensoRequests } from "@/infrastructure/integrations/documenso-workspace-store";
import type { DocumensoSettingsWorkspace } from "@/features/integrations/documenso-workspace";

export function documensoFail(code: string, status = 400): never { throw Object.assign(new Error(code), { code, status }); }

export async function getDocumensoSettings(session: AppSession): Promise<DocumensoSettingsWorkspace> {
  if (!canPerformAction(session, "settings.manage")) documensoFail("forbidden", 403);
  const clinics = session.clinics.filter(clinic => accessibleClinicIds(session).includes(clinic.id)).map(({ id, name }) => ({ id, name }));
  const rows = await documensoConnections(prisma, session.organizationId, clinics.map(clinic => clinic.id));
  return { clinics, canManageOrganization: hasAnyRole(session, ["OWNER", "AREA_MANAGER"]), isDemo: session.isDemo,
    connections: rows.map(row => documensoConnectionSummary(row, appBaseUrl())) };
}

export async function saveDocumensoSettings(session: AppSession, body: Record<string, unknown>) {
  if (!canPerformAction(session, "settings.manage")) documensoFail("forbidden", 403);
  if (session.isDemo) documensoFail("documenso-demo-unavailable", 403);
  const clinicId = body.clinicId;
  if (!(clinicId === null && hasAnyRole(session, ["OWNER", "AREA_MANAGER"])) &&
      (typeof clinicId !== "string" || !accessibleClinicIds(session).includes(clinicId))) documensoFail("integration-clinic-forbidden", 403);
  if (clinicId !== null && typeof clinicId !== "string") documensoFail("integration-clinic-forbidden", 403);
  const action = body.action;
  if (!["save", "save-disabled", "enable", "disable"].includes(String(action))) documensoFail("documenso-input-invalid");
  let credentials: Record<string, string> | null = null;
  if (action === "save" || action === "save-disabled") {
    if (!body.credentials || typeof body.credentials !== "object" || Array.isArray(body.credentials)) documensoFail("documenso-input-invalid");
    credentials = {};
    for (const name of ["apiToken", "webhookSecret"]) {
      const value = (body.credentials as Record<string, unknown>)[name];
      if (typeof value !== "string" || !/^[\x21-\x7e]{8,2000}$/.test(value.trim())) documensoFail("documenso-credential-invalid");
      credentials[name] = value.trim();
    }
  }
  await runSerializableTransaction(async tx => {
    const rows = await tx.$queryRawUnsafe<IntegrationConnectionRecord[]>(
      `SELECT * FROM "IntegrationConnection" WHERE "organizationId"=$1 AND "provider"='documenso'
       AND "clinicId" IS NOT DISTINCT FROM $2::text FOR UPDATE`, session.organizationId, clinicId);
    const current = rows[0];
    if (current && action !== "enable" && await hasActiveDocumensoRequests(tx, session.organizationId, current.id)) documensoFail("documenso-ceremonies-unresolved", 409);
    if (!current && !credentials) documensoFail("documenso-connection-not-configured", 409);
    const connection = await upsertIntegrationConnection(tx, { organizationId: session.organizationId, clinicId,
      provider: "documenso", status: action === "disable" || action === "save-disabled" ? "DISABLED" : "ACTIVE",
      capabilities: { signing: true, webhooks: true },
      ...(credentials ? { secretRef: "vault:v1", lastVerifiedAt: null, metadata: { configuredByUserId: session.userId } } : {}) });
    if (credentials) await writeIntegrationSecrets(tx, { organizationId: session.organizationId, connectionId: connection.id, provider: "documenso" }, credentials);
    await tx.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId,
      action: `integration.documenso_${action}`, entityType: "IntegrationConnection", entityId: connection.id,
      metadata: { clinicId, credentialsChanged: Boolean(credentials) } } });
  });
  return getDocumensoSettings(session);
}
