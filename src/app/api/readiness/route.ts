import { migrationChecksumMatches } from "@/infrastructure/migrations/checksums";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  codexMedAiConfig,
  notificationDeliveryMode,
  patientFileStorageDriver,
  resendEmailConfig,
} from "@/lib/env";
import { verifyJobRequest } from "@/lib/job-auth";
import { prisma } from "@/lib/prisma";
import { reportApplicationError } from "@/lib/error-reporting";

export const dynamic = "force-dynamic";

type ReadinessCheck = {
  details?: string;
  name: string;
  status: "ok" | "warn" | "fail";
};

export async function GET(request: Request) {
  if (!verifyJobRequest(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const checks: ReadinessCheck[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: "database", status: "ok" });
  } catch (error) {
    reportApplicationError("readiness.database_failed", error);
    checks.push({
      name: "database",
      status: "fail",
      details: "Database unavailable",
    });
  }

  try {
    const expected = new Map(
      readdirSync(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
        .map((entry) => [
          entry.name,
          readFileSync(path.join(process.cwd(), "prisma", "migrations", entry.name, "migration.sql")),
        ]),
    );
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string; checksum: string }>>`
      SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    const applied = new Map(migrations.map((migration) => [migration.migration_name, migration.checksum]));
    const missing = [...expected.keys()].filter((name) => !applied.has(name));
    const unexpected = [...applied.keys()].filter((name) => !expected.has(name));
    const drift = [...expected.entries()]
      .filter(([name, bytes]) => applied.get(name) && !migrationChecksumMatches(name, bytes, applied.get(name)!))
      .map(([name]) => name);
    const valid = missing.length === 0 && unexpected.length === 0 && drift.length === 0;
    checks.push({
      name: "migrations",
      status: valid ? "ok" : "fail",
      details: valid
        ? `${applied.size} migrations verified`
        : `missing=${missing.length}, unexpected=${unexpected.length}, checksumDrift=${drift.length}`,
    });
  } catch (error) {
    reportApplicationError("readiness.migrations_failed", error);
    checks.push({
      name: "migrations",
      status: "fail",
      details: "Migration table unavailable",
    });
  }

  try {
    checks.push({
      name: "patient-file-storage",
      status: patientFileStorageDriver() === "local" ? "warn" : "ok",
      details: patientFileStorageDriver(),
    });
  } catch (error) {
    reportApplicationError("readiness.storage_failed", error);
    checks.push({
      name: "patient-file-storage",
      status: "fail",
      details: "Storage config invalid",
    });
  }

  try {
    const mode = notificationDeliveryMode();
    const resend = resendEmailConfig();
    checks.push({
      name: "notifications",
      status: mode === "disabled" ? "warn" : "ok",
      details: resend ? "resend configured" : mode,
    });
  } catch (error) {
    reportApplicationError("readiness.notifications_failed", error);
    checks.push({
      name: "notifications",
      status: "fail",
      details: "Notification config invalid",
    });
  }

  try {
    const ai = codexMedAiConfig();
    checks.push({
      name: "ai",
      status: ai.enabled ? "ok" : "warn",
      details: ai.enabled ? `${ai.provider}:${ai.model}` : "disabled",
    });
  } catch (error) {
    reportApplicationError("readiness.ai_failed", error);
    checks.push({
      name: "ai",
      status: "fail",
      details: "AI config invalid",
    });
  }

  const hasFailure = checks.some((check) => check.status === "fail");
  const hasWarning = checks.some((check) => check.status === "warn");

  return NextResponse.json(
    {
      status: hasFailure ? "fail" : hasWarning ? "warn" : "ok",
      checks,
      timestamp: new Date().toISOString(),
    },
    {
      status: hasFailure ? 503 : 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
