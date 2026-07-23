import "server-only";

import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export async function writeAuditLog(input: {
  session?: AppSession | null;
  organizationId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const requestHeaders = await safeHeaders();
  const metadata =
    typeof input.metadata === "object" && input.metadata !== null && !Array.isArray(input.metadata)
      ? (input.metadata as Record<string, unknown>)
      : {};

  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.session ? databaseActorId(input.session.userId) : null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        ipAddress: requestHeaders?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        metadata: {
          ...metadata,
          actorEmail: input.session?.email ?? null,
          actorRole: input.session?.role ?? null,
          userAgent: requestHeaders?.get("user-agent") ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("audit.write_failed", error);
  }
}

async function safeHeaders() {
  try {
    return await headers();
  } catch {
    return null;
  }
}
