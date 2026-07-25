import { NextResponse } from "next/server";
import {
  codexMedAiConfig,
  notificationDeliveryMode,
  patientFileStorageDriver,
  resendEmailConfig,
} from "@/lib/env";
import { verifyJobRequest } from "@/lib/job-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ReadinessCheck = {
  details?: string;
  name: string;
  status: "ok" | "warn" | "fail";
};

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" && !verifyJobRequest(request)) {
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
    console.error("readiness.database_failed", error);
    checks.push({
      name: "database",
      status: "fail",
      details: "Database unavailable",
    });
  }

  try {
    const migrations = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
    `;
    checks.push({
      name: "migrations",
      status: Number(migrations[0]?.count ?? 0) > 0 ? "ok" : "warn",
      details: `${Number(migrations[0]?.count ?? 0)} migrations recorded`,
    });
  } catch (error) {
    console.error("readiness.migrations_failed", error);
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
    console.error("readiness.storage_failed", error);
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
    console.error("readiness.notifications_failed", error);
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
    console.error("readiness.ai_failed", error);
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
