import type { Prisma } from "@prisma/client";
import { ApplicationCommandError } from "@/lib/application/errors";
import { moneyCents } from "./refund-ledger";

type VoidAudit = { entityId: string | null; createdAt: Date; metadata: unknown };
type VoidPayment = { id: string; invoiceId: string; amount: unknown; method: string };

/** Only payment-backed, receipt-specific releases can explain a retained basis. */
export function readVoidReleaseLedger(audits: VoidAudit[], payments: VoidPayment[]) {
  const releases = new Map<string, { amount: number; createdAt: Date }[]>();
  const seen = new Set<string>();
  for (const audit of audits) {
    const metadata = audit.metadata as Record<string, unknown> | null;
    const payment = payments.find(row => row.id === metadata?.voidReversalPaymentId);
    if (metadata?.invoiceVoidLedgerVersion !== 1 || !Array.isArray(metadata.directReceiptReleases) ||
        !payment || payment.invoiceId !== audit.entityId || payment.method !== "void_reversal" ||
        seen.has(payment.id) || moneyCents(payment.amount) >= 0 ||
        moneyCents(metadata.paymentReversed) !== -moneyCents(payment.amount)) {
      throw new ApplicationCommandError("billing-invoice-ledger-unreconciled");
    }
    seen.add(payment.id);
    let total = 0;
    const receipts = new Set<string>();
    for (const share of metadata.directReceiptReleases as { receiptId: string; amount: unknown }[]) {
      const amount = moneyCents(share.amount);
      if (typeof share.receiptId !== "string" || !share.receiptId || receipts.has(share.receiptId) || amount <= 0) {
        throw new ApplicationCommandError("billing-invoice-ledger-unreconciled");
      }
      receipts.add(share.receiptId);
      total += amount;
      const entries = releases.get(share.receiptId) ?? [];
      entries.push({ amount, createdAt: audit.createdAt });
      releases.set(share.receiptId, entries);
    }
    if (total > -moneyCents(payment.amount)) throw new ApplicationCommandError("billing-invoice-ledger-unreconciled");
  }
  return releases;
}

export async function loadReceiptVoidReleases(tx: Prisma.TransactionClient, organizationId: string, receiptIds: string[]) {
  if (!receiptIds.length) return readVoidReleaseLedger([], []);
  const audits = await tx.auditLog.findMany({
    where: { organizationId, action: "invoice.voided", entityType: "Invoice",
      OR: receiptIds.map(receiptId => ({ metadata: { path: ["directReceiptReleases"], array_contains: [{ receiptId }] } })) },
    select: { entityId: true, createdAt: true, metadata: true },
  });
  const ids = audits.flatMap(audit => {
    const metadata = audit.metadata as Record<string, unknown> | null;
    return typeof metadata?.voidReversalPaymentId === "string" ? [metadata.voidReversalPaymentId] : [];
  });
  const payments = ids.length ? await tx.payment.findMany({
    where: { id: { in: ids }, invoice: { organizationId } },
    select: { id: true, invoiceId: true, amount: true, method: true },
  }) : [];
  return readVoidReleaseLedger(audits, payments);
}
