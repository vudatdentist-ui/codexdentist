import type { Prisma } from "@prisma/client";
import { ApplicationCommandError } from "@/lib/application/errors";

export type RefundShare = { receiptId: string; amount: number };
type RefundPayment = { id: string; invoiceId: string; amount: unknown };
type RefundAudit = { entityId: string | null; metadata: unknown };

export function moneyCents(value: unknown) {
  const number = Number(value);
  const cents = Math.round(number * 100);
  if (!Number.isFinite(number) || !Number.isSafeInteger(cents) ||
      Math.abs(number * 100 - cents) > 0.00001) {
    throw new ApplicationCommandError("billing-money-invalid");
  }
  return cents;
}

/** Fixed commission remains earned while some eligible collection is retained. */
export function receiptCommission(baseAmount: number, ratePercent: number, fixedAmount: number) {
  return baseAmount > 0 ? Math.max(Math.round(baseAmount * ratePercent / 100 + fixedAmount), 0) : 0;
}

export function readRefundLedger(payments: RefundPayment[], audits: RefundAudit[]) {
  const byInvoice = new Map<string, Map<string, number>>();
  const byReceipt = new Map<string, number>();
  const grossBases = new Map<string, number>();
  const paymentIds = new Set<string>();
  for (const payment of payments) {
    const matches = audits.filter((audit) => {
      const metadata = audit.metadata as Record<string, unknown> | null;
      return audit.entityId === payment.invoiceId && metadata?.paymentId === payment.id;
    });
    if (matches.length !== 1 || paymentIds.has(payment.id)) {
      throw new ApplicationCommandError("billing-refund-history-unreconciled");
    }
    paymentIds.add(payment.id);
    const metadata = matches[0]!.metadata as Record<string, unknown>;
    if (metadata.refundLedgerVersion !== 1 || !Array.isArray(metadata.refundShares) ||
        !Array.isArray(metadata.receiptGrossBases)) {
      throw new ApplicationCommandError("billing-refund-history-unreconciled");
    }
    const shares = metadata.refundShares as RefundShare[];
    let total = 0;
    const seen = new Set<string>();
    for (const share of shares) {
      const cents = moneyCents(share.amount);
      if (typeof share.receiptId !== "string" || !share.receiptId || cents <= 0 || seen.has(share.receiptId)) {
        throw new ApplicationCommandError("billing-refund-history-unreconciled");
      }
      seen.add(share.receiptId);
      const bases = (metadata.receiptGrossBases as RefundShare[]).filter((base) => base.receiptId === share.receiptId);
      if (bases.length !== 1 || moneyCents(bases[0]!.amount) < cents ||
          (grossBases.has(share.receiptId) && grossBases.get(share.receiptId) !== moneyCents(bases[0]!.amount))) {
        throw new ApplicationCommandError("billing-refund-history-unreconciled");
      }
      grossBases.set(share.receiptId, moneyCents(bases[0]!.amount));
      total += cents;
      const invoice = byInvoice.get(payment.invoiceId) ?? new Map<string, number>();
      invoice.set(share.receiptId, (invoice.get(share.receiptId) ?? 0) + cents);
      byInvoice.set(payment.invoiceId, invoice);
      byReceipt.set(share.receiptId, (byReceipt.get(share.receiptId) ?? 0) + cents);
    }
    if (total !== -moneyCents(payment.amount)) {
      throw new ApplicationCommandError("billing-refund-history-unreconciled");
    }
  }
  for (const [receiptId, cents] of byReceipt) if (cents > grossBases.get(receiptId)!) {
    throw new ApplicationCommandError("billing-refund-history-unreconciled");
  }
  return { byInvoice, byReceipt, grossBases };
}

export async function loadReceiptRefundLedger(
  tx: Prisma.TransactionClient, organizationId: string, receiptIds: string[], relatedInvoiceIds: string[] = [],
) {
  // Query durable receipt attribution even when an invoice allocation was unlinked.
  const seeds = receiptIds.length ? await tx.auditLog.findMany({
    where: { organizationId, action: "invoice.refund_recorded", entityType: "Invoice",
      OR: receiptIds.map((receiptId) => ({ metadata: { path: ["refundShares"], array_contains: [{ receiptId }] } })) },
    select: { entityId: true },
  }) : [];
  const invoiceIds = [...new Set([...relatedInvoiceIds, ...seeds.flatMap((row) => row.entityId ? [row.entityId] : [])])];
  if (!invoiceIds.length) return readRefundLedger([], []);
  const payments = await tx.payment.findMany({
    where: { invoiceId: { in: invoiceIds }, invoice: { organizationId },
      amount: { lt: 0 }, method: { startsWith: "refund:" } },
    select: { id: true, invoiceId: true, amount: true },
  });
  const audits = await tx.auditLog.findMany({
    where: { organizationId, action: "invoice.refund_recorded", entityType: "Invoice", entityId: { in: invoiceIds } },
    select: { entityId: true, metadata: true },
  });
  return readRefundLedger(payments, audits);
}

/** Largest-remainder allocation in cents: every refunded cent has one receipt. */
export function planRefundShares(amount: number, capacities: Map<string, number>): RefundShare[] {
  const requested = moneyCents(amount);
  const available = [...capacities].filter(([, cents]) => cents > 0).sort(([a], [b]) => a.localeCompare(b));
  const total = available.reduce((sum, [, cents]) => sum + cents, 0);
  if (requested <= 0 || requested > total) throw new ApplicationCommandError("billing-refund-ledger-unreconciled");
  const rows = available.map(([receiptId, cents]) => {
    const weighted = BigInt(requested) * BigInt(cents);
    return { receiptId, cents: Number(weighted / BigInt(total)), remainder: weighted % BigInt(total) };
  });
  let remaining = requested - rows.reduce((sum, row) => sum + row.cents, 0);
  const ranked = [...rows].sort((a, b) => a.remainder === b.remainder
    ? a.receiptId.localeCompare(b.receiptId) : a.remainder > b.remainder ? -1 : 1);
  for (const row of ranked) if (remaining-- > 0) row.cents++;
  return rows.filter((row) => row.cents > 0).map((row) => ({ receiptId: row.receiptId, amount: row.cents / 100 }));
}

export async function attributeInvoiceRefund(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; clinicId: string; patientId: string; invoiceId: string; amount: number; paidAmount: number },
) {
  const allocations = await tx.receiptAllocation.findMany({
    where: { invoiceId: input.invoiceId, organizationId: input.organizationId,
      clinicId: input.clinicId, patientId: input.patientId },
    select: { receiptId: true, amount: true, treatmentServiceId: true },
  });
  if (allocations.some((row) => row.treatmentServiceId)) {
    throw new ApplicationCommandError("billing-refund-service-linked-unsupported");
  }
  const receiptIds = [...new Set(allocations.map((row) => row.receiptId))].sort();
  if (!receiptIds.length) throw new ApplicationCommandError("billing-refund-ledger-unreconciled");
  // A shared receipt is one commission basis. Touch only its bookkeeping timestamp
  // so concurrent refunds/generation cannot use stale commission snapshots.
  for (const id of receiptIds) {
    const touched = await tx.receipt.updateMany({
    where: { id, organizationId: input.organizationId,
      clinicId: input.clinicId, patientId: input.patientId }, data: { updatedAt: new Date() },
    });
    if (touched.count !== 1) throw new ApplicationCommandError("billing-refund-ledger-unreconciled");
  }
  const related = await tx.receiptAllocation.findMany({
    where: { receiptId: { in: receiptIds }, organizationId: input.organizationId },
    select: { invoiceId: true },
  });
  const invoiceIds = [...new Set(related.flatMap((row) => row.invoiceId ? [row.invoiceId] : []))];
  const prior = await loadReceiptRefundLedger(tx, input.organizationId, receiptIds, invoiceIds);
  const capacities = new Map<string, number>();
  for (const row of allocations) capacities.set(row.receiptId, (capacities.get(row.receiptId) ?? 0) + moneyCents(row.amount));
  for (const [receiptId, refunded] of prior.byInvoice.get(input.invoiceId) ?? []) {
    const remaining = (capacities.get(receiptId) ?? 0) - refunded;
    if (remaining < 0) throw new ApplicationCommandError("billing-refund-history-unreconciled");
    capacities.set(receiptId, remaining);
  }
  if ([...capacities.values()].reduce((sum, amount) => sum + amount, 0) !== moneyCents(input.paidAmount)) {
    throw new ApplicationCommandError("billing-refund-ledger-unreconciled");
  }
  const shares = planRefundShares(input.amount, capacities);
  const accruals = await tx.sourceCommissionAccrual.findMany({
    where: { organizationId: input.organizationId, receiptId: { in: shares.map((share) => share.receiptId) } },
    select: { id: true, receiptId: true, baseAmount: true, ratePercent: true,
      fixedAmount: true, commissionAmount: true, status: true },
  });
  const receipts = await tx.receipt.findMany({
    where: { id: { in: receiptIds }, organizationId: input.organizationId },
    select: { id: true, allocatedAmount: true },
  });
  const receiptGrossBases = shares.map((share) => {
    const accrued = accruals.find((row) => row.receiptId === share.receiptId);
    const gross = prior.grossBases.get(share.receiptId) ?? (accrued
      ? moneyCents(accrued.baseAmount) + (prior.byReceipt.get(share.receiptId) ?? 0)
      : moneyCents(receipts.find((row) => row.id === share.receiptId)!.allocatedAmount));
    if (gross < (prior.byReceipt.get(share.receiptId) ?? 0) + moneyCents(share.amount)) {
      throw new ApplicationCommandError("billing-refund-commission-unreconciled");
    }
    return { receiptId: share.receiptId, amount: gross / 100 };
  });
  for (const accrual of accruals) {
    if (accrual.status === "PAID") throw new ApplicationCommandError("billing-refund-paid-commission-unsupported");
    const refunded = shares.find((share) => share.receiptId === accrual.receiptId)!.amount;
    const nextBase = moneyCents(accrual.baseAmount) - moneyCents(refunded);
    if (nextBase < 0 || moneyCents(accrual.commissionAmount) !== moneyCents(receiptCommission(
      Number(accrual.baseAmount), Number(accrual.ratePercent), Number(accrual.fixedAmount),
    ))) throw new ApplicationCommandError("billing-refund-commission-unreconciled");
    await tx.sourceCommissionAccrual.update({
      where: { id: accrual.id }, data: { baseAmount: nextBase / 100,
        commissionAmount: receiptCommission(nextBase / 100, Number(accrual.ratePercent), Number(accrual.fixedAmount)) },
    });
  }
  return { refundShares: shares, receiptGrossBases };
}
