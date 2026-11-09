import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { notificationConfigurationErrors } from "./lib/notification-readiness.mjs";
import { migrationChecksumMatches } from "../src/infrastructure/migrations/checksums.ts";
import { verifyDurableLocalRoot } from "../src/infrastructure/patient-files/durable-root.ts";

loadDotEnv();

const developmentDatabaseUrl =
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const weakAuthSecrets = new Set([
  "development-only-nhavista-auth-secret",
  "replace-with-a-long-random-secret-before-production",
  "local-development-nhavista-secret-change-before-production",
]);
const weakJobSecrets = new Set([
  "development-only-nhavista-job-secret",
  "replace-with-a-long-random-job-secret-before-production",
]);
const requiredR2Env = [
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];
const errors = [];
const warnings = [];
const connectionString = env("DATABASE_URL") || developmentDatabaseUrl;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  await checkEnvironment();
  checkSecretHygiene();
  await checkDatabase();
  checkScripts();

  if (warnings.length) {
    console.log("Warnings:");
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  if (errors.length) {
    console.error("Go-live check failed:");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log("Go-live check passed.");
}

async function checkEnvironment() {
  if (env("NODE_ENV") !== "production") {
    errors.push("Set NODE_ENV=production for go-live.");
  }

  if (env("DEMO_AUTH_ENABLED") !== "false") {
    errors.push("Set DEMO_AUTH_ENABLED=false.");
  }

  const authSecret = env("AUTH_SECRET");
  if (!authSecret || authSecret.length < 32 || weakAuthSecrets.has(authSecret)) {
    errors.push("Set AUTH_SECRET to a unique random value with at least 32 characters.");
  }

  const jobSecret = env("JOB_SECRET");
  if (!jobSecret || jobSecret.length < 32 || weakJobSecrets.has(jobSecret)) {
    errors.push("Set JOB_SECRET to a unique random value with at least 32 characters.");
  }

  const appBaseUrl = env("APP_BASE_URL");
  if (!appBaseUrl || !isHttps(appBaseUrl)) {
    errors.push("Set APP_BASE_URL to the final HTTPS production URL.");
  }

  const cookieSecure = env("SESSION_COOKIE_SECURE").toLowerCase();
  if (["0", "false", "no"].includes(cookieSecure)) {
    errors.push("Do not disable secure session cookies for go-live.");
  }

  if (!env("DATABASE_URL")) {
    errors.push("Set DATABASE_URL to the managed production PostgreSQL connection string.");
  } else if (/localhost|127\.0\.0\.1/i.test(env("DATABASE_URL"))) {
    errors.push("DATABASE_URL points to localhost; use managed production PostgreSQL for go-live.");
  }

  const driver = env("PATIENT_FILE_STORAGE_DRIVER");
  if (driver === "local" || env("PATIENT_FILE_LOCAL_DURABLE") === "true") {
    try { await verifyDurableLocalRoot({ probeWrite: true }); }
    catch { errors.push("Local patient files require a private writable durable volume mounted outside the application as its unprivileged runtime user."); }
  }
  if (driver === "r2") {
    if (!env("R2_ACCOUNT_ID") && !env("R2_ENDPOINT")) errors.push("Set R2_ACCOUNT_ID or R2_ENDPOINT.");
    for (const name of requiredR2Env) {
      if (!env(name)) errors.push(`Set ${name}.`);
    }
    if (env("R2_ENDPOINT") && !isHttps(env("R2_ENDPOINT"))) errors.push("R2_ENDPOINT must be HTTPS.");
  } else if (driver !== "local") {
    errors.push("Set PATIENT_FILE_STORAGE_DRIVER to r2 or verified durable local storage.");
  }

  errors.push(...notificationConfigurationErrors(process.env));
}

function checkSecretHygiene() {
  const gitignore = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";

  for (const pattern of [".env", ".env.local", ".env.*"]) {
    if (!gitignore.includes(pattern)) {
      errors.push(`Add ${pattern} to .gitignore before go-live.`);
    }
  }

  if (existsSync(".env.production")) {
    warnings.push("Do not store .env.production in the app source folder or backups.");
  }

  const productionExample = existsSync(".env.production.example")
    ? readFileSync(".env.production.example", "utf8")
    : "";
  if (/(^|\n)(RESEND_API_KEY|CODEXMED_AI_API_KEY)=["']?(re_|sk-)[A-Za-z0-9_-]{12,}/.test(productionExample)) {
    errors.push("Remove real API keys from .env.production.example.");
  }

  for (const secretName of ["AUTH_SECRET", "JOB_SECRET"]) {
    const value = productionExample.match(new RegExp(`(^|\\n)${secretName}=[\"']?([^\"'\\n]+)`))?.[2] ?? "";
    if (value && !/generate|random|secret|replace|your/i.test(value)) {
      errors.push(`Remove real-looking ${secretName} value from .env.production.example.`);
    }
  }
}

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    errors.push(`Database is not reachable: ${error.message}`);
    return;
  }

  const requiredMigrations = readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      bytes: readFileSync(`prisma/migrations/${entry.name}/migration.sql`),
      checksum: createHash("sha256")
        .update(readFileSync(`prisma/migrations/${entry.name}/migration.sql`))
        .digest("hex"),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const appliedMigrations = await prisma.$queryRaw`SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  const appliedByName = new Map(appliedMigrations.map((row) => [row.migration_name, row.checksum]));
  const requiredByName = new Map(requiredMigrations.map((migration) => [migration.name, migration.checksum]));
  const missingMigrations = requiredMigrations
    .filter((migration) => !appliedByName.has(migration.name))
    .map((migration) => migration.name);
  if (missingMigrations.length > 0) {
    errors.push(`Database migrations are incomplete (${missingMigrations.length} missing): ${missingMigrations.join(", ")}`);
  }
  const unexpectedMigrations = [...appliedByName.keys()].filter((name) => !requiredByName.has(name));
  if (unexpectedMigrations.length > 0) {
    errors.push(`Database contains migrations missing from this release: ${unexpectedMigrations.join(", ")}`);
  }
  const checksumDrift = requiredMigrations
    .filter((migration) => appliedByName.get(migration.name) && !migrationChecksumMatches(migration.name, migration.bytes, appliedByName.get(migration.name)))
    .map((migration) => migration.name);
  if (checksumDrift.length > 0) {
    errors.push(`Migration checksum drift detected: ${checksumDrift.join(", ")}`);
  }

  const [demoPasswordUsers, activeOwners, failedNotifications, pendingNotifications] =
    await Promise.all([
      usersWithDemoPassword(),
      prisma.user.findMany({
        where: {
          role: "OWNER",
          active: true,
          mustChangePassword: false,
        },
        select: {
          email: true,
        },
      }),
      prisma.notification.count({ where: { status: "FAILED" } }),
      prisma.notification.count({ where: { status: { in: ["DRAFT", "SCHEDULED"] } } }),
    ]);

  if (demoPasswordUsers.length > 0) {
    errors.push(
      `Rotate/deactivate ${demoPasswordUsers.length} user(s) that still accept demo1234: ${demoPasswordUsers
        .map((user) => user.email)
        .join(", ")}`,
    );
  }

  if (activeOwners.length === 0) {
    errors.push("Create at least one active OWNER who has completed password setup.");
  }

  if (failedNotifications > 0) {
    errors.push(`Resolve ${failedNotifications} failed notification(s) before go-live.`);
  }

  if (pendingNotifications > 500) {
    warnings.push(`Pending notification backlog is high: ${pendingNotifications}.`);
  }
}

function checkScripts() {
  for (const path of [
    "scripts/pg-backup.ps1",
    "scripts/pg-restore.ps1",
    "scripts/monitor-health.mjs",
    "scripts/billing-edge-smoke.mjs",
    "scripts/source-commission-smoke.mjs",
  ]) {
    if (!existsSync(path)) {
      errors.push(`Missing operational script: ${path}`);
    }
  }

  if (!existsSync("docs/OPERATIONS.md")) {
    errors.push("Missing docs/OPERATIONS.md.");
  }
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

function verifyPassword(password, passwordHash) {
  const [algorithm, iterationsRaw, salt, expectedHash] = String(passwordHash ?? "").split("$");

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

function safeEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

  return (
    firstBuffer.length === secondBuffer.length &&
    timingSafeEqual(firstBuffer, secondBuffer)
  );
}

function env(name) {
  return process.env[name]?.trim() ?? "";
}

function isHttps(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function loadDotEnv() {
  if (!existsSync(".env")) {
    return;
  }

  const raw = readFileSync(".env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);

    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
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
