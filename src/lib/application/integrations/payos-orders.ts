import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { canPerformAction } from "@/lib/actions/permissions";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import { runSerializableTransaction } from "@/lib/transaction";
import { createExternalReference } from "@/infrastructure/integrations/substrate";
import { findActiveIntegrationConnection, getExternalReferenceByInternalId, claimExternalReferenceForRetry,
  referenceMetadata, type IntegrationConnectionRecord } from "@/infrastructure/integrations/phase3-store";
import { payOSConnectionSummary, payOSOrders } from "@/infrastructure/integrations/payos-workspace-store";
import type { PayOSSecrets } from "@/integrations/payos/client";

function fail(code: string, status = 400): never { throw Object.assign(new Error(code), { code, status }); }
function authorize(session: AppSession, mutate = false) {
  if (!canPerformAction(session, "billing.receipt.record")) fail("forbidden", 403);
  if (mutate && session.isDemo) fail("payos-demo-unavailable", 403);
}
async function patientScope(session: AppSession, patientId: string) {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, organizationId: session.organizationId,
    clinicId: { in: accessibleClinicIds(session) } }, select: { id: true, clinicId: true } });
  if (!patient) fail("payos-patient-not-found", 404);
  return patient;
}
export async function getPayOSInvoice(session: AppSession, patientId: string, invoiceNo: string) {
  authorize(session);
  const patient = await patientScope(session, patientId);
  const invoice = await prisma.invoice.findFirst({ where: { organizationId: session.organizationId,
    clinicId: patient.clinicId, patientId: patient.id, invoiceNo }, select: { id: true } });
  if (!invoice) fail("payos-invoice-not-found", 404);
  const connection = await findActiveIntegrationConnection(prisma, { organizationId: session.organizationId, clinicId: patient.clinicId, provider: "payos" });
  const summary = connection && payOSConnectionSummary(connection, "");
  return { configured: Boolean(summary?.configured) && !session.isDemo, verified: Boolean(summary?.verified) && !session.isDemo,
    connectionId: connection?.id ?? null, orders: await payOSOrders(prisma, { organizationId: session.organizationId,
      clinicId: patient.clinicId, patientId, invoiceNo }) };
}
export async function reservePayOSOrder(session: AppSession, input: { patientId: string; invoiceNo: string | null; amount: number; idempotencyKey: string },
  loadSecrets: (connection: IntegrationConnectionRecord, tx: Prisma.TransactionClient) => Promise<PayOSSecrets>) {
  authorize(session, true);
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || !input.patientId) fail("payos-payment-link-input-invalid");
  if (input.idempotencyKey && !/^[A-Za-z0-9_.:-]{8,120}$/.test(input.idempotencyKey)) fail("payos-idempotency-key-invalid");
  const patient = await patientScope(session, input.patientId);
  const source = await findActiveIntegrationConnection(prisma, { organizationId: session.organizationId, clinicId: patient.clinicId, provider: "payos" });
  if (!source) fail("payos-connection-not-configured", 503);
  const internalId = input.idempotencyKey || `payos_${randomUUID()}`;
  return runSerializableTransaction(async tx => {
    // Credential replacement shares this lock: reserve a durable intent before
    // releasing its merchant credentials to an out-of-transaction provider call.
    const connections = await tx.$queryRawUnsafe<IntegrationConnectionRecord[]>(
      `SELECT * FROM "IntegrationConnection" WHERE "id"=$1 AND "organizationId"=$2
       AND "provider"='payos' AND "status"='ACTIVE' FOR UPDATE`, source.id, session.organizationId);
    const connection = connections[0];
    if (!connection) fail("payos-connection-not-configured", 409);
    if (connection.secretRef === "vault:v1" && !payOSConnectionSummary(connection, "").verified) fail("payos-webhook-not-confirmed", 409);
    const secrets = await loadSecrets(connection, tx);
    const existing = await getExternalReferenceByInternalId(tx, { organizationId: session.organizationId,
      connectionId: connection.id, provider: "payos", entityType: "PAYOS_ORDER", internalId });
    if (existing) {
      const metadata = referenceMetadata(existing);
      if (metadata.patientId !== patient.id || Number(metadata.amount) !== input.amount ||
          String(metadata.invoiceNo ?? "") !== String(input.invoiceNo ?? "")) fail("payos-idempotency-key-conflict", 409);
      if (typeof metadata.checkoutUrl === "string" || metadata.status === "SETTLED") return { connection, secrets, intent: existing, duplicate: true };
      if (!["ERROR", "FAILED"].includes(String(metadata.status))) fail("payos-payment-link-pending-recovery", 409);
    }
    if (input.invoiceNo) {
      const rows = await tx.$queryRawUnsafe<Array<{ amount: Prisma.Decimal; paidAmount: Prisma.Decimal; status: string }>>(
        `SELECT "amount","paidAmount","status" FROM "Invoice" WHERE "organizationId"=$1 AND "clinicId"=$2
         AND "patientId"=$3 AND "invoiceNo"=$4 FOR UPDATE`, session.organizationId, patient.clinicId, patient.id, input.invoiceNo);
      const invoice = rows[0];
      if (!invoice || invoice.status === "VOID") fail("payos-invoice-not-found", 404);
      if (input.amount > Number(invoice.amount) - Number(invoice.paidAmount)) fail("payos-invoice-amount-invalid", 409);
    }
    if (existing) {
      if (!await claimExternalReferenceForRetry(tx, existing.id)) fail("payos-payment-link-pending-recovery", 409);
      return { connection, secrets, intent: existing, duplicate: false };
    }
    const intent = await createExternalReference(tx, { organizationId: session.organizationId, clinicId: patient.clinicId,
      connectionId: connection.id, provider: "payos", entityType: "PAYOS_ORDER", internalId,
      externalId: String(Date.now() * 100 + randomInt(10, 100)), metadata: {
        patientId: patient.id, clinicId: patient.clinicId, invoiceNo: input.invoiceNo, amount: input.amount,
        currency: "VND", status: "CREATING" } });
    // createExternalReference returns the record, not a {created} envelope.
    // The connection lock and prior internal-ID lookup establish this new intent.
    return { connection, secrets, intent, duplicate: false };
  });
}
