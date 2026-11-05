// NODE_ENV=test FINANCIAL_LEDGER_DISPOSABLE=1 DATABASE_URL=<isolated loopback DB>
// Optional COMMISSION_ORDER_SOURCE_ROOT selects another checkout's actual source/gate.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== "test" || process.env.FINANCIAL_LEDGER_DISPOSABLE !== "1" || !url ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !/^\/financial_ledger_test(?:_[a-z0-9]+)?$/.test(url.pathname) ||
    [...url.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service)$/i.test(key))) {
  throw new Error("Requires an explicitly disposable financial_ledger_test database on loopback.");
}
const sourceRoot = path.resolve(process.env.COMMISSION_ORDER_SOURCE_ROOT || path.join(__dirname, ".."));
const { load } = require(path.join(sourceRoot, "scripts/audit-source-loader.cjs"));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
let waiting = null;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 15000);
    })]);
  } finally { clearTimeout(timer); }
}
// Preserve the real Serializable/retry helper. Only delay one transaction's
// callback AFTER Prisma has begun it and BEFORE any query establishes a snapshot.
const controlledPrisma = new Proxy(prisma, {
  get(target, key) {
    if (key === "$transaction") return (operation, options) => prisma.$transaction(async tx => {
      const barrier = waiting;
      if (barrier) {
        waiting = null;
        barrier.entered.resolve();
        await within(barrier.release.promise, "release transaction before first read");
        // Read the DB transaction clock only AFTER the other command commits.
        // Prisma may supply model createdAt values itself; those are not a BEGIN probe.
        [barrier.clock] = await tx.$queryRaw`SELECT transaction_timestamp() AS began, clock_timestamp() AS resumed`;
      }
      return operation(tx);
    }, { ...options, timeout: 25000, maxWait: 10000 });
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const permissions = load("src/lib/permissions.ts");
const mocks = {
  "@/lib/prisma": { prisma: controlledPrisma }, "@/lib/permissions": permissions,
  "@/lib/tenant-scope": load("src/lib/tenant-scope.ts", { "@/lib/permissions": permissions }),
  "@/lib/actions/permissions": load("src/lib/actions/permissions.ts", { "@/lib/permissions": permissions }),
  "@/lib/form-validation": load("src/lib/form-validation.ts"),
  "@/lib/transaction": load("src/lib/transaction.ts", { "@/lib/prisma": { prisma: controlledPrisma } }),
  "@/lib/document-sequence": {}, "@/lib/notification-templates": {},
};
const revenue = load("src/lib/application/revenue/commands.ts", mocks);
const commissions = load("src/lib/source-commission.ts", mocks);
let org, clinic, user, session;

async function fixture(label) {
  const source = `ORDER-${label}-${randomUUID()}`;
  const patient = await prisma.patient.create({ data: { organizationId: org.id, clinicId: clinic.id,
    fullName: "Synthetic ordering fixture", phone: label === "void-starts-first" ? "0000000001" : "0000000002",
    medicalAlerts: [], leadSource: source } });
  await prisma.sourceCommissionPolicy.create({ data: { organizationId: org.id, source,
    name: "Synthetic ordering policy", ratePercent: 10, fixedAmount: 0 } });
  const invoices = [];
  for (const suffix of ["A", "B"]) invoices.push(await prisma.invoice.create({ data: {
    organizationId: org.id, clinicId: clinic.id, patientId: patient.id, invoiceNo: `${label}-${suffix}`,
    amount: 100000, paidAmount: 100000, status: "PAID", dueDate: new Date(),
    items: { create: { organizationId: org.id, clinicId: clinic.id, patientId: patient.id,
      description: "Synthetic", quantity: 1, unitPrice: 100000, amount: 100000 } },
  } }));
  const receipt = await prisma.receipt.create({ data: { organizationId: org.id, clinicId: clinic.id,
    patientId: patient.id, receiptNo: `ORDER-${label}`, amount: 200000,
    allocatedAmount: 200000, unallocatedAmount: 0, method: "cash" } });
  for (const invoice of invoices) {
    await prisma.payment.create({ data: { invoiceId: invoice.id, amount: 100000, method: "cash", reference: receipt.receiptNo } });
    await prisma.receiptAllocation.create({ data: { organizationId: org.id, clinicId: clinic.id,
      patientId: patient.id, invoiceId: invoice.id, receiptId: receipt.id, amount: 100000 } });
  }
  return { patient, invoices, receipt };
}
function generate() {
  return commissions.generateSourceCommissionAccruals({ organizationId: org.id, clinicIds: [clinic.id], actorId: user.id });
}
async function assertState(f, expectedBase) {
  const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: f.receipt.id }, include: { allocations: true } });
  assert.equal(receipt.amount.toString(), "200000");
  assert.equal(receipt.allocatedAmount.toString(), "100000");
  assert.equal(receipt.unallocatedAmount.toString(), "100000");
  assert.equal(receipt.allocations.length, 1);
  assert.equal(receipt.allocations[0].invoiceId, f.invoices[1].id);
  assert.equal(receipt.allocations[0].amount.toString(), "100000");
  const credit = await prisma.patientCreditBalance.findUniqueOrThrow({ where: { patientId: f.patient.id } });
  assert.equal(credit.amount.toString(), "100000");
  const accruals = await prisma.sourceCommissionAccrual.findMany({ where: { receiptId: receipt.id } });
  assert.equal(accruals.length, 1);
  assert.equal(Number(accruals[0].baseAmount), expectedBase);
  assert.equal(Number(accruals[0].commissionAmount), expectedBase / 10);
  for (const [index, row] of f.invoices.entries()) {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: row.id }, include: { payments: true } });
    assert.equal(Number(invoice.paidAmount), index ? 100000 : 0);
    assert.equal(invoice.status, index ? "PAID" : "VOID");
    assert.equal(invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0), Number(invoice.paidAmount));
    assert.equal(invoice.payments.filter(payment => payment.method === "void_reversal").length, index ? 0 : 1);
  }
  const proofs = await prisma.auditLog.findMany({ where: { organizationId: org.id,
    action: "invoice.voided", entityId: f.invoices[0].id } });
  assert.equal(proofs.length, 1);
  return { accrual: accruals[0], proof: proofs[0] };
}
function assertGate() {
  const gate = spawnSync(process.execPath, [path.join(sourceRoot, "scripts/source-commission-smoke.mjs")], {
    cwd: sourceRoot, env: process.env, encoding: "utf8", windowsHide: true, timeout: 30000,
  });
  assert.ifError(gate.error);
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
}
async function ordering(voidStartsFirst) {
  const label = voidStartsFirst ? "void-starts-first" : "generation-starts-first";
  const f = await fixture(label);
  const barrier = { entered: deferred(), release: deferred() };
  waiting = barrier;
  const voidInvoice = () => revenue.voidInvoiceCommand(session, f.invoices[0].invoiceNo);
  const held = voidStartsFirst ? voidInvoice() : generate();
  // Observe rejection even if the transaction fails before reaching its barrier.
  held.catch(() => {});
  try {
    await within(Promise.race([barrier.entered.promise, held.then(() => {
      throw new Error("Transaction completed without entering the barrier.");
    })]), "transaction callback entered");
    // Separate millisecond-resolution DB timestamps; the barrier orders commits.
    await new Promise(resolve => setTimeout(resolve, 25));
    if (voidStartsFirst) assert.equal((await generate()).created, 1);
    else await voidInvoice();
    [barrier.committed] = await prisma.$queryRaw`SELECT clock_timestamp() AS at`;
  } finally {
    barrier.release.resolve();
    await held;
  }
  const expectedBase = voidStartsFirst ? 200000 : 100000;
  await assertState(f, expectedBase);
  assert.ok(barrier.clock.began < barrier.committed.at,
    "Held transaction must begin before the other command commits.");
  assert.ok(barrier.clock.resumed >= barrier.committed.at,
    "Held transaction's first read must follow the other command's commit.");
  assertGate();
  assert.equal((await generate()).created, 0);
  await voidInvoice();
  await assertState(f, expectedBase);
  assertGate();
  console.log(`ok ${label}: delayed first read, shared receipt conserved, basis ${expectedBase}, gate and replays`);
}
async function main() {
  org = await prisma.organization.create({ data: { name: `Commission order ${randomUUID()}` } });
  clinic = await prisma.clinic.create({ data: { organizationId: org.id, name: "Synthetic ordering", city: "Test", address: "Test" } });
  user = await prisma.user.create({ data: { organizationId: org.id, email: `commission-order-${randomUUID()}@example.test`,
    fullName: "Synthetic staff", passwordHash: "unusable-synthetic", role: "OWNER" } });
  session = { userId: user.id, organizationId: org.id, role: "OWNER", roles: ["OWNER"],
    roleAssignments: [{ role: "OWNER", organizationId: org.id, clinicId: null }],
    clinicIds: [clinic.id], activeClinicId: null };
  await ordering(true);
  await ordering(false);
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
  await prisma.patient.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.clinic.deleteMany({ where });
  await prisma.organization.delete({ where: { id: org.id } });
}
main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { try { await cleanup(); } finally { await prisma.$disconnect(); } });
