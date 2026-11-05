import type { Prisma } from "@prisma/client";
import { ApplicationCommandError } from "@/lib/application/errors";
import { loadReceiptRefundLedger, moneyCents } from "./refund-ledger";

export type CommissionBasisSnapshot = { accrualId: string; receiptId: string; grossBase: number };

export async function loadCommissionBasisSnapshots(tx: Prisma.TransactionClient, organizationId: string, accrualIds: string[]) {
  const result = new Map<string, { receiptId: string; grossBaseCents: number }>();
  if (!accrualIds.length) return result;
  const audits = await tx.auditLog.findMany({
    where: { organizationId, action: { in: ["source_commission.accrued", "invoice.voided"] },
      OR: accrualIds.map(accrualId => ({ metadata: { path: ["commissionBasisSnapshots"], array_contains: [{ accrualId }] } })) },
    select: { action: true, entityType: true, entityId: true, metadata: true },
  });
  for (const audit of audits) {
    const metadata = audit.metadata as Record<string, unknown> | null;
    if (metadata?.commissionBasisLedgerVersion !== 1 || !Array.isArray(metadata.commissionBasisSnapshots)) {
      throw new ApplicationCommandError("billing-refund-commission-unreconciled");
    }
    for (const snapshot of metadata.commissionBasisSnapshots as CommissionBasisSnapshot[]) {
      const grossBase = moneyCents(snapshot.grossBase);
      const previous = result.get(snapshot.accrualId);
      if (typeof snapshot.accrualId !== "string" || typeof snapshot.receiptId !== "string" || grossBase < 0 ||
          (audit.action === "source_commission.accrued" &&
            (audit.entityType !== "SourceCommissionAccrual" || audit.entityId !== snapshot.accrualId)) ||
          (previous && (previous.receiptId !== snapshot.receiptId || previous.grossBaseCents !== grossBase))) {
        throw new ApplicationCommandError("billing-refund-commission-unreconciled");
      }
      result.set(snapshot.accrualId, { receiptId: snapshot.receiptId, grossBaseCents: grossBase });
    }
  }
  return result;
}

/** Capture proven existing bases before releasing allocations; no clock ordering. */
export async function retainCommissionBasesOnVoid(tx: Prisma.TransactionClient, organizationId: string, receiptIds: string[]) {
  if (!receiptIds.length) return [];
  const accruals = await tx.sourceCommissionAccrual.findMany({
    where: { organizationId, receiptId: { in: receiptIds } }, select: { id: true, receiptId: true, baseAmount: true },
  });
  if (!accruals.length) return [];
  const receipts = await tx.receipt.findMany({
    where: { organizationId, id: { in: receiptIds } }, select: { id: true, amount: true, allocatedAmount: true },
  });
  const allocations = await tx.receiptAllocation.findMany({
    where: { organizationId, receiptId: { in: receiptIds } }, select: { invoiceId: true },
  });
  const refunds = await loadReceiptRefundLedger(tx, organizationId, receiptIds,
    allocations.flatMap(row => row.invoiceId ? [row.invoiceId] : []));
  const prior = await loadCommissionBasisSnapshots(tx, organizationId, accruals.map(row => row.id));
  return accruals.map(accrual => {
    const receipt = receipts.find(row => row.id === accrual.receiptId);
    const snapshot = prior.get(accrual.id);
    if (!receipt || (snapshot && snapshot.receiptId !== receipt.id)) {
      throw new ApplicationCommandError("billing-refund-commission-unreconciled");
    }
    const grossBase = snapshot?.grossBaseCents ?? refunds.grossBases.get(receipt.id) ?? moneyCents(receipt.allocatedAmount);
    if (grossBase > moneyCents(receipt.amount) ||
        moneyCents(accrual.baseAmount) !== grossBase - (refunds.byReceipt.get(receipt.id) ?? 0)) {
      throw new ApplicationCommandError("billing-refund-commission-unreconciled");
    }
    return { accrualId: accrual.id, receiptId: receipt.id, grossBase: grossBase / 100 };
  });
}
