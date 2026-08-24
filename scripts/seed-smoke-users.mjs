import { pbkdf2Sync, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const password = process.env.SMOKE_USER_PASSWORD ?? "CodexSmoke2026!";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const users = [
  ["owner@nhavista.vn", "Smoke Owner", "OWNER"],
  ["area@nhavista.vn", "Smoke Area Manager", "AREA_MANAGER"],
  ["manager@nhavista.vn", "Smoke Clinic Manager", "CLINIC_MANAGER"],
  ["frontdesk@nhavista.vn", "Smoke Front Desk", "FRONT_DESK"],
  ["dentist@nhavista.vn", "Smoke Dentist", "DENTIST"],
  ["hygienist@nhavista.vn", "Smoke Hygienist", "HYGIENIST"],
  ["billing@nhavista.vn", "Smoke Billing", "BILLING"],
  ["patient@nhavista.vn", "Smoke Patient", "PATIENT"],
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed smoke users in production.");
  }

  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!organization) {
    throw new Error("No organization found.");
  }

  let clinics = await prisma.clinic.findMany({
    where: { organizationId: organization.id, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (clinics.length === 0) {
    const clinic = await prisma.clinic.create({
      data: {
        organizationId: organization.id,
        name: "Smoke Clinic",
        city: "Ho Chi Minh City",
        address: "Smoke test address",
        phone: "0900000000",
        chairs: {
          create: [
            {
              name: "Ghế 1",
              active: true,
            },
          ],
        },
      },
      select: { id: true },
    });
    clinics = [clinic];
  }

  const passwordHash = hashPassword(password);
  let patientPortalUserId = "";

  for (const [email, fullName, role] of users) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        fullName,
        passwordHash,
        role,
        active: true,
        mustChangePassword: false,
      },
      create: {
        organizationId: organization.id,
        email,
        fullName,
        passwordHash,
        role,
        active: true,
        mustChangePassword: false,
      },
      select: { id: true, role: true },
    });

    const membershipClinicIds =
      user.role === "OWNER" || user.role === "AREA_MANAGER"
        ? clinics.map((clinic) => clinic.id)
        : [clinics[0].id];

    for (const clinicId of membershipClinicIds) {
      await prisma.userClinic.upsert({
        where: { userId_clinicId: { userId: user.id, clinicId } },
        update: {},
        create: { userId: user.id, clinicId },
      });
    }

    const roleClinicId =
      user.role === "OWNER" || user.role === "AREA_MANAGER" ? null : clinics[0].id;
    const scopeKey = roleClinicId ?? "GLOBAL";

    await prisma.userRoleAssignment.upsert({
      where: {
        userId_role_scopeKey: {
          userId: user.id,
          role: user.role,
          scopeKey,
        },
      },
      update: {
        organizationId: organization.id,
        clinicId: roleClinicId,
        active: true,
      },
      create: {
        organizationId: organization.id,
        userId: user.id,
        role: user.role,
        clinicId: roleClinicId,
        scopeKey,
        active: true,
      },
    });

    if (user.role === "PATIENT") {
      patientPortalUserId = user.id;
    }
  }

  const linkedPatient = patientPortalUserId
    ? await prisma.patient.findUnique({
        where: {
          portalUserId: patientPortalUserId,
        },
        select: {
          id: true,
        },
      })
    : null;

  if (linkedPatient) {
    await prisma.patient.update({
      where: {
        id: linkedPatient.id,
      },
      data: {
        email: "patient@nhavista.vn",
        portalUserId: patientPortalUserId,
      },
    });
  } else {
    await prisma.patient.upsert({
      where: {
        organizationId_phone: {
          organizationId: organization.id,
          phone: "0900000000",
        },
      },
      update: {
        clinicId: clinics[0].id,
        fullName: "Smoke Patient",
        email: "patient@nhavista.vn",
        portalUserId: patientPortalUserId || null,
      },
      create: {
        organizationId: organization.id,
        clinicId: clinics[0].id,
        fullName: "Smoke Patient",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        phone: "0900000000",
        email: "patient@nhavista.vn",
        portalUserId: patientPortalUserId || null,
      },
    });
  }

  await seedTreatmentCase(organization.id, clinics[0].id);

  console.log(`Seeded ${users.length} smoke users with password from SMOKE_USER_PASSWORD.`);
}

async function seedTreatmentCase(organizationId, clinicId) {
  const [owner, patient] = await Promise.all([
    prisma.user.findUnique({
      where: { email: "owner@nhavista.vn" },
      select: { id: true },
    }),
    prisma.patient.findFirst({
      where: {
        organizationId,
        clinicId,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  ]);

  if (!owner || !patient) {
    throw new Error("Cannot seed treatment case without an owner and patient.");
  }

  const category = await prisma.serviceCategory.upsert({
    where: {
      organizationId_code: {
        organizationId,
        code: "smoke-restorative",
      },
    },
    update: {
      name: "Phục hồi kiểm thử",
      active: true,
    },
    create: {
      organizationId,
      code: "smoke-restorative",
      name: "Phục hồi kiểm thử",
      active: true,
      sortOrder: 900,
    },
    select: { id: true },
  });

  const catalogItem = await prisma.serviceCatalogItem.upsert({
    where: {
      organizationId_code: {
        organizationId,
        code: "SMOKE-COMPOSITE",
      },
    },
    update: {
      categoryId: category.id,
      name: "Trám Composite kiểm thử",
      defaultPrice: 800000,
      status: "ACTIVE",
      targetMode: "TOOTH",
    },
    create: {
      organizationId,
      categoryId: category.id,
      code: "SMOKE-COMPOSITE",
      name: "Trám Composite kiểm thử",
      defaultPrice: 800000,
      defaultDurationMinutes: 45,
      targetMode: "TOOTH",
      status: "ACTIVE",
      version: "smoke-v1",
    },
    select: { id: true },
  });

  const steps = [
    [1, "Khám & chuẩn bị", 20, 15],
    [2, "Trám Composite", 70, 30],
    [3, "Hoàn tất & kiểm tra khớp cắn", 100, 15],
  ];

  for (const [sequence, name, defaultProgress, expectedMinutes] of steps) {
    await prisma.serviceStep.upsert({
      where: {
        serviceId_sequence: {
          serviceId: catalogItem.id,
          sequence,
        },
      },
      update: {
        name,
        defaultProgress,
        expectedMinutes,
      },
      create: {
        organizationId,
        serviceId: catalogItem.id,
        sequence,
        name,
        defaultProgress,
        expectedMinutes,
      },
    });
  }

  const treatmentService = await prisma.treatmentService.upsert({
    where: { id: "smoke-treatment-case" },
    update: {
      organizationId,
      clinicId,
      patientId: patient.id,
      serviceCatalogItemId: catalogItem.id,
      createdById: owner.id,
      serviceCode: "SMOKE-CASE-001",
      serviceName: "Trám Composite kiểm thử",
      targetSummary: "Răng 16 · sâu mặt O",
      teeth: ["R16"],
      status: "IN_PROGRESS",
      finalPrice: 800000,
      currentProgressPercent: 40,
      currentStepSequence: 2,
    },
    create: {
      id: "smoke-treatment-case",
      organizationId,
      clinicId,
      patientId: patient.id,
      serviceCatalogItemId: catalogItem.id,
      createdById: owner.id,
      serviceCode: "SMOKE-CASE-001",
      serviceName: "Trám Composite kiểm thử",
      targetSummary: "Răng 16 · sâu mặt O",
      teeth: ["R16"],
      status: "IN_PROGRESS",
      finalPrice: 800000,
      currentProgressPercent: 40,
      currentStepSequence: 2,
    },
    select: { id: true },
  });

  await prisma.treatmentServiceProgressEvent.upsert({
    where: { id: "smoke-treatment-progress" },
    update: {
      organizationId,
      clinicId,
      treatmentServiceId: treatmentService.id,
      performedById: owner.id,
      fromProgressPercent: 20,
      toProgressPercent: 40,
      progressDeltaPercent: 20,
      note: "Smoke treatment progress",
    },
    create: {
      id: "smoke-treatment-progress",
      organizationId,
      clinicId,
      treatmentServiceId: treatmentService.id,
      performedById: owner.id,
      fromProgressPercent: 20,
      toProgressPercent: 40,
      progressDeltaPercent: 20,
      note: "Smoke treatment progress",
    },
  });
}

function hashPassword(value, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(value, salt, 310000, 32, "sha256").toString("hex");

  return `pbkdf2_sha256$310000$${salt}$${hash}`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
