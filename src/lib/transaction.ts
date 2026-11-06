import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DEFAULT_MAX_ATTEMPTS = 3;

export async function runSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    }
  }

  throw new Error("Serializable transaction retry limit reached.");
}

function isRetryableTransactionError(error: unknown) {
  // adapter-pg can expose a COMMIT conflict as DriverAdapterError rather than P2034.
  // Inspect structured SQLSTATEs only; messages are neither stable nor safe classifiers.
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  for (let inspected = 0; pending.length && inspected < 12; inspected++) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as { code?: unknown; originalCode?: unknown; cause?: unknown;
      meta?: { code?: unknown; driverAdapterError?: unknown } };
    if (record.code === "P2034" || record.code === "40001" || record.code === "40P01" ||
        record.originalCode === "40001" || record.originalCode === "40P01") return true;
    pending.push(record.cause);
    // Raw SQL statements wrap the same adapter conflict in P2010/meta instead
    // of the direct cause chain used for COMMIT. Do not retry other P2010 errors.
    if (record.code === "P2010") {
      if (record.meta?.code === "40001" || record.meta?.code === "40P01") return true;
      pending.push(record.meta?.driverAdapterError);
    }
  }
  return false;
}
