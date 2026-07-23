import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const seedSource = "pilot-schedule-seed-2026-05";
const vnTimeZone = "Asia/Bangkok";

const reasons = [
  "Khám tổng quát",
  "Lấy cao răng",
  "Trám composite",
  "Điều trị tủy",
  "Nhổ răng khôn",
  "Tư vấn implant",
  "Tái khám chỉnh nha",
  "Scan trong miệng",
  "Thử mão sứ",
  "Tái khám sau phẫu thuật",
  "Khám đau răng cấp",
  "Tẩy trắng răng",
];

const todayPlan = [
  [8, 0, 45, "COMPLETED", "Lấy cao răng"],
  [9, 0, 60, "IN_CHAIR", "Điều trị tủy"],
  [10, 20, 50, "ARRIVED", "Trám composite"],
  [11, 30, 45, "CONFIRMED", "Tư vấn implant"],
  [13, 30, 40, "REQUESTED", "Khám tổng quát"],
  [14, 30, 45, "CONFIRMED", "Tái khám chỉnh nha"],
  [15, 30, 40, "NO_SHOW", "Tái khám sau phẫu thuật"],
  [16, 20, 50, "CONFIRMED", "Scan trong miệng"],
];

const dayPlans = [
  [-1, [[9, 0, 60, "COMPLETED", "Nhổ răng khôn"], [14, 0, 45, "CANCELLED", "Tẩy trắng răng"]]],
  [0, todayPlan],
  [1, [[8, 30, 45, "CONFIRMED", "Khám đau răng cấp"], [9, 30, 60, "CONFIRMED", "Thử mão sứ"], [13, 30, 45, "REQUESTED", "Tư vấn implant"], [15, 0, 40, "CONFIRMED", "Lấy cao răng"]]],
  [2, [[9, 0, 60, "CONFIRMED", "Điều trị tủy"], [10, 30, 45, "REQUESTED", "Scan trong miệng"], [14, 0, 60, "CONFIRMED", "Tái khám chỉnh nha"]]],
  [4, [[8, 30, 45, "CONFIRMED", "Khám tổng quát"], [10, 0, 60, "CONFIRMED", "Tư vấn implant"], [15, 0, 45, "REQUESTED", "Trám composite"]]],
];

function localDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: vnTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function addDaysKey(offset) {
  const now = new Date();
  const utcNoon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, 12, 0, 0);
  const parts = localDateParts(new Date(utcNoon));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function atVnTime(dayKey, hour, minute) {
  return new Date(`${dayKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

async function ensureChairs(clinic) {
  const chairs = await prisma.chair.findMany({ where: { clinicId: clinic.id, active: true }, orderBy: { name: "asc" } });
  if (chairs.length > 0) return chairs;

  const names = ["Ghế 1", "Ghế 2", "Ghế tiểu phẫu"];
  for (const name of names) {
    await prisma.chair.create({
      data: {
        clinicId: clinic.id,
        name,
        specialty: name.includes("tiểu phẫu") ? "Phẫu thuật" : "Tổng quát",
        active: true,
        operationalStatus: "READY",
      },
    });
  }
  return prisma.chair.findMany({ where: { clinicId: clinic.id, active: true }, orderBy: { name: "asc" } });
}

async function main() {
  const orgs = await prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
  if (orgs.length === 0) {
    console.log("No organizations found. Nothing seeded.");
    return;
  }

  const summary = [];

  for (const org of orgs) {
    const clinics = await prisma.clinic.findMany({
      where: { organizationId: org.id, active: true },
      orderBy: { createdAt: "asc" },
    });

    if (clinics.length === 0) {
      summary.push({ organization: org.name, appointments: 0, note: "No active clinics" });
      continue;
    }

    const clinicIds = clinics.map((clinic) => clinic.id);
    await prisma.appointment.deleteMany({ where: { clinicId: { in: clinicIds }, source: seedSource } });

    const patients = await prisma.patient.findMany({
      where: { organizationId: org.id, clinicId: { in: clinicIds } },
      orderBy: { createdAt: "asc" },
      take: 80,
    });

    const providers = await prisma.user.findMany({
      where: {
        organizationId: org.id,
        active: true,
        role: { in: ["DENTIST", "HYGIENIST", "CLINIC_MANAGER", "OWNER"] },
        clinics: { some: { clinicId: { in: clinicIds } } },
      },
      include: { clinics: true },
      orderBy: { createdAt: "asc" },
    });

    if (patients.length === 0 || providers.length === 0) {
      summary.push({
        organization: org.name,
        appointments: 0,
        note: `Missing ${patients.length === 0 ? "patients" : "providers"}`,
      });
      continue;
    }

    let created = 0;
    let patientIndex = 0;
    let providerIndex = 0;

    for (const [clinicIndex, clinic] of clinics.entries()) {
      const chairs = await ensureChairs(clinic);
      const clinicPatients = patients.filter((patient) => patient.clinicId === clinic.id);
      const usablePatients = clinicPatients.length > 0 ? clinicPatients : patients;
      const clinicProviders = providers.filter((provider) => provider.clinics.some((membership) => membership.clinicId === clinic.id));
      const usableProviders = clinicProviders.length > 0 ? clinicProviders : providers;

      const maxPlans = clinicIndex === 0 ? dayPlans.length : Math.min(3, dayPlans.length);
      for (const [dayOffset, slots] of dayPlans.slice(0, maxPlans)) {
        const dayKey = addDaysKey(dayOffset);
        const slotsForClinic = clinicIndex === 0 ? slots : slots.slice(0, Math.min(4, slots.length));

        for (const [slotIndex, [hour, minute, duration, status, plannedReason]] of slotsForClinic.entries()) {
          const startsAt = atVnTime(dayKey, hour, minute + clinicIndex * 5);
          const endsAt = addMinutes(startsAt, duration);
          const patient = usablePatients[patientIndex % usablePatients.length];
          const provider = usableProviders[providerIndex % usableProviders.length];
          const chair = chairs[(slotIndex + clinicIndex) % chairs.length];
          patientIndex += 1;
          providerIndex += 1;

          await prisma.appointment.create({
            data: {
              clinicId: clinic.id,
              patientId: patient.id,
              providerId: provider.id,
              chairId: chair.id,
              status,
              startsAt,
              endsAt,
              reason: plannedReason || reasons[(slotIndex + clinicIndex) % reasons.length],
              source: seedSource,
            },
          });
          created += 1;
        }
      }
    }

    const byStatus = await prisma.appointment.groupBy({
      by: ["status"],
      where: { clinicId: { in: clinicIds }, source: seedSource },
      _count: { _all: true },
      orderBy: { status: "asc" },
    });

    summary.push({
      organization: org.name,
      clinics: clinics.length,
      appointments: created,
      statuses: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    });
  }

  console.table(summary.map((item) => ({
    organization: item.organization,
    clinics: item.clinics ?? 0,
    appointments: item.appointments,
    note: item.note ?? "",
    statuses: item.statuses ? JSON.stringify(item.statuses) : "",
  })));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
