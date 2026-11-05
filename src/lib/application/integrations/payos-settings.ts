import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/env";
import { canPerformAction } from "@/lib/actions/permissions";
import { hasAnyRole } from "@/lib/permissions";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import type { AppSession } from "@/lib/session";
import { runSerializableTransaction } from "@/lib/transaction";
import { upsertIntegrationConnection } from "@/infrastructure/integrations/substrate";
import { writeIntegrationSecrets } from "@/infrastructure/integrations/credential-vault";
import { referenceMetadata, type IntegrationConnectionRecord } from "@/infrastructure/integrations/phase3-store";
import { hasUnresolvedPayOSOrders, payOSConnections, payOSConnectionSummary } from "@/infrastructure/integrations/payos-workspace-store";
import type { PayOSSettingsWorkspace } from "@/features/integrations/payos-workspace";

function fail(code: string, status = 400): never { throw Object.assign(new Error(code), { code, status }); }
function authorize(session: AppSession, mutate = false) {
  if (!canPerformAction(session, "settings.manage")) fail("forbidden", 403);
  if (mutate && session.isDemo) fail("payos-demo-unavailable", 403);
}
function clinicScope(session: AppSession, value: unknown) {
  if (value === null && hasAnyRole(session, ["OWNER", "AREA_MANAGER"])) return null;
  if (typeof value !== "string" || !accessibleClinicIds(session).includes(value)) fail("integration-clinic-forbidden", 403);
  return value;
}
export async function getPayOSSettings(session: AppSession): Promise<PayOSSettingsWorkspace> {
  authorize(session);
  const clinics = session.clinics.filter(clinic => accessibleClinicIds(session).includes(clinic.id)).map(({ id, name }) => ({ id, name }));
  const connections = await payOSConnections(prisma, session.organizationId, clinics.map(clinic => clinic.id));
  return { clinics, canManageOrganization: hasAnyRole(session, ["OWNER", "AREA_MANAGER"]), isDemo: session.isDemo,
    connections: connections.map(connection => payOSConnectionSummary(connection, appBaseUrl())) };
}
export async function savePayOSSettings(session: AppSession, body: Record<string, unknown>) {
  authorize(session, true);
  const clinicId = clinicScope(session, body.clinicId);
  const action = body.action;
  if (!["save", "enable", "disable"].includes(String(action))) fail("payos-input-invalid");
  let credentials: Record<string, string> | null = null;
  if (action === "save") {
    if (!body.credentials || typeof body.credentials !== "object" || Array.isArray(body.credentials)) fail("payos-input-invalid");
    credentials = {};
    for (const field of ["clientId", "apiKey", "checksumKey"]) {
      const value = (body.credentials as Record<string, unknown>)[field];
      if (typeof value !== "string" || !/^[\x21-\x7e]{8,500}$/.test(value.trim())) fail("payos-credential-invalid");
      credentials[field] = value.trim();
    }
  }
  await runSerializableTransaction(async tx => {
    const rows = await tx.$queryRawUnsafe<IntegrationConnectionRecord[]>(
      `SELECT * FROM "IntegrationConnection" WHERE "organizationId"=$1 AND "provider"='payos'
       AND "clinicId" IS NOT DISTINCT FROM $2::text FOR UPDATE`, session.organizationId, clinicId);
    const current = rows[0];
    if (current && action !== "enable" && await hasUnresolvedPayOSOrders(tx, current.id, session.organizationId)) fail("payos-orders-unresolved", 409);
    if (!credentials && !current) fail("payos-connection-not-configured", 409);
    const connection = await upsertIntegrationConnection(tx, {
      organizationId: session.organizationId, clinicId, provider: "payos", status: action === "disable" ? "DISABLED" : "ACTIVE",
      ...(credentials ? { secretRef: "vault:v1", lastVerifiedAt: null,
        metadata: { configuredByUserId: session.userId, webhookConfirmed: false } } : {}),
      capabilities: { paymentLinks: true, webhooks: true },
    });
    if (credentials) await writeIntegrationSecrets(tx, {
      organizationId: session.organizationId, connectionId: connection.id, provider: "payos",
    }, credentials);
    await tx.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId,
      action: `integration.payos_${action}`, entityType: "IntegrationConnection", entityId: connection.id,
      metadata: { clinicId, credentialsChanged: Boolean(credentials) } } });
  });
  return getPayOSSettings(session);
}
export async function verifyPayOSSettings(session: AppSession, body: Record<string, unknown>,
  verify: (connection: IntegrationConnectionRecord, webhookUrl: string) => Promise<void>) {
  authorize(session, true);
  const clinicId = clinicScope(session, body.clinicId);
  const verificationId = randomUUID();
  const connection = await runSerializableTransaction(async tx => {
    const rows = await tx.$queryRawUnsafe<IntegrationConnectionRecord[]>(
      `SELECT * FROM "IntegrationConnection" WHERE "organizationId"=$1 AND "provider"='payos'
       AND "clinicId" IS NOT DISTINCT FROM $2::text AND "status"='ACTIVE' FOR UPDATE`, session.organizationId, clinicId);
    const current = rows[0];
    if (!current || !payOSConnectionSummary(current, appBaseUrl()).configured) fail("payos-connection-not-configured", 409);
    const metadata = { ...referenceMetadata(current), verificationId,
      verificationExpiresAt: new Date(Date.now() + 60_000).toISOString(), verificationObservedId: null };
    await tx.$executeRawUnsafe(`UPDATE "IntegrationConnection" SET "metadata"=$2::jsonb,
      "updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE "id"=$1`, current.id, JSON.stringify(metadata));
    return { ...current, metadata };
  });
  const url = `${appBaseUrl()}/api/integrations/payos/webhooks/${encodeURIComponent(connection.id)}?verification=${verificationId}`;
  await verify(connection, url);
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE "IntegrationConnection" SET "lastVerifiedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      "updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      "metadata"="metadata" || '{"webhookConfirmed":true}'::jsonb
     WHERE "id"=$1 AND "organizationId"=$2 AND "status"='ACTIVE'
       AND "metadata"->>'verificationId'=$3 AND "metadata"->>'verificationObservedId'=$3
       AND ("metadata"->>'verificationExpiresAt')::timestamptz > CURRENT_TIMESTAMP`,
    connection.id, session.organizationId, verificationId);
  if (changed !== 1) fail("payos-webhook-not-confirmed", 409);
  await prisma.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId,
    action: "integration.payos_verified", entityType: "IntegrationConnection", entityId: connection.id,
    metadata: { clinicId } } });
  return getPayOSSettings(session);
}
