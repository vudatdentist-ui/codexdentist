import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const ownerEmail = process.env.BILLING_CONCURRENCY_OWNER_EMAIL ?? "owner@nhavista.vn";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run billing concurrency smoke against production.");
  }

  const fixture = await createFixture();

  try {
    await Promise.all([
      applyPayment(fixture, fixture.amount),
      applyPayment(fixture, fixture.amount),
    ]);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: {
        id: fixture.invoiceId,
      },
      include: {
        payments: true,
        receiptAllocations: true,
      },
    });
    const receipts = await prisma.receipt.findMany({
      where: {
        patientId: fixture.patientId,
        reference: fixture.invoiceNo,
      },
    });
    const paymentSum = sum(invoice.payments.map((payment) => Number(payment.amount)));
    const allocationSum = sum(
      invoice.receiptAllocations.map((allocation) => Number(allocation.amount)),
    );
    const receiptAmount = sum(receipts.map((receipt) => Number(receipt.amount)));
    const allocatedAmount = sum(
      receipts.map((receipt) => Number(receipt.allocatedAmount)),
    );
    const unallocatedAmount = sum(
      receipts.map((receipt) => Number(receipt.unallocatedAmount)),
    );

    assert(Number(invoice.paidAmount) === fixture.amount, "Invoice paid amount exceeded its cap.");
    assert(paymentSum === fixture.amount, "Concurrent requests created duplicate invoice payments.");
    assert(allocationSum === fixture.amount, "Concurrent requests over-allocated the invoice.");
    assert(receiptAmount === fixture.amount * 2, "Both real receipts were not preserved.");
    assert(allocatedAmount === fixture.amount, "Receipt allocation total is incorrect.");
    assert(unallocatedAmount === fixture.amount, "Overpayment was not moved to patient credit.");
    console.log("ok billing concurrency serialization");
  } finally {
    await cleanupFixture(fixture);
  }
}

async function applyPayment(fixture, amount) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const invoice = await tx.invoice.findUniqueOrThrow({
            where: {
              id: fixture.invoiceId,
            },
          });
          const balance = Math.max(
            Number(invoice.amount) - Number(invoice.paidAmount),
            0,
          );
          const allocatedAmount = Math.min(amount, balance);
          const unallocatedAmount = amount - allocatedAmount;
          const receipt = await tx.receipt.create({
            data: {
              organizationId: fixture.organizationId,
              clinicId: fixture.clinicId,
              patientId: fixture.patientId,
              receiptNo: `QA-RCT-${randomUUID()}`,
              amount,
              allocatedAmount,
              unallocatedAmount,
              method: "cash",
              reference: fixture.invoiceNo,
            },
          });

          if (allocatedAmount > 0) {
            await tx.payment.create({
              data: {
                invoiceId: fixture.invoiceId,
                amount: allocatedAmount,
                method: "cash",
                reference: receipt.receiptNo,
              },
            });
            await tx.receiptAllocation.create({
              data: {
                organizationId: fixture.organizationId,
                clinicId: fixture.clinicId,
                patientId: fixture.patientId,
                receiptId: receipt.id,
                invoiceId: fixture.invoiceId,
                amount: allocatedAmount,
              },
            });
          }

          if (unallocatedAmount > 0) {
            await tx.patientCreditBalance.upsert({
              where: {
                patientId: fixture.patientId,
              },
              update: {
                amount: {
                  increment: unallocatedAmount,
                },
              },
              create: {
                organizationId: fixture.organizationId,
                clinicId: fixture.clinicId,
                patientId: fixture.patientId,
                amount: unallocatedAmount,
              },
            });
          }

          const nextPaid = Math.min(
            Number(invoice.paidAmount) + allocatedAmount,
            Number(invoice.amount),
          );
          await tx.invoice.update({
            where: {
              id: fixture.invoiceId,
            },
            data: {
              paidAmount: nextPaid,
              status: nextPaid >= Number(invoice.amount) ? "PAID" : "PARTIAL",
            },
          });
        },
        {
          isolationLevel: "Serializable",
        },
      );
      return;
    } catch (error) {
      if (error?.code !== "P2034" || attempt === 3) {
        throw error;
      }
    }
  }
}

async function createFixture() {
  const suffix = randomUUID();
  const owner = await prisma.user.findUniqueOrThrow({
    where: {
      email: ownerEmail,
    },
    select: {
      organizationId: true,
      clinics: {
        take: 1,
        select: {
          clinicId: true,
        },
      },
    },
  });
  const clinicId = owner.clinics[0]?.clinicId;

  if (!clinicId) {
    throw new Error("Billing concurrency owner has no clinic.");
  }

  const patient = await prisma.patient.create({
    data: {
      organizationId: owner.organizationId,
      clinicId,
      fullName: "QA Concurrent Billing",
      phone: `billing-concurrency-${suffix}`,
    },
  });
  const invoiceNo = `QA-CONCURRENT-${suffix}`;
  const amount = 100000;
  const invoice = await prisma.invoice.create({
    data: {
      organizationId: owner.organizationId,
      clinicId,
      patientId: patient.id,
      invoiceNo,
      status: "OPEN",
      amount,
      paidAmount: 0,
      dueDate: new Date(Date.now() + 86400000),
    },
  });

  await prisma.invoiceItem.create({
    data: {
      organizationId: owner.organizationId,
      clinicId,
      patientId: patient.id,
      invoiceId: invoice.id,
      description: "QA concurrency invoice",
      quantity: 1,
      unitPrice: amount,
      amount,
    },
  });

  return {
    amount,
    clinicId,
    invoiceId: invoice.id,
    invoiceNo,
    organizationId: owner.organizationId,
    patientId: patient.id,
  };
}

async function cleanupFixture(fixture) {
  const receipts = await prisma.receipt.findMany({
    where: {
      patientId: fixture.patientId,
    },
    select: {
      id: true,
    },
  });
  const receiptIds = receipts.map((receipt) => receipt.id);

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        {
          entityType: "Receipt",
          entityId: {
            in: receiptIds,
          },
        },
        {
          entityType: "Invoice",
          entityId: fixture.invoiceId,
        },
      ],
    },
  });
  await prisma.receiptAllocation.deleteMany({
    where: {
      patientId: fixture.patientId,
    },
  });
  await prisma.payment.deleteMany({
    where: {
      invoiceId: fixture.invoiceId,
    },
  });
  await prisma.receipt.deleteMany({
    where: {
      patientId: fixture.patientId,
    },
  });
  await prisma.invoiceItem.deleteMany({
    where: {
      invoiceId: fixture.invoiceId,
    },
  });
  await prisma.invoice.delete({
    where: {
      id: fixture.invoiceId,
    },
  });
  await prisma.patientCreditBalance.deleteMany({
    where: {
      patientId: fixture.patientId,
    },
  });
  await prisma.patient.delete({
    where: {
      id: fixture.patientId,
    },
  });
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
