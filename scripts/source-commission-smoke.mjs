import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createRequire } from "node:module";
const { load } = createRequire(import.meta.url)("./audit-source-loader.cjs");
const { loadReceiptRefundLedger, moneyCents, receiptCommission } = load("src/lib/application/revenue/refund-ledger.ts");
const { loadReceiptVoidReleases } = load("src/lib/application/revenue/void-ledger.ts");

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const policies = await prisma.sourceCommissionPolicy.findMany();
  const duplicateKeys = new Set();

  for (const policy of policies) {
    const key = `${policy.organizationId}:${policy.source}`;
    if (duplicateKeys.has(key)) {
      throw new Error(`Duplicate source policy ${key}.`);
    }
    duplicateKeys.add(key);

    if (Number(policy.ratePercent) < 0 || Number(policy.fixedAmount) < 0) {
      throw new Error(`Negative source policy value for ${policy.source}.`);
    }
  }

  const accruals = await prisma.sourceCommissionAccrual.findMany({
    include: {
      policy: true,
      patient: {
        select: {
          leadSource: true,
        },
      },
      receipt: {
        select: {
          allocatedAmount: true,
          amount: true,
          allocations: { select: { invoiceId: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const refundsByOrganization = new Map();
  const voidsByOrganization = new Map();
  for (const organizationId of new Set(accruals.map((accrual) => accrual.organizationId))) {
    const group = accruals.filter((accrual) => accrual.organizationId === organizationId);
    refundsByOrganization.set(organizationId, await prisma.$transaction((tx) => loadReceiptRefundLedger(
      tx, organizationId, [...new Set(group.map((accrual) => accrual.receiptId))],
      group.flatMap((accrual) => accrual.receipt.allocations.flatMap((row) => row.invoiceId ? [row.invoiceId] : [])),
    )));
    voidsByOrganization.set(organizationId, await prisma.$transaction(tx => loadReceiptVoidReleases(
      tx, organizationId, [...new Set(group.map(accrual => accrual.receiptId))],
    )));
  }

  for (const accrual of accruals) {
    if (accrual.source !== accrual.policy.source || accrual.source !== accrual.patient.leadSource) {
      throw new Error(`Accrual ${accrual.id} source mismatch.`);
    }

    const baseAmount = Number(accrual.baseAmount);
    const refunds = refundsByOrganization.get(accrual.organizationId);
    const refundedCents = refunds.byReceipt.get(accrual.receiptId) ?? 0;
    const originalBasis = refunds.grossBases.get(accrual.receiptId);
    const expected = receiptCommission(baseAmount, Number(accrual.ratePercent), Number(accrual.fixedAmount));

    if (moneyCents(baseAmount) < 0 || moneyCents(baseAmount) > moneyCents(accrual.receipt.amount) - refundedCents ||
        (originalBasis !== undefined && moneyCents(baseAmount) !== originalBasis - refundedCents)) {
      throw new Error(`Accrual ${accrual.id} base amount does not reconcile with retained receipt collection.`);
    }
    // A timestamp is not evidence. Only a durable payment-backed release after
    // accrual can explain why retained earned cash exceeds today's allocation.
    const releasedAfterAccrual = (voidsByOrganization.get(accrual.organizationId).get(accrual.receiptId) ?? [])
      .filter(release => release.createdAt >= accrual.createdAt).reduce((sum, release) => sum + release.amount, 0);
    if (originalBasis === undefined &&
        moneyCents(baseAmount) !== moneyCents(accrual.receipt.allocatedAmount) + releasedAfterAccrual) {
      throw new Error(`Accrual ${accrual.id} original eligible basis does not match receipt allocation.`);
    }

    if (Math.abs(Number(accrual.commissionAmount) - expected) > 0.01) {
      throw new Error(`Accrual ${accrual.id} commission math mismatch.`);
    }
  }

  await prisma.$disconnect();
  console.log("ok source commission smoke");
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => {});
  console.error(error);
  process.exit(1);
});
