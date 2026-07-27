import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const loginWindowMs = 10 * 60 * 1000;
const passwordResetWindowMs = 60 * 60 * 1000;
const aiWindowMs = 60 * 60 * 1000;
let lastPrunedAt = 0;

export function consumeLoginAttempt(key: string) {
  return consumePersistentBucket({
    key,
    maxAttempts: 8,
    namespace: "login",
    windowMs: loginWindowMs,
  });
}

export async function clearLoginAttempts(key: string) {
  try {
    await prisma.securityRateLimitBucket.deleteMany({
      where: {
        keyHash: hashKey("login", key),
      },
    });
  } catch (error) {
    console.error("security_rate_limit.clear_failed", error);
  }
}

export function consumePasswordResetAttempt(key: string) {
  return consumePersistentBucket({
    key,
    maxAttempts: 5,
    namespace: "password-reset",
    windowMs: passwordResetWindowMs,
  });
}

export function consumeDemoWorkspaceAttempt(key: string) {
  return consumePersistentBucket({
    key,
    maxAttempts: 3,
    namespace: "demo-workspace",
    windowMs: 24 * 60 * 60 * 1000,
  });
}

export function consumeAiUserAttempt(userId: string) {
  return consumePersistentBucket({
    key: userId,
    maxAttempts: 20,
    namespace: "ai-user",
    windowMs: aiWindowMs,
  });
}

export function consumeAiOrganizationAttempt(organizationId: string) {
  return consumePersistentBucket({
    key: organizationId,
    maxAttempts: 100,
    namespace: "ai-organization",
    windowMs: aiWindowMs,
  });
}

async function consumePersistentBucket(input: {
  key: string;
  maxAttempts: number;
  namespace: string;
  windowMs: number;
}): Promise<RateLimitResult> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + input.windowMs);
  const keyHash = hashKey(input.namespace, input.key);

  try {
    const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "SecurityRateLimitBucket"
        ("keyHash", "count", "resetAt", "createdAt", "updatedAt")
      VALUES
        (${keyHash}, 1, ${resetAt}, ${now}, ${now})
      ON CONFLICT ("keyHash") DO UPDATE SET
        "count" = CASE
          WHEN "SecurityRateLimitBucket"."resetAt" <= ${now} THEN 1
          ELSE "SecurityRateLimitBucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "SecurityRateLimitBucket"."resetAt" <= ${now} THEN ${resetAt}
          ELSE "SecurityRateLimitBucket"."resetAt"
        END,
        "updatedAt" = ${now}
      RETURNING "count", "resetAt"
    `;
    const bucket = rows[0];

    if (!bucket) {
      throw new Error("Rate-limit bucket was not returned.");
    }

    try {
      await pruneExpiredBuckets(now);
    } catch (error) {
      console.error("security_rate_limit.prune_failed", error);
    }

    return {
      allowed: bucket.count <= input.maxAttempts,
      retryAfterSeconds:
        bucket.count <= input.maxAttempts
          ? 0
          : Math.max(
              1,
              Math.ceil((bucket.resetAt.getTime() - now.getTime()) / 1000),
            ),
    };
  } catch (error) {
    console.error("security_rate_limit.consume_failed", error);

    // Authentication is safer to pause briefly than to fail open without throttling.
    return {
      allowed: false,
      retryAfterSeconds: 60,
    };
  }
}

async function pruneExpiredBuckets(now: Date) {
  if (lastPrunedAt + loginWindowMs > now.getTime()) {
    return;
  }

  lastPrunedAt = now.getTime();
  await prisma.securityRateLimitBucket.deleteMany({
    where: {
      resetAt: {
        lt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
    },
  });
}

function hashKey(namespace: string, key: string) {
  return createHash("sha256")
    .update(`${namespace}\0${key}`)
    .digest("hex");
}
