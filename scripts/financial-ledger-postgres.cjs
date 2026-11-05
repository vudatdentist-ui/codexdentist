const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { load } = require("./audit-source-loader.cjs");

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== "test" || process.env.FINANCIAL_LEDGER_DISPOSABLE !== "1" || !url ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !/^\/financial_ledger_test(?:_[a-z0-9]+)?$/.test(url.pathname) ||
    [...url.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service)$/i.test(key))) {
  throw new Error("Requires an explicitly disposable financial_ledger_test database on loopback.");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
const permissions = load("src/lib/permissions.ts");
const scope = load("src/lib/tenant-scope.ts", { "@/lib/permissions": permissions });
const transactions = load("src/lib/transaction.ts", { "@/lib/prisma": { prisma } });
const mocks = {
  "@/lib/prisma": { prisma }, "@/lib/permissions": permissions, "@/lib/tenant-scope": scope,
  "@/lib/actions/permissions": load("src/lib/actions/permissions.ts", { "@/lib/permissions": permissions }),
  "@/lib/form-validation": load("src/lib/form-validation.ts"),
  "@/lib/transaction": transactions,
  "@/lib/document-sequence": load("src/lib/document-sequence.ts", { "@/lib/prisma": { prisma } }),
  "@/lib/notification-templates": {},
};
const revenue = load("src/lib/application/revenue/commands.ts", mocks);
const provider = load("src/lib/application/revenue/provider-settlement.ts", mocks);
const commissions = load("src/lib/source-commission.ts", mocks);
const ledger = load("src/lib/application/revenue/refund-ledger.ts", mocks);
const cents = (value) => Math.round(Number(value) * 100);
const expectCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);
let org, clinic, clinicB, user, session;
let serial = 0;

async function fixture({ source = "WALK_IN", amount = 100000, inClinic = null } = {}) {
  const clinicId = inClinic ?? clinic.id;
  const patient = await prisma.patient.create({ data: { organizationId: org.id, clinicId,
    fullName: "Synthetic financial fixture", phone: `000${String(++serial).padStart(7, "0")}`, medicalAlerts: [], leadSource: source } });
  const invoice = await prisma.invoice.create({ data: { organizationId: org.id, clinicId,
    patientId: patient.id, invoiceNo: `FIN-${++serial}`, amount, paidAmount: 0, dueDate: new Date(),
    items: { create: { organizationId: org.id, clinicId, patientId: patient.id,
      description: "Synthetic", quantity: 1, unitPrice: amount, amount } } } });
  return { patient, invoice };
}
async function settle(f, amount = Number(f.invoice.amount)) {
  return prisma.$transaction((tx) => provider.recordProviderSettlementCommand(tx, {
    organizationId: org.id, clinicId: f.invoice.clinicId, patientId: f.patient.id,
    invoiceNo: f.invoice.invoiceNo, amount, method: "bank_transfer", provider: "payos",
    providerReference: randomUUID(), providerEventId: randomUUID(),
  }));
}
function refund(f, amount, idempotencyKey = randomUUID(), actor = session) {
  return revenue.recordInvoiceRefundCommand(actor, { invoiceNo: f.invoice.invoiceNo,
    amount, method: "cash", reference: "same human reason", idempotencyKey });
}
async function snapshot(f) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: f.invoice.id },
    include: { payments: true, receiptAllocations: true, items: true } });
  const receipts = await prisma.receipt.findMany({ where: { patientId: f.patient.id }, orderBy: { id: "asc" } });
  const credit = await prisma.patientCreditBalance.findUnique({ where: { patientId: f.patient.id } });
  return { invoice, receipts, credit: Number(credit?.amount ?? 0) };
}
async function policy(source) {
  return prisma.sourceCommissionPolicy.create({ data: { organizationId: org.id, source,
    name: "Synthetic policy", ratePercent: 10, fixedAmount: 10000 } });
}
async function generate() {
  return commissions.generateSourceCommissionAccruals({ organizationId: org.id, clinicIds: [clinic.id], actorId: user.id });
}
async function shared(source) {
  await policy(source);
  const f = await fixture({ source });
  const second = await prisma.invoice.create({ data: { organizationId: org.id, clinicId: clinic.id,
    patientId: f.patient.id, invoiceNo: `FIN-${++serial}`, amount: 100000, paidAmount: 100000,
    status: "PAID", dueDate: new Date(), items: { create: { organizationId: org.id, clinicId: clinic.id,
      patientId: f.patient.id, description: "Synthetic B", quantity: 1, unitPrice: 100000, amount: 100000 } } } });
  const receipt = await prisma.receipt.create({ data: { organizationId: org.id, clinicId: clinic.id,
    patientId: f.patient.id, receiptNo: `SHARED-${serial}`, amount: 200000, allocatedAmount: 200000,
    unallocatedAmount: 0, method: "cash" } });
  await prisma.invoice.update({ where: { id: f.invoice.id }, data: { paidAmount: 100000, status: "PAID" } });
  for (const invoice of [f.invoice, second]) {
    await prisma.payment.create({ data: { invoiceId: invoice.id, amount: 100000, method: "cash", reference: receipt.receiptNo } });
    await prisma.receiptAllocation.create({ data: { organizationId: org.id, clinicId: clinic.id,
      patientId: f.patient.id, invoiceId: invoice.id, receiptId: receipt.id, amount: 100000 } });
  }
  return { ...f, second: { patient: f.patient, invoice: second }, receipt };
}
async function accrual(receiptId, base, commission) {
  const row = await prisma.sourceCommissionAccrual.findFirstOrThrow({ where: { receiptId } });
  assert.equal(Number(row.baseAmount), base);
  assert.equal(Number(row.commissionAmount), commission);
}
async function service(f) {
  return prisma.treatmentService.create({ data: { organizationId: org.id, clinicId: f.invoice.clinicId,
    patientId: f.patient.id, createdById: user.id, serviceCode: `S-${++serial}`, serviceName: "Synthetic service",
    teeth: [], finalPrice: 100000 } });
}

async function main() {
  org = await prisma.organization.create({ data: { name: `Financial ledger ${randomUUID()}` } });
  clinic = await prisma.clinic.create({ data: { organizationId: org.id, name: "Synthetic A", city: "Test", address: "Test" } });
  clinicB = await prisma.clinic.create({ data: { organizationId: org.id, name: "Synthetic B", city: "Test", address: "Test" } });
  user = await prisma.user.create({ data: { organizationId: org.id, email: `financial-${randomUUID()}@example.test`,
    fullName: "Synthetic staff", passwordHash: "unusable-synthetic", role: "OWNER" } });
  session = { userId: user.id, organizationId: org.id, role: "OWNER", roles: ["OWNER"],
    roleAssignments: [{ role: "OWNER", organizationId: org.id, clinicId: null }],
    clinicIds: [clinic.id, clinicB.id], activeClinicId: null };

  {
    const f = await fixture(); await settle(f);
    await revenue.voidInvoiceCommand(session, f.invoice.invoiceNo);
    await revenue.voidInvoiceCommand(session, f.invoice.invoiceNo);
    const state = await snapshot(f);
    assert.equal(Number(state.invoice.paidAmount), 0);
    assert.equal(state.invoice.payments.reduce((sum, row) => sum + Number(row.amount), 0), 0);
    assert.equal(state.credit, 100000);
    assert.equal(state.receipts[0].amount.toString(), "100000");
    assert.equal(state.invoice.payments.filter((row) => row.method === "void_reversal").length, 1);
    console.log("ok provider collection -> paid void -> replay releases credit exactly once");
  }
  {
    const f = await fixture(); await settle(f, 50000);
    await revenue.voidInvoiceCommand(session, f.invoice.invoiceNo);
    const state = await snapshot(f);
    assert.equal(state.credit, 50000); assert.equal(Number(state.invoice.paidAmount), 0);
    assert.equal(state.invoice.payments.reduce((sum, row) => sum + Number(row.amount), 0), 0);
    console.log("ok partially paid ordinary void releases only the collected 50000");
  }
  {
    const f = await fixture(); await settle(f);
    const key = randomUUID(); await refund(f, 50000, key); await refund(f, 50000, key);
    let state = await snapshot(f);
    assert.equal(Number(state.invoice.paidAmount), 50000);
    assert.equal(state.invoice.payments.filter((row) => row.amount.lt(0)).length, 1);
    await expectCode(refund(f, 40000, key), "billing-refund-reference-conflict");
    await refund(f, 50000); await refund(f, 50000, key);
    state = await snapshot(f);
    assert.equal(Number(state.invoice.paidAmount), 0);
    await expectCode(revenue.voidInvoiceCommand(session, f.invoice.invoiceNo), "billing-invoice-refund-void-unsupported");
    assert.equal((await snapshot(f)).credit, 0);
    assert.equal(Number(state.receipts[0].amount), 100000);
    assert.equal(Number(state.receipts[0].allocatedAmount), 100000);
    assert.equal(Number(state.receipts[0].unallocatedAmount), 0);
    console.log("ok two intentional refunds, same-key replay including exhaustion, refunded void rejected with credit zero");
  }
  {
    const f = await fixture(); await settle(f);
    const s = await service(f);
    await prisma.receiptAllocation.updateMany({ where: { invoiceId: f.invoice.id }, data: { treatmentServiceId: s.id } });
    await expectCode(refund(f, 50000), "billing-refund-service-linked-unsupported");
    assert.equal(Number((await snapshot(f)).invoice.paidAmount), 100000);
    await revenue.voidInvoiceCommand(session, f.invoice.invoiceNo);
    const rows = await prisma.receiptAllocation.findMany({ where: { treatmentServiceId: s.id } });
    assert.equal(rows.length, 1); assert.equal(rows[0].invoiceId, null);
    assert.equal(Number(rows[0].amount), 100000); assert.equal((await snapshot(f)).credit, 0);
    console.log("ok service refund denied before mutation; ordinary service void retains collection without credit");
  }
  {
    const f = await shared(`FIXED-${serial}`); await generate();
    await accrual(f.receipt.id, 200000, 30000);
    await refund(f, 50000); await accrual(f.receipt.id, 150000, 25000);
    await refund(f, 50000); await accrual(f.receipt.id, 100000, 20000);
    assert.equal(Number((await snapshot(f.second)).invoice.paidAmount), 100000);
    await refund(f.second, 100000); await accrual(f.receipt.id, 0, 0);
    await generate(); await accrual(f.receipt.id, 0, 0);
    console.log("ok repeated refunds preserve the other invoice share, snapshot rate and fixed fee; full refund removes both");
  }
  {
    const f = await shared(`ROLLBACK-${serial}`); await generate();
    const failing = load("src/lib/application/revenue/commands.ts", { ...mocks,
      "@/lib/transaction": { runSerializableTransaction: (callback) => prisma.$transaction((tx) => callback(new Proxy(tx, {
        get(target, key) {
          if (key !== "auditLog") return target[key];
          return new Proxy(target.auditLog, { get(model, method) {
            if (method === "create") return async () => { throw Error("synthetic refund attribution write failure"); };
            return model[method];
          } });
        },
      })), { isolationLevel: "Serializable" }) },
    });
    await assert.rejects(failing.recordInvoiceRefundCommand(session, { invoiceNo: f.invoice.invoiceNo,
      amount: 50000, method: "cash", reference: null }), /synthetic refund attribution write failure/);
    const state = await snapshot(f);
    assert.equal(Number(state.invoice.paidAmount), 100000);
    assert.equal(state.invoice.payments.length, 1);
    await accrual(f.receipt.id, 200000, 30000);
    console.log("ok failed durable attribution write rolls back payment, invoice and commission changes together");
  }
  {
    const f = await shared(`LATE-${serial}`); await refund(f, 100000);
    // Model imported/unlinked history to prove discovery does not depend on current invoice links.
    const s = await service(f);
    await prisma.receiptAllocation.updateMany({ where: { invoiceId: f.invoice.id },
      data: { invoiceId: null, treatmentServiceId: s.id } });
    await prisma.invoice.update({ where: { id: f.invoice.id }, data: { status: "VOID" } });
    await generate(); await accrual(f.receipt.id, 100000, 20000);
    const history = await prisma.$transaction((tx) => ledger.loadReceiptRefundLedger(tx, org.id, [f.receipt.id]));
    assert.equal(history.byReceipt.get(f.receipt.id), 10000000);
    console.log("ok first commission generation after refund/unlink uses durable original basis and receipt attribution");
  }
  {
    const f = await shared(`VOIDSHARE-${serial}`); await generate(); await refund(f, 50000);
    await revenue.voidInvoiceCommand(session, f.second.invoice.invoiceNo);
    const state = await snapshot(f);
    assert.equal(state.credit, 100000);
    assert.equal(Number(state.invoice.paidAmount), 50000);
    assert.equal(Number(state.receipts[0].allocatedAmount), 100000);
    assert.equal(Number(state.receipts[0].unallocatedAmount), 100000);
    await accrual(f.receipt.id, 150000, 25000);
    await expectCode(revenue.voidInvoiceCommand(session, f.invoice.invoiceNo), "billing-invoice-refund-void-unsupported");
    assert.equal((await snapshot(f)).credit, 100000);
    await refund(f, 50000); await accrual(f.receipt.id, 100000, 20000);
    assert.equal((await snapshot(f)).credit, 100000);
    console.log("ok voiding the unrefunded share of a shared receipt releases only its own credit");
  }
  {
    const f = await fixture(); await settle(f); const s = await service(f);
    const initial = (await snapshot(f)).invoice.receiptAllocations[0];
    await prisma.receiptAllocation.update({ where: { id: initial.id }, data: { amount: 70000, treatmentServiceId: s.id } });
    await prisma.receiptAllocation.create({ data: { organizationId: org.id, clinicId: clinic.id, patientId: f.patient.id,
      receiptId: initial.receiptId, invoiceId: f.invoice.id, amount: 30000 } });
    await revenue.voidInvoiceCommand(session, f.invoice.invoiceNo);
    const state = await snapshot(f);
    assert.equal(state.credit, 30000); assert.equal(Number(state.receipts[0].allocatedAmount), 70000);
    console.log("ok mixed service/direct void releases only direct credit while preserving service collection");
  }
  for (let round = 0; round < 3; round++) {
    const f = await shared(`RACE-${serial}`); await generate();
    await Promise.all([refund(f, 50000), refund(f.second, 50000)]);
    await accrual(f.receipt.id, 100000, 20000);
    await Promise.all([refund(f, 50000), refund(f.second, 50000)]);
    await accrual(f.receipt.id, 0, 0);
  }
  console.log("ok shared-receipt refund races serialize consistently (3 rounds)");
  {
    const f = await fixture(); await settle(f);
    const key = randomUUID(); await Promise.all([refund(f, 50000, key), refund(f, 50000, key)]);
    assert.equal(Number((await snapshot(f)).invoice.paidAmount), 50000);
    console.log("ok simultaneous replay creates only one negative payment");
  }
  {
    const f = await fixture({ source: `GENRACE-${serial}` }); await policy(f.patient.leadSource); await settle(f);
    await Promise.all([generate(), refund(f, 50000)]);
    await generate();
    const state = await snapshot(f); await accrual(state.receipts[0].id, 50000, 15000);
    console.log("ok commission generation racing refund converges to net retained collection");
  }
  {
    const f = await fixture({ source: `DOUBLEGEN-${serial}` }); await policy(f.patient.leadSource); await settle(f);
    await Promise.all([generate(), generate()]);
    const state = await snapshot(f); await accrual(state.receipts[0].id, 100000, 20000);
    assert.equal(await prisma.sourceCommissionAccrual.count({ where: { receiptId: state.receipts[0].id } }), 1);
    console.log("ok simultaneous generators create one accrual without losing a refund snapshot");
  }
  {
    const f = await shared(`PAIDCOMM-${serial}`); await generate();
    await prisma.sourceCommissionAccrual.updateMany({ where: { receiptId: f.receipt.id }, data: { status: "PAID", paidAt: new Date() } });
    await expectCode(refund(f, 50000), "billing-refund-paid-commission-unsupported");
    await expectCode(revenue.recordInvoiceRefundCommand(session, { invoiceNo: f.invoice.invoiceNo, amount: 50000,
      method: "credit_balance", reference: null }), "billing-refund-method-unsupported");
    assert.equal(Number((await snapshot(f)).invoice.paidAmount), 100000);
    await accrual(f.receipt.id, 200000, 30000);
    console.log("ok paid commissions and unsupported credit refunds reject atomically without rewriting history");
  }
  {
    const f = await fixture();
    await revenue.adjustInvoiceAmountCommand(session, { invoiceNo: f.invoice.invoiceNo, amount: 80000, reason: null });
    const good = await snapshot(f);
    assert.equal(Number(good.invoice.amount), 80000); assert.equal(Number(good.invoice.items[0].amount), 80000);
    await settle(f, 80000);
    await expectCode(revenue.adjustInvoiceAmountCommand(session, { invoiceNo: f.invoice.invoiceNo, amount: 60000, reason: null }), "billing-invoice-adjustment-locked");
    const multi = await fixture();
    await prisma.invoiceItem.create({ data: { organizationId: org.id, clinicId: clinic.id, patientId: multi.patient.id,
      invoiceId: multi.invoice.id, description: "Second", quantity: 1, unitPrice: 0, amount: 0 } });
    await expectCode(revenue.adjustInvoiceAmountCommand(session, { invoiceNo: multi.invoice.invoiceNo, amount: 80000, reason: null }), "billing-invoice-adjustment-locked");
    console.log("ok unsettled single-line adjustment positive, paid and multiline guards negative");
  }
  {
    const f = await fixture(); await settle(f);
    await prisma.receiptAllocation.updateMany({ where: { invoiceId: f.invoice.id }, data: { amount: 90000 } });
    await expectCode(refund(f, 10000), "billing-refund-ledger-unreconciled");
    await prisma.receiptAllocation.updateMany({ where: { invoiceId: f.invoice.id }, data: { amount: 100000 } });
    await prisma.payment.create({ data: { invoiceId: f.invoice.id, amount: -10000, method: "refund:cash" } });
    await prisma.invoice.update({ where: { id: f.invoice.id }, data: { paidAmount: 90000, status: "PARTIAL" } });
    await expectCode(refund(f, 10000), "billing-refund-history-unreconciled");
    const invalid = await fixture(); await settle(invalid);
    await prisma.invoice.update({ where: { id: invalid.invoice.id }, data: { paidAmount: 90000 } });
    await expectCode(refund(invalid, 10000), "billing-invoice-ledger-unreconciled");
    await expectCode(revenue.voidInvoiceCommand(session, invalid.invoice.invoiceNo), "billing-invoice-ledger-unreconciled");
    await prisma.invoice.update({ where: { id: invalid.invoice.id }, data: { paidAmount: 100000 } });
    console.log("ok inconsistent allocation, legacy unattributed refund and paid/header mismatch reject without repair");
  }
  {
    const f = await fixture({ inClinic: clinicB.id }); await settle(f);
    const manager = { ...session, role: "BILLING", roles: ["BILLING"], activeClinicId: clinic.id,
      roleAssignments: [{ organizationId: org.id, clinicId: clinic.id, role: "BILLING" }] };
    await expectCode(refund(f, 10000, randomUUID(), manager), "billing-invoice-not-found");
    const foreign = { ...session, organizationId: "foreign", roleAssignments: [{ organizationId: "foreign", clinicId: null, role: "OWNER" }] };
    await expectCode(refund(f, 10000, randomUUID(), foreign), "billing-invoice-not-found");
    const patient = { ...session, role: "PATIENT", roles: ["PATIENT"], roleAssignments: [] };
    await expectCode(refund(f, 10000, randomUUID(), patient), "billing-denied");
    console.log("ok actual permissions, organization and active-clinic denials");
  }
  {
    const source = `STARVATION-${serial}`;
    const p = await policy(source);
    await prisma.sourceCommissionPolicy.update({ where: { id: p.id }, data: { fixedAmount: 0 } });
    const f = await fixture({ source });
    const prefix = randomUUID();
    const rows = Array.from({ length: 1001 }, (_, index) => ({ invoiceId: `${prefix}-I-${index}`,
      receiptId: `${prefix}-R-${String(index).padStart(4, "0")}` }));
    await prisma.invoice.createMany({ data: rows.map((row, index) => ({ id: row.invoiceId,
      organizationId: org.id, clinicId: clinic.id, patientId: f.patient.id, invoiceNo: `STARVE-${prefix}-${index}`,
      amount: 100, paidAmount: 100, status: "PAID", dueDate: new Date() })) });
    await prisma.invoiceItem.createMany({ data: rows.map((row) => ({ organizationId: org.id, clinicId: clinic.id,
      patientId: f.patient.id, invoiceId: row.invoiceId, description: "Synthetic batch", quantity: 1, unitPrice: 100, amount: 100 })) });
    await prisma.receipt.createMany({ data: rows.map((row, index) => ({ id: row.receiptId, organizationId: org.id,
      clinicId: clinic.id, patientId: f.patient.id, receiptNo: `STARVE-${prefix}-${index}`, amount: 100,
      allocatedAmount: 100, unallocatedAmount: 0, method: "cash", receivedAt: new Date("2035-01-01T00:00:00Z") })) });
    await prisma.payment.createMany({ data: rows.map((row) => ({ invoiceId: row.invoiceId, amount: 100, method: "cash" })) });
    await prisma.receiptAllocation.createMany({ data: rows.map((row) => ({ organizationId: org.id, clinicId: clinic.id,
      patientId: f.patient.id, receiptId: row.receiptId, invoiceId: row.invoiceId, amount: 100 })) });
    await prisma.sourceCommissionAccrual.createMany({ data: rows.slice(0, 1000).map((row) => ({
      organizationId: org.id, clinicId: clinic.id, patientId: f.patient.id, receiptId: row.receiptId, policyId: p.id,
      source, baseAmount: 100, ratePercent: 10, fixedAmount: 0, commissionAmount: 10, earnedAt: new Date() })) });
    await generate(); await accrual(rows[1000].receiptId, 100, 10);
    console.log("ok PostgreSQL generator reaches eligible receipt after 1000 already-accrued rows");
  }
  {
    const f = await fixture({ source: `PROVEN-VOID-${serial}` }); await policy(f.patient.leadSource);
    await settle(f); await generate();
    const legacyAccrual = await prisma.sourceCommissionAccrual.findFirstOrThrow({ where: { patientId: f.patient.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id, action: "source_commission.accrued", entityId: legacyAccrual.id } });
    await revenue.voidInvoiceCommand(session, f.invoice.invoiceNo);
    const proof = await prisma.auditLog.findFirstOrThrow({ where: { entityId: f.invoice.id, action: "invoice.voided" } });
    assert.equal(proof.metadata.directReceiptReleases.length, 1);
    assert.equal(proof.metadata.directReceiptReleases[0].amount, 100000);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: proof.metadata.voidReversalPaymentId } });
    assert.equal(payment.method, "void_reversal");
    assert.equal(Number(payment.amount), -100000);
    assert.equal(proof.metadata.commissionBasisSnapshots[0].grossBase, 100000);
    console.log("ok legacy earned basis is validated and retained atomically with its void reversal");
  }
  {
    const f = await fixture({ source: `BADLEGACY-${serial}` }); await policy(f.patient.leadSource);
    await settle(f); await generate();
    const row = await prisma.sourceCommissionAccrual.findFirstOrThrow({ where: { patientId: f.patient.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id, action: "source_commission.accrued", entityId: row.id } });
    await prisma.sourceCommissionAccrual.update({ where: { id: row.id }, data: { baseAmount: 10000, commissionAmount: 11000 } });
    await expectCode(revenue.voidInvoiceCommand(session, f.invoice.invoiceNo), "billing-refund-commission-unreconciled");
    assert.equal(Number((await snapshot(f)).invoice.paidAmount), 100000);
    assert.equal((await snapshot(f)).credit, 0);
    await prisma.sourceCommissionAccrual.update({ where: { id: row.id }, data: { baseAmount: row.baseAmount, commissionAmount: row.commissionAmount } });
    console.log("ok void cannot endorse an already-corrupt legacy commission basis");
  }
  {
    const f = await fixture({ amount: 1234567890.12 });
    await revenue.recordInvoicePaymentCommand(session, { invoiceNo: f.invoice.invoiceNo, amount: 1234567890.12, method: "cash" });
    await refund(f, 0.12);
    assert.equal((await snapshot(f)).invoice.paidAmount.toString(), "1234567890");
    console.log("ok large two-decimal collection and refund preserve exact cents");
  }
  {
    const f = await fixture({ source: `TIMESTAMP-${serial}` }); await policy(f.patient.leadSource);
    await settle(f); await generate();
    const row = await prisma.sourceCommissionAccrual.findFirstOrThrow({ where: { patientId: f.patient.id } });
    await prisma.sourceCommissionAccrual.update({ where: { id: row.id }, data: { baseAmount: 10000, commissionAmount: 11000 } });
    await prisma.receipt.updateMany({ where: { patientId: f.patient.id }, data: { updatedAt: new Date(Date.now() + 1000) } });
    const invalid = spawnSync(process.execPath, ["scripts/source-commission-smoke.mjs"], {
      encoding: "utf8", windowsHide: true, env: process.env,
    });
    assert.notEqual(invalid.status, 0, "A changed timestamp must not hide an incorrect commission basis.");
    assert.match(invalid.stderr, /original eligible basis does not match receipt allocation/);
    await prisma.sourceCommissionAccrual.update({ where: { id: row.id },
      data: { baseAmount: row.baseAmount, commissionAmount: row.commissionAmount } });
    console.log("ok actual commission gate rejects timestamp-only basis drift beyond 1000 accruals");
  }
  await assertConservation();
  const gate = spawnSync(process.execPath, ["scripts/source-commission-smoke.mjs"], {
    encoding: "utf8", windowsHide: true, env: process.env,
  });
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  console.log("ok source-commission gate validates live refund, unlink, fixed-fee and shared-receipt fixtures");
  console.log("ok PostgreSQL financial ledger regressions and receipt conservation");
}

async function assertConservation() {
  const receipts = await prisma.receipt.findMany({ where: { organizationId: org.id }, include: { allocations: true } });
  for (const receipt of receipts) {
    assert.equal(cents(receipt.amount), cents(receipt.allocatedAmount) + cents(receipt.unallocatedAmount));
    assert.equal(cents(receipt.allocatedAmount), receipt.allocations.reduce((sum, row) => sum + cents(row.amount), 0));
  }
  const invoices = await prisma.invoice.findMany({ where: { organizationId: org.id }, include: { payments: true } });
  for (const invoice of invoices) assert.equal(cents(invoice.paidAmount), invoice.payments.reduce((sum, row) => sum + cents(row.amount), 0));
}
async function cleanup() {
  if (!org) return;
  const where = { organizationId: org.id };
  await prisma.auditLog.deleteMany({ where });
  await prisma.sourceCommissionAccrual.deleteMany({ where });
  await prisma.sourceCommissionPolicy.deleteMany({ where });
  await prisma.receiptAllocation.deleteMany({ where });
  await prisma.payment.deleteMany({ where: { invoice: where } });
  await prisma.invoiceItem.deleteMany({ where });
  await prisma.invoice.deleteMany({ where });
  await prisma.receipt.deleteMany({ where });
  await prisma.patientCreditBalance.deleteMany({ where });
  await prisma.treatmentService.deleteMany({ where });
  await prisma.documentSequence.deleteMany({ where });
  await prisma.patient.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.clinic.deleteMany({ where });
  await prisma.organization.delete({ where: { id: org.id } });
}
main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { try { await cleanup(); } finally { await prisma.$disconnect(); } });
