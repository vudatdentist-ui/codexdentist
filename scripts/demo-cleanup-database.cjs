const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { load } = require(process.cwd() + '/scripts/audit-source-loader.cjs');

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw Error('Requires NODE_ENV=test and a disposable loopback database');
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const { purgeOrganization } = load('src/lib/organization-purge.ts', { '@/lib/prisma': { prisma } });
const ids = [];

async function fixture(expired) {
  const token = randomUUID();
  const organization = await prisma.organization.create({ data: {
    name: 'Synthetic cleanup fixture ' + token, isDemo: expired,
    ...(expired ? { demoExpiresAt: new Date(Date.now() - 60_000) } : {}),
  } });
  ids.push(organization.id);
  const clinic = await prisma.clinic.create({ data: {
    organizationId: organization.id, name: 'Synthetic clinic', city: 'Test', address: 'Test',
  } });
  const patient = await prisma.patient.create({ data: {
    organizationId: organization.id, clinicId: clinic.id, fullName: 'Synthetic patient',
    phone: '0000000000', medicalAlerts: [],
  } });
  const scope = { organizationId: organization.id, clinicId: clinic.id, patientId: patient.id };
  const invoice = await prisma.invoice.create({ data: {
    ...scope, invoiceNo: 'QA-' + token, amount: 1000, paidAmount: 1000, dueDate: new Date(), status: 'PAID',
  } });
  const item = await prisma.invoiceItem.create({ data: {
    ...scope, invoiceId: invoice.id, description: 'Synthetic service', unitPrice: 1000, amount: 1000,
  } });
  const receipt = await prisma.receipt.create({ data: {
    ...scope, receiptNo: 'QA-' + token, amount: 1000, allocatedAmount: 1000, unallocatedAmount: 0, method: 'cash',
  } });
  const allocation = await prisma.receiptAllocation.create({ data: {
    ...scope, receiptId: receipt.id, invoiceId: invoice.id, invoiceItemId: item.id, amount: 1000,
  } });
  return { organization, clinic, patient, invoice, item, receipt, allocation };
}

async function main() {
  try {
    const expired = await fixture(true);
    const retained = await fixture(false);
    await purgeOrganization(expired.organization.id);
    for (const model of ['organization', 'clinic', 'patient', 'invoice', 'invoiceItem', 'receipt', 'receiptAllocation']) {
      const key = { organization: 'organization', invoiceItem: 'item', receiptAllocation: 'allocation' }[model] || model;
      assert.equal(await prisma[model].findUnique({ where: { id: expired[key].id } }), null);
      assert.ok(await prisma[model].findUnique({ where: { id: retained[key].id } }), 'Unrelated tenant must survive');
    }
    assert.equal((await prisma.receiptAllocation.findUniqueOrThrow({ where: { id: retained.allocation.id } })).invoiceItemId, retained.item.id);
    console.log('ok expired demo purge handles billing SET NULL checks and preserves the unrelated tenant');
  } finally {
    // Cleanup only this invocation's randomly identified fixtures, even when regression fails.
    const where = { organizationId: { in: ids } };
    await prisma.receiptAllocation.deleteMany({ where });
    await prisma.receipt.deleteMany({ where });
    await prisma.invoiceItem.deleteMany({ where });
    await prisma.invoice.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await prisma.clinic.deleteMany({ where });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
