import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  await assertInvoiceBalances();
  await assertNoOrphanReceiptAllocations();
  await assertVoidInvoiceAllocationsReleased();
  await assertJourneyServiceInvoiceCaps();
  await assertReceiptAllocationMath();
  await assertLedgerDatabaseGuards();
  await prisma.$disconnect();
  console.log("ok billing edge smoke");
}

async function assertLedgerDatabaseGuards() {
  const requiredConstraints = [
    "Invoice_amount_nonnegative_check",
    "Invoice_paidAmount_range_check",
    "Payment_amount_nonzero_check",
    "InvoiceItem_money_check",
    "Receipt_amounts_check",
    "ReceiptAllocation_amount_positive_check",
    "PatientCreditBalance_amount_nonnegative_check",
  ];
  const requiredTriggers = [
    "Invoice_owner_scope_check",
    "InvoiceItem_owner_scope_check",
    "InvoiceItem_relation_scope_check",
    "Receipt_owner_scope_check",
    "ReceiptAllocation_relation_scope_check",
    "PatientCreditBalance_owner_scope_check",
  ];
  const constraints = await prisma.$queryRaw`
    SELECT conname
    FROM pg_constraint
    WHERE conname = ANY(${requiredConstraints})
  `;
  const triggers = await prisma.$queryRaw`
    SELECT tgname
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname = ANY(${requiredTriggers})
  `;
  const installedConstraints = new Set(constraints.map((row) => row.conname));
  const installedTriggers = new Set(triggers.map((row) => row.tgname));

  for (const name of requiredConstraints) {
    if (!installedConstraints.has(name)) {
      throw new Error(`Missing billing database constraint ${name}.`);
    }
  }

  for (const name of requiredTriggers) {
    if (!installedTriggers.has(name)) {
      throw new Error(`Missing billing scope trigger ${name}.`);
    }
  }
}

async function assertInvoiceBalances() {
  const invoices = await prisma.invoice.findMany({
    select: {
      invoiceNo: true,
      amount: true,
      paidAmount: true,
    },
    take: 1000,
  });
  const badInvoice = invoices.find(
    (invoice) => Number(invoice.paidAmount) > Number(invoice.amount) + 0.01,
  );

  if (badInvoice) {
    throw new Error(
      `Invoice ${badInvoice.invoiceNo} has paidAmount ${badInvoice.paidAmount} > amount ${badInvoice.amount}.`,
    );
  }
}

async function assertNoOrphanReceiptAllocations() {
  const orphan = await prisma.receiptAllocation.findFirst({
    where: {
      invoiceId: null,
      treatmentServiceId: null,
    },
    include: {
      receipt: {
        select: {
          receiptNo: true,
        },
      },
    },
  });

  if (orphan) {
    throw new Error(
      `Receipt allocation ${orphan.id} from receipt ${orphan.receipt.receiptNo} is not linked to an invoice or service.`,
    );
  }
}

async function assertVoidInvoiceAllocationsReleased() {
  const linkedVoidAllocation = await prisma.receiptAllocation.findFirst({
    where: {
      invoice: {
        status: "VOID",
      },
    },
    include: {
      invoice: {
        select: {
          invoiceNo: true,
        },
      },
    },
  });

  if (linkedVoidAllocation) {
    throw new Error(
      `Void invoice ${linkedVoidAllocation.invoice?.invoiceNo} still has linked receipt allocation ${linkedVoidAllocation.id}.`,
    );
  }
}

async function assertJourneyServiceInvoiceCaps() {
  const services = await prisma.treatmentService.findMany({
    include: {
      invoiceItems: {
        where: {
          invoice: {
            status: {
              not: "VOID",
            },
          },
        },
        select: {
          amount: true,
        },
      },
      receiptAllocations: {
        select: {
          amount: true,
        },
      },
    },
    take: 500,
  });

  for (const service of services) {
    const finalPrice = Number(service.finalPrice);
    const invoiced = sum(service.invoiceItems.map((item) => Number(item.amount)));
    const allocated = sum(service.receiptAllocations.map((allocation) => Number(allocation.amount)));

    if (invoiced > finalPrice + 0.01) {
      throw new Error(`Treatment service ${service.serviceCode} invoiced ${invoiced} > finalPrice ${finalPrice}.`);
    }

    if (Math.min(allocated, finalPrice) > finalPrice + 0.01) {
      throw new Error(`Treatment service ${service.serviceCode} allocation cap exceeded.`);
    }
  }
}

async function assertReceiptAllocationMath() {
  const receipts = await prisma.receipt.findMany({
    include: {
      allocations: {
        select: {
          amount: true,
        },
      },
    },
    take: 500,
  });

  for (const receipt of receipts) {
    const amount = Number(receipt.amount);
    const allocatedAmount = Number(receipt.allocatedAmount);
    const unallocatedAmount = Number(receipt.unallocatedAmount);
    const allocationSum = sum(receipt.allocations.map((allocation) => Number(allocation.amount)));

    if (allocatedAmount > amount + 0.01) {
      throw new Error(`Receipt ${receipt.receiptNo} allocatedAmount exceeds amount.`);
    }

    if (Math.abs(allocationSum - allocatedAmount) > 0.01) {
      throw new Error(`Receipt ${receipt.receiptNo} allocation rows do not match allocatedAmount.`);
    }

    if (Math.abs(amount - allocatedAmount - unallocatedAmount) > 0.01) {
      throw new Error(`Receipt ${receipt.receiptNo} amount != allocated + unallocated.`);
    }
  }
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => {});
  console.error(error);
  process.exit(1);
});
