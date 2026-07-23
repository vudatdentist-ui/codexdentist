import fs from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);

  if (match) {
    process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
  }
}

const write = process.argv.includes("--write");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const formatMoney = (value) => new Intl.NumberFormat("vi-VN").format(Number(value));

try {
  const invoicesWithoutItems = await prisma.invoice.findMany({
    where: {
      items: {
        none: {},
      },
    },
    include: {
      patient: {
        select: {
          organizationId: true,
          fullName: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });
  const serviceInvoiceItems = await prisma.invoiceItem.findMany({
    where: {
      treatmentServiceId: {
        not: null,
      },
    },
    include: {
      invoice: {
        select: {
          invoiceNo: true,
          status: true,
        },
      },
      treatmentService: {
        select: {
          serviceCode: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  console.log(
    JSON.stringify(
      {
        mode: write ? "write" : "dry-run",
        invoicesWithoutItems: invoicesWithoutItems.map((invoice) => ({
          invoiceNo: invoice.invoiceNo,
          patient: invoice.patient.fullName,
          amount: formatMoney(invoice.amount),
          paidAmount: formatMoney(invoice.paidAmount),
          status: invoice.status,
        })),
        serviceLinkedInvoiceItems: serviceInvoiceItems.map((item) => ({
          invoiceNo: item.invoice.invoiceNo,
          serviceCode: item.treatmentService?.serviceCode ?? item.treatmentServiceId,
          amount: formatMoney(item.amount),
          status: item.invoice.status,
        })),
      },
      null,
      2,
    ),
  );

  if (!write || invoicesWithoutItems.length === 0) {
    process.exit(0);
  }

  await prisma.$transaction(
    invoicesWithoutItems.map((invoice) =>
      prisma.invoiceItem.create({
        data: {
          organizationId: invoice.patient.organizationId,
          clinicId: invoice.clinicId,
          patientId: invoice.patientId,
          invoiceId: invoice.id,
          treatmentServiceId: null,
          description: "Manual patient invoice",
          quantity: 1,
          unitPrice: invoice.amount,
          amount: invoice.amount,
        },
      }),
    ),
  );

  console.log(`Backfilled ${invoicesWithoutItems.length} invoice item(s).`);
} finally {
  await prisma.$disconnect();
}
