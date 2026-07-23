import { pbkdf2Sync, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to write pilot smoke data in production.");
  }

  const now = new Date();
  const runKey = String(Date.now());
  const { organization, clinic, provider } = await ensurePilotFixture();
  const patient = await prisma.patient.create({
    data: {
      organizationId: organization.id,
      clinicId: clinic.id,
      fullName: `Pilot Workflow ${runKey}`,
      phone: `09${runKey.slice(-8)}`,
      email: `pilot-${runKey}@example.test`,
      leadSource: "WALK_IN",
      visitReason: "Pilot workflow smoke",
      medicalAlerts: [],
    },
    select: { id: true },
  });

  const appointment = await prisma.appointment.create({
    data: {
      clinicId: clinic.id,
      patientId: patient.id,
      providerId: provider.id,
      chairId: clinic.chairId,
      status: "CONFIRMED",
      startsAt: new Date(now.getTime() + 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + 90 * 60 * 1000),
      reason: "Pilot workflow appointment",
      source: "pilot-smoke",
    },
    select: { id: true },
  });

  const clinicalNote = await prisma.clinicalNote.create({
    data: {
      patientId: patient.id,
      authorId: provider.id,
      subjective: "Pilot subjective",
      objective: "Pilot objective",
      assessment: "Pilot assessment",
      plan: "Pilot plan",
      lockedAt: now,
    },
    select: { id: true, lockedAt: true },
  });

  const service = await prisma.treatmentService.create({
    data: {
      organizationId: organization.id,
      clinicId: clinic.id,
      patientId: patient.id,
      serviceCatalogItemId: clinic.serviceId,
      createdById: provider.id,
      serviceCode: `SMK-SVC-${runKey}`,
      serviceName: "Pilot smoke service",
      targetSummary: "R11",
      teeth: ["R11"],
      status: "IN_PROGRESS",
      finalPrice: 1200000,
      currentProgressPercent: 50,
    },
    select: { id: true, finalPrice: true },
  });

  await prisma.treatmentServiceProgressEvent.create({
    data: {
      organizationId: organization.id,
      clinicId: clinic.id,
      treatmentServiceId: service.id,
      performedById: provider.id,
      fromProgressPercent: 0,
      toProgressPercent: 50,
      progressDeltaPercent: 50,
      note: "Pilot progress smoke",
    },
  });

  const invoice = await prisma.invoice.create({
    data: {
      organizationId: organization.id,
      clinicId: clinic.id,
      patientId: patient.id,
      invoiceNo: `SMK-INV-${runKey}`,
      status: "PAID",
      amount: 600000,
      paidAmount: 600000,
      dueDate: now,
      items: {
        create: {
          organizationId: organization.id,
          clinicId: clinic.id,
          patientId: patient.id,
          treatmentServiceId: service.id,
          description: "Pilot smoke service partial invoice",
          quantity: 1,
          unitPrice: 600000,
          amount: 600000,
        },
      },
      payments: {
        create: {
          amount: 600000,
          method: "cash",
          paidAt: now,
        },
      },
    },
    include: {
      items: {
        select: { id: true },
        take: 1,
      },
    },
  });

  const receipt = await prisma.receipt.create({
    data: {
      organizationId: organization.id,
      clinicId: clinic.id,
      patientId: patient.id,
      receiptNo: `SMK-RCT-${runKey}`,
      amount: 1000000,
      allocatedAmount: 600000,
      unallocatedAmount: 400000,
      method: "cash",
      receivedAt: now,
      allocations: {
        create: {
          organizationId: organization.id,
          clinicId: clinic.id,
          patientId: patient.id,
          invoiceId: invoice.id,
          invoiceItemId: invoice.items[0]?.id,
          treatmentServiceId: service.id,
          amount: 600000,
          note: "Pilot allocation smoke",
        },
      },
    },
    include: {
      allocations: true,
    },
  });

  await prisma.patientCreditBalance.upsert({
    where: { patientId: patient.id },
    create: {
      organizationId: organization.id,
      clinicId: clinic.id,
      patientId: patient.id,
      amount: 400000,
    },
    update: {
      amount: 400000,
    },
  });

  assert(appointment.id, "appointment was not created");
  assert(clinicalNote.lockedAt, "clinical note was not locked");
  assert(receipt.allocations.length === 1, "receipt allocation was not created");
  assert(Number(receipt.amount) === Number(receipt.allocatedAmount) + Number(receipt.unallocatedAmount), "receipt math is inconsistent");
  assert(Number(invoice.paidAmount) <= Number(invoice.amount), "invoice paid amount exceeds amount");
  assert(Number(service.finalPrice) === 1200000, "service final price changed unexpectedly");

  console.log("ok pilot workflow smoke");
}

async function ensurePilotFixture() {
  let organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!organization) {
    organization = await prisma.organization.create({
      data: {
        name: "Pilot Smoke Organization",
        slug: `pilot-smoke-${Date.now()}`,
        locale: "vi-VN",
      },
      select: { id: true },
    });
  }

  let clinic = await prisma.clinic.findFirst({
    where: {
      organizationId: organization.id,
      active: true,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!clinic) {
    clinic = await prisma.clinic.create({
      data: {
        organizationId: organization.id,
        name: "Pilot Smoke Clinic",
        city: "Ho Chi Minh City",
        address: "Pilot smoke address",
        phone: "0900000000",
      },
      select: { id: true },
    });
  }

  let chair = await prisma.chair.findFirst({
    where: {
      clinicId: clinic.id,
      active: true,
    },
    select: { id: true },
  });

  if (!chair) {
    chair = await prisma.chair.create({
      data: {
        clinicId: clinic.id,
        name: "Pilot Smoke Chair",
        active: true,
      },
      select: { id: true },
    });
  }

  let provider = await prisma.user.findFirst({
    where: {
      organizationId: organization.id,
      active: true,
      role: { in: ["OWNER", "DENTIST"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!provider) {
    provider = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: `pilot-provider-${Date.now()}@example.test`,
        fullName: "Pilot Smoke Provider",
        passwordHash: hashPassword("CodexSmoke2026!"),
        role: "DENTIST",
        active: true,
        mustChangePassword: false,
        clinics: {
          create: {
            clinicId: clinic.id,
          },
        },
      },
      select: { id: true },
    });
  }

  await prisma.userClinic.upsert({
    where: {
      userId_clinicId: {
        userId: provider.id,
        clinicId: clinic.id,
      },
    },
    update: {},
    create: {
      userId: provider.id,
      clinicId: clinic.id,
    },
  });

  const category = await prisma.serviceCategory.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: "PILOT",
      },
    },
    update: { active: true },
    create: {
      organizationId: organization.id,
      code: "PILOT",
      name: "Pilot smoke",
      active: true,
    },
    select: { id: true },
  });

  const service = await prisma.serviceCatalogItem.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: "PILOT-SMOKE",
      },
    },
    update: {
      status: "ACTIVE",
      defaultPrice: 1200000,
    },
    create: {
      organizationId: organization.id,
      categoryId: category.id,
      code: "PILOT-SMOKE",
      name: "Pilot smoke service",
      status: "ACTIVE",
      defaultPrice: 1200000,
      defaultDurationMinutes: 30,
      targetMode: "TOOTH",
    },
    select: { id: true },
  });

  return {
    organization,
    clinic: {
      id: clinic.id,
      chairId: chair.id,
      serviceId: service.id,
    },
    provider,
  };
}

function hashPassword(value, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(value, salt, 310000, 32, "sha256").toString("hex");

  return `pbkdf2_sha256$310000$${salt}$${hash}`;
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
