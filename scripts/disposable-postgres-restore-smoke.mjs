import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Never replace an existing database, even when its name contains 'test'.
const source = connection(process.env.DATABASE_URL);
const target = connection(process.env.RESTORE_DATABASE_URL);
if (process.env.NODE_ENV !== "test" || process.env.RESTORE_TARGET_MARKER !== "CODEXDENTIST_DISPOSABLE_RESTORE") {
  throw new Error("Requires NODE_ENV=test and RESTORE_TARGET_MARKER=CODEXDENTIST_DISPOSABLE_RESTORE.");
}
if (source.database === target.database || !/(^|[_-])(restore|test|qa|sandbox)([_-]|$)/i.test(target.database)) {
  throw new Error("Restore requires a distinct, explicitly disposable database name.");
}
const toolImage = process.env.POSTGRES_TOOL_IMAGE;
if (toolImage && !/^postgres:\d+(?:-alpine)?$/.test(toolImage)) throw new Error("Use a pinned official PostgreSQL tool image.");
const toolDirectory = await mkdtemp(path.join(os.tmpdir(), "codexdentist-restore-"));
const dumpPath = path.join(toolDirectory, `database-${randomUUID()}.dump`);
let created = false;
try {
  const before = counts(source);
  run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", dumpPath], source);
  // createdb fails if the target already exists. Such a target is never dropped.
  run("createdb", [target.database], { ...target, database: "postgres" });
  created = true;
  run("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", "--dbname", target.database, dumpPath], target);
  assert.equal(counts(target), before, "restored lifecycle, outbox, manifest and migration rows match the source");
  run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-c", 'SELECT 1 FROM "_prisma_migrations" LIMIT 1;'], target);
  console.log("ok isolated PostgreSQL backup/restore preserves lifecycle, purge manifests and outbox rows");
} finally {
  await unlink(dumpPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  if (created) run("dropdb", ["--if-exists", target.database], { ...target, database: "postgres" });
  await rmdir(toolDirectory);
}

function connection(value) {
  if (!value) throw new Error("DATABASE_URL and RESTORE_DATABASE_URL are required.");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Restore smoke accepts disposable loopback PostgreSQL only.");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-zA-Z0-9_-]+$/.test(database)) throw new Error("Invalid disposable database name.");
  return { database, env: {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""), PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
  } };
}

function run(command, args, config) {
  const invocation = toolImage ? ["docker", ["run", "--rm", "--network", "host",
    "--mount", `type=bind,source=${toolDirectory},target=/restore`,
    ...Object.keys(config.env).flatMap(key => ["--env", key]), "--env", "PGDATABASE", "--env", "PGCONNECT_TIMEOUT",
    toolImage, command, ...args.map(value => value === dumpPath ? `/restore/${path.basename(dumpPath)}` : value)]] : [command, args];
  const result = spawnSync(invocation[0], invocation[1], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, ...config.env, PGDATABASE: config.database, PGCONNECT_TIMEOUT: "5" },
  });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.code ?? result.stderr?.trim() ?? result.status}`);
  return result.stdout.trim();
}

function counts(config) {
  return run("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", `SELECT json_build_array(
    (SELECT count(*) FROM "_prisma_migrations"), (SELECT count(*) FROM "Organization"),
    (SELECT count(*) FROM "PatientFile"), (SELECT count(*) FROM "PatientFileObjectStage"),
    (SELECT count(*) FROM "PatientFilePurgeManifest"), (SELECT count(*) FROM "IntegrationOutbox")
  )::text;`], config);
}
