const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./audit-source-loader.cjs");
const ledger = load("src/lib/application/revenue/refund-ledger.ts");
const voidLedger = load("src/lib/application/revenue/void-ledger.ts");

test("decimal money conversion preserves large valid amounts without binary rounding rejection", () => {
  const { Prisma } = require("@prisma/client");
  for (const input of [1234567890.12, "1234567890.12", new Prisma.Decimal("1234567890.12")]) {
    assert.equal(ledger.moneyCents(input), 123456789012);
  }
  assert.equal(ledger.moneyCents("-0.29"), -29);
  assert.equal(ledger.moneyCents("1.2300"), 123);
  for (const input of [null, [], {}, NaN, Infinity, "1.001", "90071992547410"]) {
    assert.throws(() => ledger.moneyCents(input), error => error.code === "billing-money-invalid");
  }
});

test("retained commission basis requires receipt-specific reversal evidence, not timestamps", () => {
  const payment = { id: "V", invoiceId: "I", amount: -100, method: "void_reversal" };
  const audit = { entityId: "I", createdAt: new Date(), metadata: {
    invoiceVoidLedgerVersion: 1, voidReversalPaymentId: "V", paymentReversed: 100,
    directReceiptReleases: [{ receiptId: "R", amount: 100 }],
  } };
  assert.equal(voidLedger.readVoidReleaseLedger([audit], [payment]).get("R")[0].amount, 10000);
  for (const payments of [[], [{ ...payment, invoiceId: "OTHER" }], [{ ...payment, amount: -50 }]]) {
    assert.throws(() => voidLedger.readVoidReleaseLedger([audit], payments),
      error => error.code === "billing-invoice-ledger-unreconciled");
  }
  assert.throws(() => voidLedger.readVoidReleaseLedger([audit, audit], [payment]),
    error => error.code === "billing-invoice-ledger-unreconciled");
});

test("refund attribution conserves every cent and is independent of receipt order", () => {
  for (let cents = 1; cents <= 301; cents++) {
    const capacities = new Map([["B", 101], ["A", 100], ["C", 100]]);
    const shares = ledger.planRefundShares(cents / 100, capacities);
    assert.equal(shares.reduce((sum, share) => sum + ledger.moneyCents(share.amount), 0), cents);
    for (const share of shares) assert.ok(ledger.moneyCents(share.amount) <= capacities.get(share.receiptId));
    assert.deepEqual(JSON.parse(JSON.stringify(shares)), JSON.parse(JSON.stringify(
      ledger.planRefundShares(cents / 100, new Map([...capacities].reverse())))));
  }
});

test("fixed commission survives partial refunds and is removed only when the eligible base is exhausted", () => {
  assert.equal(ledger.receiptCommission(200000, 10, 10000), 30000);
  assert.equal(ledger.receiptCommission(150000, 10, 10000), 25000);
  assert.equal(ledger.receiptCommission(100000, 10, 10000), 20000);
  assert.equal(ledger.receiptCommission(0, 10, 10000), 0);
});

test("durable refund attribution retains both invoice shares and a stable original receipt basis", () => {
  const payments = [{ id: "P1", invoiceId: "A", amount: -50 }, { id: "P2", invoiceId: "B", amount: -25 }];
  const audit = (entityId, paymentId, amount) => ({ entityId, metadata: { refundLedgerVersion: 1, paymentId,
    refundShares: [{ receiptId: "R", amount }], receiptGrossBases: [{ receiptId: "R", amount: 200 }] } });
  const refunds = ledger.readRefundLedger(payments, [audit("A", "P1", 50), audit("B", "P2", 25)]);
  assert.equal(refunds.byInvoice.get("A").get("R"), 5000);
  assert.equal(refunds.byInvoice.get("B").get("R"), 2500);
  assert.equal(refunds.byReceipt.get("R"), 7500);
  assert.equal(refunds.grossBases.get("R"), 20000);
  assert.throws(() => ledger.readRefundLedger(payments, [audit("A", "P1", 49), audit("B", "P2", 25)]),
    (error) => error.code === "billing-refund-history-unreconciled");
  assert.throws(() => ledger.readRefundLedger(payments, []),
    (error) => error.code === "billing-refund-history-unreconciled");
});

function commandFixture({ paid = 100000, payments = null, service = false, items = [100000] } = {}) {
  const state = { invoice: { id: "I", organizationId: "org", clinicId: "clinic", patientId: "patient",
    invoiceNo: "INV", amount: 100000, paidAmount: paid, status: paid ? "PAID" : "OPEN" },
    payments: payments ?? (paid ? [{ amount: paid, method: "bank_transfer" }] : []),
    allocations: paid ? [{ id: "A", receiptId: "R", invoiceId: "I", treatmentServiceId: service ? "S" : null, amount: paid }] : [],
    receipt: { amount: paid, allocatedAmount: paid, unallocatedAmount: 0 }, credit: 0, audits: [],
    items: items.map((amount, i) => ({ id: `L${i}`, amount, unitPrice: amount, quantity: 1 })) };
  const tx = {
    invoice: { findFirst: async () => ({ ...state.invoice, payments: state.payments.map((row) => ({ ...row })),
      items: state.items, receiptAllocations: state.allocations }),
      update: async ({ data }) => Object.assign(state.invoice, data) },
    invoiceItem: { update: async ({ where, data }) => Object.assign(state.items.find((row) => row.id === where.id), data) },
    receiptAllocation: { findMany: async () => state.allocations.map((row) => ({ ...row })),
      updateMany: async ({ data }) => { for (const row of state.allocations) Object.assign(row, data); },
      deleteMany: async () => { state.allocations = []; } },
    receipt: { update: async ({ data }) => {
      state.receipt.allocatedAmount -= data.allocatedAmount.decrement;
      state.receipt.unallocatedAmount += data.unallocatedAmount.increment;
    } },
    patientCreditBalance: { upsert: async ({ update }) => { state.credit += update.amount.increment; } },
    sourceCommissionAccrual: { findMany: async () => [] },
    payment: { create: async ({ data }) => { state.payments.push(data); return { id: "new", ...data }; } },
    auditLog: { create: async ({ data }) => { state.audits.push(data); } },
  };
  const commands = load("src/lib/application/revenue/commands.ts", {
    "@/lib/prisma": { prisma: tx }, "@/lib/transaction": { runSerializableTransaction: (callback) => callback(tx) },
    "@/lib/actions/permissions": { canPerformAction: () => true },
    "@/lib/tenant-scope": { accessibleClinicIds: () => ["clinic"] },
    "@/lib/form-validation": { databaseActorId: (id) => id },
    "@/lib/document-sequence": {}, "@/lib/notification-templates": {},
  });
  return { state, commands, session: { organizationId: "org", userId: "staff" } };
}

test("actual paid void reverses net payments and releases retained collection once", async () => {
  const f = commandFixture();
  await f.commands.voidInvoiceCommand(f.session, "INV");
  assert.equal(f.state.invoice.paidAmount, 0);
  assert.equal(f.state.payments.reduce((sum, row) => sum + row.amount, 0), 0);
  assert.equal(f.state.credit, 100000);
  assert.equal(f.state.receipt.amount, 100000);
  assert.equal(f.state.receipt.allocatedAmount + f.state.receipt.unallocatedAmount, 100000);
  await f.commands.voidInvoiceCommand(f.session, "INV");
  assert.equal(f.state.credit, 100000);
  assert.equal(f.state.audits.length, 1);
});

test("actual void refuses already-refunded money without changing receipt or credit", async () => {
  const f = commandFixture({ paid: 0, payments: [{ amount: 100000, method: "cash" }, { amount: -100000, method: "refund:cash" }] });
  f.state.allocations = [{ id: "A", receiptId: "R", invoiceId: "I", amount: 100000 }];
  await assert.rejects(f.commands.voidInvoiceCommand(f.session, "INV"),
    (error) => error.code === "billing-invoice-refund-void-unsupported");
  assert.equal(f.state.credit, 0);
  assert.equal(f.state.invoice.status, "OPEN");
  assert.equal(f.state.payments.length, 2);
});

test("actual service-linked void preserves service collection and does not create credit", async () => {
  const f = commandFixture({ service: true });
  await f.commands.voidInvoiceCommand(f.session, "INV");
  assert.equal(f.state.allocations[0].invoiceId, null);
  assert.equal(f.state.allocations[0].treatmentServiceId, "S");
  assert.equal(f.state.receipt.allocatedAmount, 100000);
  assert.equal(f.state.credit, 0);
});

test("actual service-linked refund is explicitly unsupported and leaves gross service collection intact", async () => {
  const f = commandFixture({ service: true });
  await assert.rejects(f.commands.recordInvoiceRefundCommand(f.session, {
    invoiceNo: "INV", amount: 50000, method: "cash", reference: null,
  }), (error) => error.code === "billing-refund-service-linked-unsupported");
  assert.equal(f.state.invoice.paidAmount, 100000);
  assert.equal(f.state.allocations[0].amount, 100000);
  assert.equal(f.state.payments.length, 1);
  assert.equal(f.state.credit, 0);
});

for (const kind of ["multi-line", "paid", "allocation", "multi-unit"]) {
  test(`actual adjustment rejects ${kind} invoice before changing its header/items`, async () => {
    const f = commandFixture({ paid: kind === "paid" ? 100000 : 0, items: kind === "multi-line" ? [60000, 40000] : [100000] });
    if (kind === "allocation") f.state.allocations.push({ id: "A", amount: 10000 });
    if (kind === "multi-unit") f.state.items[0].quantity = 2;
    await assert.rejects(f.commands.adjustInvoiceAmountCommand(f.session, { invoiceNo: "INV", amount: 80000, reason: null }),
      (error) => error.code === "billing-invoice-adjustment-locked");
    assert.equal(f.state.invoice.amount, 100000);
    assert.equal(f.state.audits.length, 0);
  });
}

test("actual unsettled single-unit invoice adjustment keeps header and item equal", async () => {
  const f = commandFixture({ paid: 0 });
  await f.commands.adjustInvoiceAmountCommand(f.session, { invoiceNo: "INV", amount: 80000, reason: null });
  assert.equal(f.state.invoice.amount, 80000);
  assert.equal(f.state.items[0].amount, 80000);
  assert.equal(f.state.items[0].unitPrice, 80000);
});

for (const prefix of ["already accrued", "zero eligible base"]) {
  test(`actual generator reaches a new receipt after 1000 ${prefix} rows`, async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `R${String(i).padStart(4, "0")}`,
      clinicId: "clinic", patientId: "patient", receivedAt: new Date(i),
      allocatedAmount: i < 1000 && prefix === "zero eligible base" ? 0 : 100000,
      patient: { leadSource: "REFERRAL" }, allocations: [],
      sourceCommissionAccruals: i < 1000 && prefix === "already accrued" ? [{ policyId: "policy" }] : [] }));
    const created = [];
    const tx = {
      sourceCommissionPolicy: { findMany: async () => [{ id: "policy", source: "REFERRAL", ratePercent: 10, fixedAmount: 0 }] },
      receipt: { findMany: async ({ where, take }) => {
        assert.equal(where.OR[0].sourceCommissionAccruals.none.policyId, "policy", "missing accrual is filtered before take");
        const after = where.AND?.[0].OR[0].receivedAt.gt;
        return rows.filter((row) => !row.sourceCommissionAccruals.length && (!after || row.receivedAt > after)).slice(0, take);
      } },
      auditLog: { findMany: async () => [], create: async () => ({}), createMany: async ({ data }) => {
        assert.equal(data.length, 1);
        assert.equal(data[0].metadata.commissionBasisLedgerVersion, 1);
        assert.equal(data[0].metadata.commissionBasisSnapshots[0].grossBase, 100000);
      } },
      sourceCommissionAccrual: { upsert: async ({ create }) => { created.push(create); return { ...create, id: "ACCRUAL" }; } },
    };
    const generator = load("src/lib/source-commission.ts", {
      "@/lib/prisma": { prisma: tx }, "@/lib/transaction": { runSerializableTransaction: (callback) => callback(tx) },
      "@/lib/tenant-scope": { accessibleClinicIds: () => ["clinic"] },
    });
    assert.equal((await generator.generateSourceCommissionAccruals({ organizationId: "org", clinicIds: ["clinic"], actorId: null })).created, 1);
    assert.equal(created[0].receiptId, "R1000");
    assert.equal(created[0].commissionAmount, 10000);
  });
}
