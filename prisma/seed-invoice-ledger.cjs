/** Synthetic fixture collections, never a repair path for operational data. */
async function seedInvoiceLedger(prisma, invoice) {
  const amount = Number(invoice.paidAmount);
  if (amount <= 0) return;
  const receiptId = `seed-receipt-${invoice.id}`;
  const paymentId = `seed-payment-${invoice.id}`;
  await prisma.$transaction(async (tx) => {
    const payments = await tx.payment.findMany({ where: { invoiceId: invoice.id } });
    const allocations = await tx.receiptAllocation.findMany({ where: { invoiceId: invoice.id } });
    if (payments.some(row => row.id !== paymentId) || allocations.some(row => row.receiptId !== receiptId)) {
      throw new Error('Refusing to replace non-fixture invoice activity while seeding.');
    }
    const scope = { organizationId: invoice.organizationId, clinicId: invoice.clinicId, patientId: invoice.patientId };
    await tx.receipt.upsert({
      where: { id: receiptId },
      create: { id: receiptId, ...scope, receiptNo: `SEED-${invoice.invoiceNo}`, amount,
        allocatedAmount: amount, unallocatedAmount: 0, method: 'seed:opening_balance',
        note: 'Synthetic fixture collection; not evidence of an external cash transfer.' },
      update: { amount, allocatedAmount: amount, unallocatedAmount: 0 },
    });
    await tx.receiptAllocation.upsert({
      where: { id: `seed-allocation-${invoice.id}` },
      create: { id: `seed-allocation-${invoice.id}`, ...scope, invoiceId: invoice.id, receiptId, amount },
      update: { amount },
    });
    await tx.payment.upsert({
      where: { id: paymentId },
      create: { id: paymentId, invoiceId: invoice.id, amount, method: 'seed:opening_balance', reference: receiptId },
      update: { amount },
    });
  });
}

module.exports = { seedInvoiceLedger };
