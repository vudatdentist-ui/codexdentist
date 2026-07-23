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
  }

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
    },
    create: {
      organizationId: organization.id,
      clinicId: clinics[0].id,
      fullName: "Smoke Patient",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      phone: "0900000000",
      email: "patient@nhavista.vn",
    },
  });

  console.log(`Seeded ${users.length} smoke users with password from SMOKE_USER_PASSWORD.`);
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
