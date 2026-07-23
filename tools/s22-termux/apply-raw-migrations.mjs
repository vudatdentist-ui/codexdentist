import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const appDir = process.cwd();
const migrationsDir = join(appDir, "prisma", "migrations");
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/vietnam_dental_suite?schema=public";
const psqlUrl = new URL(databaseUrl);
psqlUrl.searchParams.delete("schema");
const prefix = process.env.PREFIX ?? "/data/data/com.termux/files/usr";
const psql = join(prefix, "bin", "psql");

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPsql(args, options = {}) {
  return execFileSync(psql, [psqlUrl.toString(), ...args], {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
}

function runSql(sql) {
  return runPsql(["-v", "ON_ERROR_STOP=1", "-c", sql]);
}

if (!existsSync(psql)) {
  throw new Error(`psql not found at ${psql}`);
}

if (!existsSync(migrationsDir)) {
  throw new Error(`Missing migrations directory: ${migrationsDir}`);
}

runSql(`
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
`);

const applied = new Set(
  runPsql(["-At", "-c", 'SELECT "migration_name" FROM "_prisma_migrations" ORDER BY "migration_name";'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
);

const migrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const migrationName of migrations) {
  if (applied.has(migrationName)) {
    console.log(`skip ${migrationName}`);
    continue;
  }

  const sqlPath = join(migrationsDir, migrationName, "migration.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");

  console.log(`apply ${migrationName}`);
  runPsql(["-v", "ON_ERROR_STOP=1", "-f", sqlPath], { stdio: "inherit" });
  runSql(`
INSERT INTO "_prisma_migrations"
  ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES
  (${sqlString(randomUUID())}, ${sqlString(checksum)}, now(), ${sqlString(migrationName)}, '', NULL, now(), 1);
`);
}

console.log("Raw migrations applied.");
