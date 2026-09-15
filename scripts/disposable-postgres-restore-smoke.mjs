import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sourceUrl = process.env.DATABASE_URL;
const restoreUrl = process.env.RESTORE_DATABASE_URL;
const marker = process.env.RESTORE_TARGET_MARKER;
const dumpPath = path.join(os.tmpdir(), `codexdentist-restore-${randomUUID()}.dump`);

if (!sourceUrl || !restoreUrl) {
  throw new Error("DATABASE_URL and RESTORE_DATABASE_URL are required for the disposable restore smoke.");
}
if (marker !== "CODEXDENTIST_DISPOSABLE_RESTORE") {
  throw new Error("RESTORE_TARGET_MARKER must be CODEXDENTIST_DISPOSABLE_RESTORE.");
}

const source = new URL(sourceUrl);
const target = new URL(restoreUrl);
const sourceDatabase = source.pathname.replace(/^\//, "");
const targetDatabase = target.pathname.replace(/^\//, "");
if (!targetDatabase || targetDatabase === sourceDatabase) {
  throw new Error("RESTORE_DATABASE_URL must identify a distinct disposable database.");
}
if (!/(^|[_-])(restore|test|qa|dev|local|sandbox)([_-]|$)/i.test(targetDatabase)) {
  throw new Error("RESTORE_DATABASE_URL must identify an explicitly disposable database.");
}

try {
  run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", dumpPath, sourceUrl]);
  run("dropdb", ["--if-exists", "--dbname", restoreUrl]);
  run("createdb", ["--dbname", restoreUrl]);
  run("pg_restore", ["--no-owner", "--no-privileges", "--dbname", restoreUrl, dumpPath]);
  run("psql", [restoreUrl, "-v", "ON_ERROR_STOP=1", "-c", 'SELECT 1 FROM "_prisma_migrations" LIMIT 1;']);
  console.log(`ok disposable PostgreSQL restore: ${targetDatabase}`);
} finally {
  await rm(dumpPath, { force: true });
  run("dropdb", ["--if-exists", "--dbname", restoreUrl], false);
}

function run(command, args, required = true) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit" });
  if (required && (result.error || result.status !== 0)) {
    throw result.error ?? new Error(`${command} failed with status ${result.status}`);
  }
  return result;
}
