import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { canPerformAction } from "@/lib/actions/permissions";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import { runSerializableTransaction } from "@/lib/transaction";
import { referenceMetadata, updateExternalReferenceMetadata,
  type ExternalReferenceRecord, type IntegrationConnectionRecord } from "@/infrastructure/integrations/phase3-store";
import { getPayOSPaymentLinkStatus, type PayOSSecrets } from "@/integrations/payos/client";

type DB = Prisma.TransactionClient | typeof prisma;
export type PayOSReconciliationResult = {
  status: string; providerStatus: string | null; amountPaid: number | null; changed: boolean;
};
const terminal = (metadata: Record<string, unknown>) => ["SETTLED", "CANCELLED", "FAILED"].includes(String(metadata.status));
function fail(code: string, status = 409): never { throw Object.assign(new Error(code), { code, status }); }
function result(metadata: Record<string, unknown>, changed = false): PayOSReconciliationResult {
  return { status: typeof metadata.status === "string" ? metadata.status : "PENDING",
    providerStatus: typeof metadata.providerStatus === "string" ? metadata.providerStatus : null,
    amountPaid: typeof metadata.providerAmountPaid === "number" && Number.isSafeInteger(metadata.providerAmountPaid) && metadata.providerAmountPaid >= 0
      ? metadata.providerAmountPaid : null, changed };
}
async function scopedOrder(db: DB, session: AppSession, orderId: string, lock = false) {
  const rows = await db.$queryRawUnsafe<ExternalReferenceRecord[]>(
    `SELECT * FROM "ExternalReference" WHERE "id"=$1 AND "organizationId"=$2
     AND "provider"='payos' AND "entityType"='PAYOS_ORDER' AND "clinicId"=ANY($3::text[])
     ${lock ? "FOR UPDATE" : ""}`, orderId, session.organizationId, accessibleClinicIds(session));
  const order = rows[0];
  if (!order?.clinicId || !order.connectionId) fail("payos-order-not-found", 404);
  const metadata = referenceMetadata(order);
  const patientId = typeof metadata.patientId === "string" ? metadata.patientId : "";
  const patient = await db.patient.findFirst({ where: { id: patientId, organizationId: session.organizationId,
    clinicId: order.clinicId }, select: { id: true } });
  if (!patient) fail("payos-order-not-found", 404);
  return order;
}
async function lockConnection(tx: Prisma.TransactionClient, session: AppSession, connectionId: string, clinicId: string) {
  const connections = await tx.$queryRawUnsafe<IntegrationConnectionRecord[]>(
    `SELECT * FROM "IntegrationConnection" WHERE "id"=$1 AND "organizationId"=$2 AND "provider"='payos'
     AND "status" IN ('ACTIVE','DISABLED') AND ("clinicId" IS NULL OR "clinicId"=$3) FOR UPDATE`,
    connectionId, session.organizationId, clinicId);
  if (!connections[0]) fail("payos-connection-not-configured");
  return connections[0];
}

export async function reconcilePayOSOrder(session: AppSession, orderId: string,
  loadSecrets: (connection: IntegrationConnectionRecord, tx: Prisma.TransactionClient) => Promise<PayOSSecrets>,
): Promise<PayOSReconciliationResult> {
  if (!canPerformAction(session, "billing.receipt.record")) fail("forbidden", 403);
  if (session.isDemo) fail("payos-demo-unavailable", 403);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) fail("payos-order-not-found", 404);
  const source = await scopedOrder(prisma, session, orderId);
  if (terminal(referenceMetadata(source))) return result(referenceMetadata(source));
  const captured = await runSerializableTransaction(async tx => {
    // Settings and reservation share this lock. The unresolved order continues
    // blocking credential replacement while the read-only provider GET runs.
    const connection = await lockConnection(tx, session, source.connectionId!, source.clinicId!);
    const order = await scopedOrder(tx, session, orderId, true);
    if (order.connectionId !== connection.id || order.clinicId !== source.clinicId) fail("payos-order-changed");
    const metadata = referenceMetadata(order);
    if (terminal(metadata)) return { done: result(metadata) };
    const orderCode = Number(order.externalId);
    const amount = metadata.amount;
    if (!Number.isSafeInteger(orderCode) || orderCode <= 0 || String(orderCode) !== order.externalId ||
        typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) fail("payos-order-metadata-invalid");
    const paymentLinkId = typeof metadata.paymentLinkId === "string" ? metadata.paymentLinkId : null;
    const secrets = await loadSecrets(connection, tx);
    return { order, secrets, expected: { orderCode, amount, paymentLinkId } };
  });
  if (captured.done) return captured.done;
  // No provider mutation or HTTP request runs inside a database transaction.
  const observation = await getPayOSPaymentLinkStatus(captured.secrets, captured.expected);
  return runSerializableTransaction(async tx => {
    await lockConnection(tx, session, captured.order.connectionId!, captured.order.clinicId!);
    const current = await scopedOrder(tx, session, orderId, true);
    const metadata = referenceMetadata(current);
    // The webhook owns settlement. A committed terminal result wins even when
    // the provider GET was issued before that callback committed.
    if (terminal(metadata)) return result(metadata);
    if (current.connectionId !== captured.order.connectionId || current.clinicId !== captured.order.clinicId || current.externalId !== captured.order.externalId ||
        metadata.amount !== captured.expected.amount || metadata.patientId !== referenceMetadata(captured.order).patientId ||
        (typeof metadata.paymentLinkId === "string" && metadata.paymentLinkId !== observation.paymentLinkId)) fail("payos-order-changed");
    // An older zero-paid snapshot must not erase a concurrent/previous signed
    // observation of money. Reversals require explicit financial reconciliation.
    const previousPaid = typeof metadata.providerAmountPaid === "number" && Number.isSafeInteger(metadata.providerAmountPaid)
      ? Math.max(0, metadata.providerAmountPaid) : 0;
    const paid = Math.max(previousPaid, observation.amountPaid);
    const cancel = ["CANCELLED", "EXPIRED"].includes(observation.status) && paid === 0 && metadata.providerStatus !== "PAID";
    const next = { ...metadata, providerStatus: observation.status, providerAmountPaid: paid,
      providerCheckedAt: new Date().toISOString(),
      ...(cancel ? { status: "CANCELLED", creationUncertain: false, checkoutUrl: null, qrCode: null } : {}) };
    const updated = await updateExternalReferenceMetadata(tx, current.id, next);
    const actual = referenceMetadata(updated);
    const changed = actual.status !== metadata.status;
    await tx.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId,
      action: "payos.payment_link_status_checked", entityType: "ExternalReference", entityId: current.id,
      metadata: { connectionId: current.connectionId, clinicId: current.clinicId,
        previousStatus: result(metadata).status, status: result(actual).status, providerStatus: observation.status } } });
    return result(actual, changed);
  });
}
