import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { canPerformAction } from "@/lib/actions/permissions";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import { runSerializableTransaction } from "@/lib/transaction";
import { loadOptionalProviderConnection } from "@/lib/application/integrations/optional-provider-settings";
import { referenceMetadata, type ExternalReferenceRecord } from "@/infrastructure/integrations/phase3-store";
import { novuConfig, verifyNovuSubscriber } from "@/integrations/novu/client";
import { novuFail, novuFingerprint, novuLockConnection, novuSubscriberReference, reconcileNovuDelivery,
  sendNovuDelivery } from "./novu-delivery";
import type { NovuOperatorWorkspace, NovuDeliveryState } from "@/features/integrations/novu-workspace";

async function context(session: AppSession, clinicId: string, patientId?: string) {
  if (!canPerformAction(session, "settings.manage")) novuFail("forbidden", 403);
  if (session.isDemo) novuFail("novu-demo-unavailable", 403);
  if (!accessibleClinicIds(session).includes(clinicId)) novuFail("integration-clinic-forbidden", 403);
  const scope = { organizationId: session.organizationId, clinicId };
  const patient = patientId ? await prisma.patient.findFirst({ where: { id: patientId, ...scope }, select: { id: true, email: true } }) : null;
  if (patientId && !patient) novuFail("novu-patient-not-found", 404);
  const loaded = await loadOptionalProviderConnection(session, "novu", clinicId);
  return { scope, loaded, patient };
}
export async function getNovuOperatorWorkspace(session: AppSession, clinicId: string, patientId?: string): Promise<NovuOperatorWorkspace> {
  const { scope, loaded, patient } = await context(session, clinicId, patientId);
  const mapping = patient ? await novuSubscriberReference(prisma, scope, loaded.connection.id, patient.id) : null;
  const rows = await prisma.$queryRawUnsafe<ExternalReferenceRecord[]>(`SELECT * FROM "ExternalReference"
    WHERE "organizationId"=$1 AND "clinicId"=$2 AND "connectionId"=$3 AND "provider"='novu' AND "entityType"='NOVU_DELIVERY'
      AND (($5::boolean=false AND "metadata"->>'synthetic'='true') OR "metadata"->>'subscriberId'=$4)
    ORDER BY "createdAt" DESC LIMIT 20`, scope.organizationId, clinicId, loaded.connection.id, mapping?.externalId ?? null, Boolean(patientId));
  return { subscriber: mapping ? { subscriberId: mapping.externalId,
    verified: Boolean(referenceMetadata(mapping).verifiedAt) && referenceMetadata(mapping).fingerprint === novuFingerprint(loaded.secrets) } : null,
  deliveries: rows.map(row => ({ id: row.id, state: String(referenceMetadata(row).state) as NovuDeliveryState, synthetic: referenceMetadata(row).synthetic === true })) };
}
export async function runNovuOperatorCommand(session: AppSession, body: Record<string, unknown>) {
  const clinicId = typeof body.clinicId === "string" ? body.clinicId : "";
  const patientId = typeof body.patientId === "string" && body.patientId ? body.patientId : undefined;
  const { scope, loaded, patient } = await context(session, clinicId, patientId);
  if (body.action === "allocate-subscriber") {
    if (!patient) novuFail("novu-patient-required", 400);
    await runSerializableTransaction(async tx => {
      await novuLockConnection(tx, scope, loaded);
      const existing = await novuSubscriberReference(tx, scope, loaded.connection.id, patient.id);
      if (!existing) {
        const id = `novu-sub-${createHash("sha256").update(JSON.stringify([scope.organizationId, clinicId, loaded.connection.id, patient.id])).digest("hex")}`;
        const inserted = await tx.$queryRawUnsafe<ExternalReferenceRecord[]>(`INSERT INTO "ExternalReference"
          ("id","organizationId","clinicId","connectionId","provider","entityType","internalId","externalId","metadata","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,'novu','NOVU_SUBSCRIBER',$5,$6,'{}'::jsonb,(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
          ON CONFLICT ("id") DO NOTHING RETURNING *`, id, scope.organizationId, clinicId, loaded.connection.id, patient.id, `cdx-sub-${randomUUID()}`);
        if (!inserted[0]) throw Object.assign(new Error("novu-reservation-conflict"), { code: "P2034" });
      }
    });
  } else if (body.action === "verify-subscriber") {
    if (!patient?.email) novuFail("novu-patient-email-required", 400);
    const mapping = await novuSubscriberReference(prisma, scope, loaded.connection.id, patient.id);
    if (!mapping) novuFail("novu-subscriber-not-found", 404);
    await verifyNovuSubscriber(loaded.secrets, mapping.externalId, patient.email);
    await runSerializableTransaction(async tx => {
      await novuLockConnection(tx, scope, loaded);
      const current = await tx.patient.findFirst({ where: { id: patient.id, ...scope }, select: { email: true } });
      if (current?.email !== patient.email) novuFail("novu-recipient-changed");
      await tx.$executeRawUnsafe(`UPDATE "ExternalReference" SET "metadata"=$4::jsonb,"updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        WHERE "id"=$1 AND "organizationId"=$2 AND "clinicId"=$3 AND "provider"='novu' AND "entityType"='NOVU_SUBSCRIBER'`,
      mapping.id, scope.organizationId, clinicId, JSON.stringify({ verifiedAt: new Date().toISOString(), fingerprint: novuFingerprint(loaded.secrets) }));
    });
  } else if (body.action === "test") {
    if (patientId) novuFail("novu-synthetic-test-only", 400);
    await sendNovuDelivery(scope, loaded, { internalId: `test:${clinicId}:${loaded.connection.id}:${novuFingerprint(loaded.secrets)}`,
      subscriberId: novuConfig(loaded.secrets).testSubscriberId, synthetic: true });
  } else if (body.action === "reconcile") {
    if (typeof body.deliveryId !== "string" || !/^novu-[a-f0-9]{64}$/.test(body.deliveryId)) novuFail("novu-delivery-not-found", 404);
    // Restrict the selectable delivery to this panel's patient/synthetic scope.
    const workspace = await getNovuOperatorWorkspace(session, clinicId, patientId);
    if (!workspace.deliveries.some(item => item.id === body.deliveryId)) novuFail("novu-delivery-not-found", 404);
    await reconcileNovuDelivery(scope, loaded, body.deliveryId);
  } else novuFail("novu-action-invalid", 400);
  await prisma.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId,
    action: `integration.novu_${body.action}`, entityType: "IntegrationConnection", entityId: loaded.connection.id,
    metadata: { clinicId } } });
  return getNovuOperatorWorkspace(session, clinicId, patientId);
}
