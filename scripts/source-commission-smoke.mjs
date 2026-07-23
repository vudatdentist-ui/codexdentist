import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

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
        },
      },
    },
    take: 1000,
  });

  for (const accrual of accruals) {
    if (accrual.source !== accrual.policy.source || accrual.source !== accrual.patient.leadSource) {
      throw new Error(`Accrual ${accrual.id} source mismatch.`);
    }

    const baseAmount = Number(accrual.baseAmount);
    const receiptBase = Number(accrual.receipt.allocatedAmount || accrual.receipt.amount);
    const expected = Math.max(
      Math.round((baseAmount * Number(accrual.ratePercent)) / 100 + Number(accrual.fixedAmount)),
      0,
    );

    if (Math.abs(baseAmount - receiptBase) > 0.01) {
      throw new Error(`Accrual ${accrual.id} base amount does not match receipt.`);
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
