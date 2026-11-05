const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { load } = require("./audit-source-loader.cjs");

if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Provider settlement concurrency requires a disposable loopback test database.");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const sequence = load("src/lib/document-sequence.ts", { "@/lib/prisma": { prisma } });
const { recordProviderSettlementCommand } = load("src/lib/application/revenue/provider-settlement.ts", {
  "@/lib/document-sequence": sequence,
});

async function main() {
  const org = await prisma.organization.create({ data: { name: `Provider race ${randomUUID()}` } });
  try {
    const clinic = await prisma.clinic.create({ data: { organizationId: org.id, name: "Race clinic", city: "Test", address: "Test" } });
    const patient = await prisma.patient.create({ data: {
      organizationId: org.id, clinicId: clinic.id, fullName: "Synthetic settlement", phone: "0000000000", medicalAlerts: [],
    } });
    const invoice = await prisma.invoice.create({ data: {
      organizationId: org.id, clinicId: clinic.id, patientId: patient.id, invoiceNo: "PROVIDER-RACE",
      amount: 100000, paidAmount: 0, dueDate: new Date(),
    } });
    await Promise.all([1, 2].map(index => prisma.$transaction(tx => recordProviderSettlementCommand(tx, {
      organizationId: org.id, clinicId: clinic.id, patientId: patient.id, invoiceNo: invoice.invoiceNo,
      amount: 75000, method: "bank_transfer", provider: "payos",
      providerReference: `race-${index}`, providerEventId: `event-${index}`,
    }), { maxWait: 15000, timeout: 30000 })));
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true, receiptAllocations: true } });
    const receipts = await prisma.receipt.findMany({ where: { organizationId: org.id } });
    const credit = await prisma.patientCreditBalance.findUniqueOrThrow({ where: { patientId: patient.id } });
    assert.equal(Number(paid.paidAmount), 100000);
    assert.equal(paid.status, "PAID");
    assert.equal(paid.payments.reduce((sum, row) => sum + Number(row.amount), 0), 100000);
    assert.equal(paid.receiptAllocations.reduce((sum, row) => sum + Number(row.amount), 0), 100000);
    assert.equal(receipts.length, 2);
    assert.equal(new Set(receipts.map(row => row.receiptNo)).size, 2);
    assert.equal(receipts.reduce((sum, row) => sum + Number(row.amount), 0), 150000);
    assert.equal(Number(credit.amount), 50000);
    console.log("ok concurrent provider payments preserve invoice allocations, distinct receipts and excess patient credit");
    const voided = await prisma.invoice.create({ data: { organizationId: org.id, clinicId: clinic.id,
      patientId: patient.id, invoiceNo: 'PROVIDER-LATE-VOID', amount: 100000, paidAmount: 0,
      status: 'VOID', dueDate: new Date() } });
    const late = await prisma.$transaction(tx => recordProviderSettlementCommand(tx, {
      organizationId: org.id, clinicId: clinic.id, patientId: patient.id, invoiceNo: voided.invoiceNo,
      amount: 30000, method: 'bank_transfer', provider: 'payos', providerReference: 'late-transfer', providerEventId: 'late-event',
    }));
    assert.equal(late.allocatedAmount, 0); assert.equal(late.unallocatedAmount, 30000);
    const unchangedVoid = await prisma.invoice.findUniqueOrThrow({ where: { id: voided.id } });
    assert.equal(unchangedVoid.status, 'VOID'); assert.equal(Number(unchangedVoid.paidAmount), 0);
    assert.equal(await prisma.payment.count({ where: { invoiceId: voided.id } }), 0);
    assert.equal(await prisma.receiptAllocation.count({ where: { invoiceId: voided.id } }), 0);
    assert.equal(Number((await prisma.patientCreditBalance.findUniqueOrThrow({ where: { patientId: patient.id } })).amount), 80000);
    await assert.rejects(prisma.$transaction(tx => recordProviderSettlementCommand(tx, {
      organizationId: org.id, clinicId: clinic.id, patientId: patient.id, invoiceNo: 'other-scope-or-missing',
      amount: 30000, method: 'bank_transfer', provider: 'payos', providerReference: 'wrong-scope', providerEventId: 'wrong-event',
    })), { code: 'provider-settlement-invoice-not-found' });
    assert.equal(await prisma.receipt.count({ where: { organizationId: org.id } }), 3);
    console.log('ok late verified transfer becomes credit after invoice void; missing invoice remains denied');
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.receiptAllocation.deleteMany({ where: { organizationId: org.id } });
    await prisma.payment.deleteMany({ where: { invoice: { organizationId: org.id } } });
    await prisma.receipt.deleteMany({ where: { organizationId: org.id } });
    await prisma.invoice.deleteMany({ where: { organizationId: org.id } });
    await prisma.patientCreditBalance.deleteMany({ where: { organizationId: org.id } });
    await prisma.documentSequence.deleteMany({ where: { organizationId: org.id } });
    await prisma.patient.deleteMany({ where: { organizationId: org.id } });
    await prisma.clinic.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
