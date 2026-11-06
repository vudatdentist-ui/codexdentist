import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { canPerformAction } from "@/lib/actions/permissions";
import { hasAnyRole } from "@/lib/permissions";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import { patientAccessWhere } from "@/lib/patient-access";
import { runSerializableTransaction } from "@/lib/transaction";
import { moneyCents } from "@/lib/application/revenue/refund-ledger";
import { upsertIntegrationConnection } from "@/infrastructure/integrations/substrate";
import { readIntegrationSecrets, writeIntegrationSecrets } from "@/infrastructure/integrations/credential-vault";
import type { IntegrationConnectionRecord } from "@/infrastructure/integrations/phase3-store";
import { bankTransferFail as fail, createBankTransferPayload, validateBankTransferAccount, MAX_BANK_TRANSFER_VND } from "@/domains/revenue/bank-transfer";
import type { BankTransferSettings, BankTransferInstructions } from "@/features/integrations/bank-transfer";

const provider = "bank-transfer";
const organizationManager = (session: AppSession) => hasAnyRole({ ...session, activeClinicId: null }, ["OWNER", "AREA_MANAGER"]);
function settingsAccess(session: AppSession) {
  if (!canPerformAction(session, "settings.manage")) fail("bank-transfer-forbidden", 403);
}
function scope(session: AppSession, clinicId: unknown): string | null {
  if (clinicId === null && organizationManager(session)) return null;
  if (typeof clinicId !== "string" || !accessibleClinicIds(session).includes(clinicId) ||
      !canPerformAction({ ...session, activeClinicId: clinicId }, "settings.manage")) fail("bank-transfer-clinic-forbidden", 403);
  return clinicId;
}
export async function getBankTransferSettings(session: AppSession): Promise<BankTransferSettings> {
  settingsAccess(session);
  const clinics = session.clinics.filter(c => accessibleClinicIds(session).includes(c.id) &&
    canPerformAction({ ...session, activeClinicId: c.id }, "settings.manage")).map(({ id, name }) => ({ id, name }));
  const rows = await prisma.integrationConnection.findMany({ where: { organizationId: session.organizationId, provider,
    OR: [{ clinicId: { in: clinics.map(c => c.id) } }, ...(organizationManager(session) ? [{ clinicId: null }] : [])] } });
  return { clinics, canManageOrganization: organizationManager(session), isDemo: session.isDemo,
    connections: rows.map(row => ({ clinicId: row.clinicId, configured: row.secretRef === "vault:v1", enabled: row.status === "ACTIVE", updatedAt: row.updatedAt.toISOString() })) };
}
export async function saveBankTransferSettings(session: AppSession, body: Record<string, unknown>) {
  settingsAccess(session);
  if (session.isDemo) fail("bank-transfer-demo-unavailable", 403);
  const clinicId = scope(session, body.clinicId);
  if (body.action !== "save" && body.action !== "enable" && body.action !== "disable") fail("bank-transfer-input-invalid");
  const saving = body.action === "save";
  const credentials = saving ? validateBankTransferAccount(body) : null;
  if (saving && body.accountConfirmed !== true) fail("bank-transfer-account-confirmation-required");
  await runSerializableTransaction(async tx => {
    // The scope lock also covers first creation, where no connection row exists.
    await tx.$queryRawUnsafe(`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext($1))`, JSON.stringify([provider, session.organizationId, clinicId]));
    const current = await tx.integrationConnection.findFirst({ where: { organizationId: session.organizationId, clinicId, provider } });
    if (!saving && (!current || current.secretRef !== "vault:v1")) fail("bank-transfer-not-configured", 409);
    const connection = await upsertIntegrationConnection(tx, { organizationId: session.organizationId, clinicId, provider,
      status: body.action === "disable" ? "DISABLED" : "ACTIVE", lastVerifiedAt: null,
      capabilities: { offlineInstructions: true, automaticSettlement: false },
      ...(saving ? { secretRef: "vault:v1", metadata: { accountAutomaticallyVerified: false, confirmedByUserId: session.userId } } : {}) });
    if (credentials) await writeIntegrationSecrets(tx, { organizationId: session.organizationId, connectionId: connection.id, provider }, credentials);
    await tx.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId,
      action: `integration.bank_transfer_${body.action}`, entityType: "IntegrationConnection", entityId: connection.id,
      metadata: { clinicId, accountChanged: saving, accountAutomaticallyVerified: false } } });
  });
  return getBankTransferSettings(session);
}

export async function getBankTransferInstructions(session: AppSession, input: { patientId: unknown; invoiceNo: unknown; amount: unknown }): Promise<BankTransferInstructions> {
  if (!canPerformAction(session, "billing.receipt.record")) fail("bank-transfer-forbidden", 403);
  // Do not expose a clinic's real receiving account in a public demo workspace.
  if (session.isDemo) fail("bank-transfer-demo-unavailable", 403);
  if (typeof input.patientId !== "string" || !input.patientId || input.patientId.length > 128 ||
      typeof input.invoiceNo !== "string" || !input.invoiceNo || input.invoiceNo.length > 128 ||
      typeof input.amount !== "number" || !Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > MAX_BANK_TRANSFER_VND) fail("bank-transfer-input-invalid");
  const { patientId, invoiceNo, amount } = input as { patientId: string; invoiceNo: string; amount: number };
  return runSerializableTransaction(async tx => {
    const patient = await tx.patient.findFirst({ where: { ...patientAccessWhere(session), id: patientId,
      clinicId: { in: accessibleClinicIds(session) } }, select: { id: true, clinicId: true } });
    if (!patient) fail("bank-transfer-invoice-not-found", 404);
    if (!canPerformAction({ ...session, activeClinicId: patient.clinicId }, "billing.receipt.record")) fail("bank-transfer-forbidden", 403);
    const invoice = await tx.invoice.findFirst({ where: { organizationId: session.organizationId, clinicId: patient.clinicId,
      patientId, invoiceNo }, select: { id: true, amount: true, paidAmount: true, status: true } });
    if (!invoice || invoice.status === "VOID") fail("bank-transfer-invoice-not-found", 404);
    const balanceCents = moneyCents(invoice.amount) - moneyCents(invoice.paidAmount);
    if (balanceCents <= 0 || amount * 100 > balanceCents) fail("bank-transfer-balance-changed", 409);
    // A disabled clinic override must not silently fall back to a global account.
    const connections = await tx.$queryRawUnsafe<IntegrationConnectionRecord[]>(`SELECT * FROM "IntegrationConnection"
      WHERE "organizationId"=$1 AND provider='bank-transfer' AND ("clinicId"=$2 OR "clinicId" IS NULL)
      ORDER BY CASE WHEN "clinicId"=$2 THEN 0 ELSE 1 END LIMIT 1`, session.organizationId, patient.clinicId);
    const connection = connections[0];
    if (!connection || connection.organizationId !== session.organizationId || connection.provider !== provider ||
        (connection.clinicId !== null && connection.clinicId !== patient.clinicId) || connection.status !== "ACTIVE" || connection.secretRef !== "vault:v1") fail("bank-transfer-not-configured", 409);
    const keys = await readIntegrationSecrets(tx, { organizationId: session.organizationId, connectionId: connection.id, provider });
    if (!keys) fail("bank-transfer-not-configured", 409);
    const account = validateBankTransferAccount(keys);
    // Opaque short ASCII reference; no names, phones, clinical information or bank lookups.
    const memo = `CD ${createHash("sha256").update(JSON.stringify([session.organizationId, invoice.id])).digest("hex").slice(0, 20).toUpperCase()}`;
    return { ...account, payload: createBankTransferPayload(account, amount, memo), amount,
      balance: balanceCents / 100, memo, generatedAt: new Date().toISOString(), bankAccountVerified: false };
  });
}
