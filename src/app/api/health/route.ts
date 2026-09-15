import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    const [, , failedMigrations] = await Promise.all([
      prisma.$queryRaw`SELECT 1`,
      prisma.organization.count(),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "_prisma_migrations"
        WHERE "finished_at" IS NULL
          AND "rolled_back_at" IS NULL
      `,
    ]);

    if (Number(failedMigrations[0]?.count ?? 0) > 0) {
      throw new Error("Database has unfinished migrations.");
    }

    return NextResponse.json(
      {
        status: "ok",
        database: "ok",
        schema: "ok",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        database: "unavailable",
        schema: "unavailable",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
