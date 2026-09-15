import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
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
const sourceToolUrl = withoutPrismaSchema(sourceUrl);
const targetToolUrl = withoutPrismaSchema(restoreUrl);
const targetConnection = connectionOptions(targetToolUrl);
const postgresToolImage = process.env.POSTGRES_TOOL_IMAGE?.trim() || "";
if (!targetDatabase || targetDatabase === sourceDatabase) {
  throw new Error("RESTORE_DATABASE_URL must identify a distinct disposable database.");
}
if (!/(^|[_-])(restore|test|qa|dev|local|sandbox)([_-]|$)/i.test(targetDatabase)) {
  throw new Error("RESTORE_DATABASE_URL must identify an explicitly disposable database.");
}

try {
  run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", dumpPath, sourceToolUrl]);
  run("dropdb", ["--if-exists", ...targetConnection.args, targetDatabase], true, targetConnection.env);
  run("createdb", [...targetConnection.args, targetDatabase], true, targetConnection.env);
  run("pg_restore", ["--no-owner", "--no-privileges", "--dbname", targetToolUrl, dumpPath]);
  run("psql", [targetToolUrl, "-v", "ON_ERROR_STOP=1", "-c", 'SELECT 1 FROM "_prisma_migrations" LIMIT 1;']);
  console.log(`ok disposable PostgreSQL restore: ${targetDatabase}`);
} finally {
  await unlink(dumpPath).catch((error) => {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  });
  run("dropdb", ["--if-exists", ...targetConnection.args, targetDatabase], false, targetConnection.env);
}

function run(command, args, required = true, connectionEnv = {}) {
  const postgresCommands = new Set(["pg_dump", "dropdb", "createdb", "pg_restore", "psql"]);
  const useContainer = postgresToolImage && postgresCommands.has(command);
  const containerArgs = useContainer
    ? args.map((value) => value === dumpPath ? `/codexdentist-tmp/${path.basename(dumpPath)}` : value)
    : args;
  const executable = useContainer ? "docker" : command;
  const executableArgs = useContainer
    ? [
        "run",
        "--rm",
        "--network",
        "host",
        "--volume",
        `${path.dirname(dumpPath)}:/codexdentist-tmp`,
        ...Object.keys(connectionEnv).flatMap((key) => ["-e", key]),
        postgresToolImage,
        command,
        ...containerArgs,
      ]
    : args;
  const result = spawnSync(executable, executableArgs, {
    encoding: "utf8",
    stdio: "inherit",
    env: { ...process.env, ...connectionEnv },
  });
  if (required && (result.error || result.status !== 0)) {
    throw result.error ?? new Error(`${command} failed with status ${result.status}`);
  }
  return result;
}

function withoutPrismaSchema(value) {
  const url = new URL(value);
  url.searchParams.delete("schema");
  return url.toString();
}

function connectionOptions(value) {
  const url = new URL(value);
  const args = [];
  if (url.hostname) args.push("--host", url.hostname);
  if (url.port) args.push("--port", url.port);
  if (url.username) args.push("--username", decodeURIComponent(url.username));
  const password = url.password ? decodeURIComponent(url.password) : "";
  return {
    args,
    env: password ? { PGPASSWORD: password } : {},
  };
}
