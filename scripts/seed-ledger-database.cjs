const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { seedInvoiceLedger } = require('../prisma/seed-invoice-ledger.cjs');

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error('Requires NODE_ENV=test and a disposable loopback database.');
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function main() {
  for (const env of [
    { NODE_ENV: 'production', DATABASE_URL: process.env.DATABASE_URL },
    { NODE_ENV: 'test', DATABASE_URL: 'postgresql://test@remote.invalid/fixture' },
    { NODE_ENV: 'test', DATABASE_URL: '' },
  ]) {
    const result = spawnSync(process.execPath, ['prisma/seed.js'], { env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Synthetic seed requires an explicit loopback/);
  }
  const org = await prisma.organization.create({ data: { name: `Synthetic seed ledger ${randomUUID()}` } });
  try {
    const clinic = await prisma.clinic.create({ data: { organizationId: org.id, name: 'Seed test', city: 'Test', address: 'Test' } });
    const patient = await prisma.patient.create({ data: { organizationId: org.id, clinicId: clinic.id, fullName: 'Synthetic', phone: '0000000000', medicalAlerts: [] } });
    for (const paid of [0, 1500000, 4200000]) {
      const invoice = await prisma.invoice.create({ data: { organizationId: org.id, clinicId: clinic.id,
        patientId: patient.id, invoiceNo: `SEED-${paid}`, amount: 4200000, paidAmount: paid,
        status: paid === 0 ? 'OPEN' : paid < 4200000 ? 'PARTIAL' : 'PAID', dueDate: new Date() } });
      await seedInvoiceLedger(prisma, invoice);
      await seedInvoiceLedger(prisma, invoice);
      const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
      const allocations = await prisma.receiptAllocation.findMany({ where: { invoiceId: invoice.id }, include: { receipt: true } });
      assert.equal(payments.length, paid ? 1 : 0);
      assert.equal(payments.reduce((sum, row) => sum + Number(row.amount), 0), paid);
      if (paid) assert.equal(payments[0].reference, `SEED-${invoice.invoiceNo}`);
      assert.equal(allocations.reduce((sum, row) => sum + Number(row.amount), 0), paid);
      for (const row of allocations) {
        assert.equal(Number(row.receipt.amount), paid);
        assert.equal(Number(row.receipt.allocatedAmount), paid);
        assert.equal(Number(row.receipt.unallocatedAmount), 0);
        assert.equal(row.receipt.method, 'seed:opening_balance');
      }
      if (paid) {
        await prisma.payment.create({ data: { invoiceId: invoice.id, amount: -1, method: 'refund:cash' } });
        await assert.rejects(seedInvoiceLedger(prisma, invoice), /Refusing to replace non-fixture/);
        assert.equal(await prisma.payment.count({ where: { invoiceId: invoice.id } }), 2);
      }
    }
    console.log('ok synthetic seed guard, balanced collections, repeat-run idempotency and operational-history refusal');
  } finally {
    await prisma.receiptAllocation.deleteMany({ where: { organizationId: org.id } });
    await prisma.payment.deleteMany({ where: { invoice: { organizationId: org.id } } });
    await prisma.receipt.deleteMany({ where: { organizationId: org.id } });
    await prisma.invoice.deleteMany({ where: { organizationId: org.id } });
    await prisma.patient.deleteMany({ where: { organizationId: org.id } });
    await prisma.clinic.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
