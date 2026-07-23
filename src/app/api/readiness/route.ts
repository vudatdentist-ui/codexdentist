import { NextResponse } from "next/server";
import {
  codexMedAiConfig,
  notificationDeliveryMode,
  patientFileStorageDriver,
  resendEmailConfig,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ReadinessCheck = {
  details?: string;
  name: string;
  status: "ok" | "warn" | "fail";
};

export async function GET() {
  const checks: ReadinessCheck[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: "database", status: "ok" });
  } catch (error) {
    checks.push({
      name: "database",
      status: "fail",
      details: error instanceof Error ? error.message : "Database unavailable",
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
    checks.push({
      name: "migrations",
      status: "fail",
      details: error instanceof Error ? error.message : "Migration table unavailable",
    });
  }

  try {
    checks.push({
      name: "patient-file-storage",
      status: patientFileStorageDriver() === "local" ? "warn" : "ok",
      details: patientFileStorageDriver(),
    });
  } catch (error) {
    checks.push({
      name: "patient-file-storage",
      status: "fail",
      details: error instanceof Error ? error.message : "Storage config invalid",
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
    checks.push({
      name: "notifications",
      status: "fail",
      details: error instanceof Error ? error.message : "Notification config invalid",
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
    checks.push({
      name: "ai",
      status: "fail",
      details: error instanceof Error ? error.message : "AI config invalid",
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
    { status: hasFailure ? 503 : 200 },
  );
}
