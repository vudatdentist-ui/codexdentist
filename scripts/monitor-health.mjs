import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.MONITOR_BASE_URL ?? "http://127.0.0.1:3000";
const failedNotificationThreshold = Number(
  process.env.MONITOR_FAILED_NOTIFICATION_THRESHOLD ?? "0",
);
const pendingNotificationThreshold = Number(
  process.env.MONITOR_PENDING_NOTIFICATION_THRESHOLD ?? "100",
);
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const health = await healthResponse.json().catch(() => ({}));
  const [failedNotifications, pendingNotifications] = await Promise.all([
    prisma.notification.count({ where: { status: "FAILED" } }),
    prisma.notification.count({ where: { status: { in: ["DRAFT", "SCHEDULED"] } } }),
  ]);
  const failures = [];

  if (healthResponse.status !== 200 || health.status !== "ok") {
    failures.push(`/api/health returned HTTP ${healthResponse.status}`);
  }

  if (failedNotifications > failedNotificationThreshold) {
    failures.push(
      `failed notifications ${failedNotifications} > ${failedNotificationThreshold}`,
    );
  }

  if (pendingNotifications > pendingNotificationThreshold) {
    failures.push(
      `pending notifications ${pendingNotifications} > ${pendingNotificationThreshold}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        status: failures.length ? "alert" : "ok",
        health,
        failedNotifications,
        pendingNotifications,
        failures,
      },
      null,
      2,
    ),
  );

  if (failures.length) {
    process.exitCode = 2;
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
