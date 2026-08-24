import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV !== "test") {
  throw new Error("reset-smoke-rate-limits may only run with NODE_ENV=test.");
}

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

try {
  const result = await prisma.securityRateLimitBucket.deleteMany();
  console.log(`reset ${result.count} smoke security rate-limit bucket(s)`);
} finally {
  await prisma.$disconnect();
}
