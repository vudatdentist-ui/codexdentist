import { readFile, writeFile } from "node:fs/promises";
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const args = new Set(process.argv.slice(2));
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const appBaseUrl = (process.env.APP_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const ownerEmail = process.env.PILOT_OWNER_EMAIL?.trim().toLowerCase();
const ownerName = process.env.PILOT_OWNER_NAME?.trim() || "Pilot Owner";
const rotateDemo = args.has("--rotate-demo");
const writeEnv = args.has("--write-env");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  if (!ownerEmail) {
    throw new Error("Set PILOT_OWNER_EMAIL before running this script.");
  }

  const organization = await prisma.organization.findFirstOrThrow({
    orderBy: { createdAt: "asc" },
    include: {
      clinics: {
        select: { id: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const primaryClinicId = organization.clinics[0]?.id;

  if (!primaryClinicId) {
    throw new Error("Pilot setup requires at least one clinic.");
  }

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {
      organizationId: organization.id,
      fullName: ownerName,
      role: "OWNER",
      active: true,
      passwordHash: hashPassword(randomBytes(32).toString("base64url")),
      mustChangePassword: true,
      passwordChangedAt: null,
    },
    create: {
      organizationId: organization.id,
      email: ownerEmail,
      fullName: ownerName,
      role: "OWNER",
      active: true,
      passwordHash: hashPassword(randomBytes(32).toString("base64url")),
      mustChangePassword: true,
    },
    select: { id: true, email: true },
  });

  await prisma.userClinic.upsert({
    where: {
      userId_clinicId: {
        userId: owner.id,
        clinicId: primaryClinicId,
      },
    },
    update: {},
    create: {
      userId: owner.id,
      clinicId: primaryClinicId,
    },
  });

  const setupToken = await createPasswordSetupToken({
    organizationId: organization.id,
    userId: owner.id,
  });
  const demoPasswordUsers = await usersWithDemoPassword();

  if (rotateDemo) {
    for (const user of demoPasswordUsers.filter((user) => user.email !== owner.email)) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          active: false,
          passwordHash: hashPassword(randomBytes(32).toString("base64url")),
          mustChangePassword: true,
          passwordChangedAt: null,
        },
      });
    }
  }

  if (writeEnv) {
    await setEnvValue("DEMO_AUTH_ENABLED", "false");
  }

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: null,
      action: "pilot.prepare",
      entityType: "User",
      entityId: owner.id,
      metadata: {
        ownerEmail: owner.email,
        rotateDemo,
        writeEnv,
        demoPasswordUsersFound: demoPasswordUsers.length,
      },
    },
  });

  console.log("Pilot owner setup link:");
  console.log(`${appBaseUrl}/reset-password?token=${encodeURIComponent(setupToken)}`);
  console.log(`Owner: ${owner.email}`);
  console.log(`DEMO_AUTH_ENABLED ${writeEnv ? "set to false in .env" : "was not changed"}`);
  console.log(
    rotateDemo
      ? `Rotated/deactivated ${Math.max(demoPasswordUsers.length - 1, 0)} demo-password users.`
      : `Found ${demoPasswordUsers.length} users that still accept demo1234.`,
  );

  if (!rotateDemo && demoPasswordUsers.length > 0) {
    console.log("Run again with --rotate-demo --write-env before a real pilot.");
  }
}

async function createPasswordSetupToken({ organizationId, userId }) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();

  await prisma.passwordResetToken.updateMany({
    where: {
      userId,
      usedAt: null,
      expiresAt: {
        gt: now,
      },
    },
    data: {
      usedAt: now,
    },
  });
  await prisma.passwordResetToken.create({
    data: {
      organizationId,
      userId,
      tokenHash: hashToken(token),
      purpose: "PILOT_OWNER_SETUP",
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    },
  });

  return token;
}

async function usersWithDemoPassword() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      passwordHash: true,
    },
  });

  return users.filter((user) => verifyPassword("demo1234", user.passwordHash));
}

async function setEnvValue(name, value) {
  const envPath = ".env";
  const raw = await readFile(envPath, "utf8").catch(() => "");
  const line = `${name}="${value}"`;
  const next = raw.match(new RegExp(`^${name}=`, "m"))
    ? raw.replace(new RegExp(`^${name}=.*$`, "m"), line)
    : `${raw.trimEnd()}\n${line}\n`;

  await writeFile(envPath, next, "utf8");
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const iterations = 310000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");

  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, passwordHash) {
  const [algorithm, iterationsRaw, salt, expectedHash] = passwordHash.split("$");

  if (algorithm !== "pbkdf2_sha256" || !iterationsRaw || !salt || !expectedHash) {
    return false;
  }

  const actualHash = pbkdf2Sync(
    password,
    salt,
    Number(iterationsRaw),
    32,
    "sha256",
  ).toString("hex");

  return safeEqual(actualHash, expectedHash);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

  return (
    firstBuffer.length === secondBuffer.length &&
    timingSafeEqual(firstBuffer, secondBuffer)
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
