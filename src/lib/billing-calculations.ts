export function cappedPaidAmount(paidAmount: number | null | undefined, amount: number) {
  return Math.min(Math.max(Number(paidAmount ?? 0) || 0, 0), Math.max(amount, 0));
}

export function invoiceBalanceAmount(amount: number, paidAmount: number | null | undefined) {
  return Math.max(Math.max(amount, 0) - cappedPaidAmount(paidAmount, amount), 0);
}

export function isCollectableInvoiceStatus(status: string) {
  return status !== "Paid" && status !== "Void";
}

export function serviceAppliedAmount(collectedAmount: number, creditAllocatedAmount: number) {
  return Math.max(collectedAmount, 0) + Math.max(creditAllocatedAmount, 0);
}

export function serviceBillableCollectedAmount(finalPrice: number, appliedAmount: number) {
  return Math.min(Math.max(appliedAmount, 0), Math.max(finalPrice, 0));
}

export function serviceRemainingInvoiceCapacity(finalPrice: number, invoicedAmount: number) {
  return Math.max(Math.max(finalPrice, 0) - Math.max(invoicedAmount, 0), 0);
}

export function serviceUninvoicedAmount(
  finalPrice: number,
  appliedAmount: number,
  invoicedAmount: number,
) {
  return Math.max(
    serviceBillableCollectedAmount(finalPrice, appliedAmount) -
      Math.max(invoicedAmount, 0),
    0,
  );
}
