import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Notification, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/transaction";
import { loadOptionalProviderConnectionForScope } from "@/lib/application/integrations/optional-provider-settings";
import { credentialNotificationTemplateKeys } from "@/lib/notification-templates";
import type { ExternalReferenceRecord, IntegrationConnectionRecord } from "@/infrastructure/integrations/phase3-store";
import { referenceMetadata } from "@/infrastructure/integrations/phase3-store";
import { novuConfig, NovuError, observeNovuDelivery, triggerNovu, verifyNovuSubscriber,
  verifyNovuSyntheticSubscriber, verifyNovuWorkflow } from "@/integrations/novu/client";
import type { NovuDeliveryState } from "@/features/integrations/novu-workspace";

export type NovuScope = { organizationId: string; clinicId: string };
export type NovuConnection = { connection: IntegrationConnectionRecord; secrets: Record<string, string> };
type DB = Prisma.TransactionClient | typeof prisma;
export const novuFingerprint = (secrets: Record<string, string>) => {
  const { baseUrl, environmentId, workflowId, testSubscriberId } = novuConfig(secrets);
  // Parent verification binds rotations to the same provider identity. Rotating
  // an API key must not strand reconciliation for an otherwise identical account.
  return createHash("sha256").update(JSON.stringify({ baseUrl, environmentId, workflowId, testSubscriberId })).digest("hex");
};
const referenceId = (organizationId: string, id: string) => `novu-${createHash("sha256").update(JSON.stringify([organizationId, id])).digest("hex")}`;
export function novuFail(code: string, status = 409): never { throw new NovuError(code, status); }
export async function novuLockConnection(tx: Prisma.TransactionClient, scope: NovuScope, loaded: NovuConnection) {
  const rows = await tx.$queryRawUnsafe<IntegrationConnectionRecord[]>(`SELECT * FROM "IntegrationConnection"
    WHERE "id"=$1 AND "organizationId"=$2 AND "provider"='novu' AND "status"='ACTIVE'
      AND ("clinicId" IS NULL OR "clinicId"=$3) AND "lastVerifiedAt" IS NOT NULL FOR UPDATE`, loaded.connection.id, scope.organizationId, scope.clinicId);
  if (!rows[0] || rows[0].updatedAt.getTime() !== loaded.connection.updatedAt.getTime()) novuFail("novu-connection-changed");
  const current = referenceMetadata(rows[0]), captured = referenceMetadata(loaded.connection);
  if (typeof current.configurationVersion !== "string" || !current.configurationVersion ||
    current.verifiedVersion !== current.configurationVersion || current.configurationVersion !== captured.configurationVersion ||
    typeof current.providerIdentity !== "string" || !current.providerIdentity || current.providerIdentity !== captured.providerIdentity) novuFail("novu-connection-changed");
}
export async function novuReference(db: DB, scope: NovuScope, id: string) {
  const rows = await db.$queryRawUnsafe<ExternalReferenceRecord[]>(`SELECT * FROM "ExternalReference"
    WHERE "id"=$1 AND "organizationId"=$2 AND "clinicId"=$3 AND "provider"='novu'`, id, scope.organizationId, scope.clinicId);
  return rows[0] ?? null;
}
export async function novuSubscriberReference(db: DB, scope: NovuScope, connectionId: string, patientId: string) {
  const rows = await db.$queryRawUnsafe<ExternalReferenceRecord[]>(`SELECT * FROM "ExternalReference"
    WHERE "organizationId"=$1 AND "clinicId"=$2 AND "connectionId"=$3 AND "provider"='novu'
      AND "entityType"='NOVU_SUBSCRIBER' AND "internalId"=$4`, scope.organizationId, scope.clinicId, connectionId, patientId);
  return rows[0] ?? null;
}
// Diagnostic guard for operator/readiness composition. The parent settings
// helper conservatively blocks account replacement whenever any reference exists;
// verified rotations preserve identity and may still reconcile these deliveries.
export async function hasUnresolvedNovuDeliveries(db: DB, organizationId: string, connectionId: string) {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "ExternalReference"
    WHERE "organizationId"=$1 AND "connectionId"=$2 AND "provider"='novu' AND "entityType"='NOVU_DELIVERY'
      AND "metadata"->>'state' IN ('RESERVED','ACCEPTED','UNCERTAIN') LIMIT 1`, organizationId, connectionId);
  return rows.length > 0;
}
async function setState(scope: NovuScope, id: string, state: NovuDeliveryState) {
  // A stale provider response must never downgrade a concurrent SENT observation.
  await prisma.$executeRawUnsafe(`UPDATE "ExternalReference" SET "metadata"=jsonb_set("metadata",'{state}',to_jsonb($4::text)),
    "updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE "id"=$1 AND "organizationId"=$2 AND "clinicId"=$3
    AND "provider"='novu' AND "entityType"='NOVU_DELIVERY' AND "metadata"->>'state'<>'SENT'`, id, scope.organizationId, scope.clinicId, state);
}
export async function sendNovuDelivery(scope: NovuScope, loaded: NovuConnection, input: {
  internalId: string; subscriberId: string; synthetic: boolean; expectedEmail?: string;
}) {
  const fingerprint = novuFingerprint(loaded.secrets);
  const id = referenceId(scope.organizationId, input.internalId);
  const previous = await novuReference(prisma, scope, id);
  if (previous) return { id, state: String(referenceMetadata(previous).state), duplicate: true };
  const workflow = await verifyNovuWorkflow(loaded.secrets);
  const subscriber = input.synthetic ? await verifyNovuSyntheticSubscriber(loaded.secrets)
    : await verifyNovuSubscriber(loaded.secrets, input.subscriberId, input.expectedEmail);
  if (input.synthetic && input.subscriberId !== novuConfig(loaded.secrets).testSubscriberId) novuFail("novu-test-subscriber-required");
  const reserved = await runSerializableTransaction(async tx => {
    await novuLockConnection(tx, scope, loaded);
    const existing = await novuReference(tx, scope, id);
    if (existing) return { reference: existing, duplicate: true };
    const metadata = { state: "RESERVED", synthetic: input.synthetic, fingerprint, subscriberId: input.subscriberId,
      subscriberDatabaseId: subscriber.subscriberDatabaseId, workflowDatabaseId: workflow.workflowDatabaseId };
    const rows = await tx.$queryRawUnsafe<ExternalReferenceRecord[]>(`INSERT INTO "ExternalReference"
      ("id","organizationId","clinicId","connectionId","provider","entityType","internalId","externalId","metadata","createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,'novu','NOVU_DELIVERY',$5,$6,$7::jsonb,(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
      ON CONFLICT ("id") DO NOTHING RETURNING *`,
    id, scope.organizationId, scope.clinicId, loaded.connection.id, input.internalId, randomUUID(), JSON.stringify(metadata));
    if (!rows[0]) throw Object.assign(new Error("novu-reservation-conflict"), { code: "P2034" });
    return { reference: rows[0], duplicate: false };
  });
  if (reserved.duplicate) return { id, state: String(referenceMetadata(reserved.reference).state), duplicate: true };
  // Reserve before I/O. A crash at any point leaves a non-replayable record.
  try {
    await triggerNovu(loaded.secrets, { transactionId: reserved.reference.externalId, subscriberId: input.subscriberId, synthetic: input.synthetic });
    await setState(scope, id, "ACCEPTED");
    return { id, state: "ACCEPTED", duplicate: false };
  } catch (error) {
    // Even definitive rejection is retained for this intent. Creating a fresh
    // intent requires deliberate operator action, never a retry timer.
    const rejected = error instanceof NovuError && [400, 401, 403, 404, 422].includes(error.status);
    await setState(scope, id, rejected ? "REJECTED" : "UNCERTAIN");
    return { id, state: rejected ? "REJECTED" : "UNCERTAIN", duplicate: false };
  }
}
export async function deliverNotificationToNovu(notification: Notification) {
  const canonical = await prisma.notification.findFirst({ where: { id: notification.id,
    organizationId: notification.organizationId, clinicId: notification.clinicId, status: "PROCESSING" } });
  if (!canonical) novuFail("novu-notification-not-claimed");
  notification = canonical;
  if (notification.channel !== "EMAIL" || !notification.patientId || !notification.clinicId ||
    credentialNotificationTemplateKeys.some(key => key === notification.templateKey)) novuFail("novu-notification-ineligible");
  const scope = { organizationId: notification.organizationId, clinicId: notification.clinicId };
  const loaded = await loadOptionalProviderConnectionForScope(scope, "novu");
  const patient = await prisma.patient.findFirst({ where: { id: notification.patientId, ...scope }, select: { id: true, email: true } });
  if (!patient?.email || patient.email !== notification.recipient) novuFail("novu-recipient-mismatch");
  const mapping = await novuSubscriberReference(prisma, scope, loaded.connection.id, patient.id);
  if (!mapping || referenceMetadata(mapping).fingerprint !== novuFingerprint(loaded.secrets) ||
    !referenceMetadata(mapping).verifiedAt) novuFail("novu-subscriber-not-verified");
  return sendNovuDelivery(scope, loaded, { internalId: notification.id, subscriberId: mapping.externalId,
    synthetic: false, expectedEmail: notification.recipient });
}
export async function reconcileNovuDelivery(scope: NovuScope, loaded: NovuConnection, id: string) {
  const reference = await novuReference(prisma, scope, id);
  if (!reference || reference.entityType !== "NOVU_DELIVERY" || reference.connectionId !== loaded.connection.id) novuFail("novu-delivery-not-found", 404);
  const metadata = referenceMetadata(reference);
  if (metadata.state === "SENT") return { id, state: "SENT" };
  if (metadata.fingerprint !== novuFingerprint(loaded.secrets)) novuFail("novu-connection-changed");
  if (typeof metadata.subscriberDatabaseId !== "string" || typeof metadata.workflowDatabaseId !== "string") novuFail("novu-delivery-invalid");
  const state = await observeNovuDelivery(loaded.secrets, { transactionId: reference.externalId,
    subscriberDatabaseId: metadata.subscriberDatabaseId, workflowDatabaseId: metadata.workflowDatabaseId });
  if (state !== "SENT") return { id, state: String(metadata.state) };
  await runSerializableTransaction(async tx => {
    await novuLockConnection(tx, scope, loaded);
    await tx.$executeRawUnsafe(`UPDATE "ExternalReference" SET "metadata"=jsonb_set("metadata",'{state}','"SENT"'::jsonb),
      "updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE "id"=$1 AND "organizationId"=$2 AND "clinicId"=$3
      AND "provider"='novu' AND "entityType"='NOVU_DELIVERY'`, id, scope.organizationId, scope.clinicId);
    if (metadata.synthetic === false) await tx.notification.updateMany({ where: { id: reference.internalId, ...scope, status: "PROCESSING",
      channel: "EMAIL", AND: [{ OR: [{ templateKey: null }, { templateKey: { notIn: [...credentialNotificationTemplateKeys] } }] }] },
      data: { status: "SENT", sentAt: new Date(), failedReason: null } });
  });
  return { id, state: "SENT" };
}
