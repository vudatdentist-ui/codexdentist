import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  IntegrationInboxEnvelope,
  IntegrationOutboxEnvelope,
  IntegrationOutboxTransport,
  OutboxDispatchResult,
} from "../../features/integrations/outbox";

type SqlExecutor = Pick<
  PrismaClient,
  "$executeRawUnsafe" | "$queryRawUnsafe"
> | Prisma.TransactionClient;

type ConnectionRow = {
  id: string;
  organizationId: string;
  clinicId: string | null;
  provider: string;
  status: string;
  capabilities: unknown;
  secretRef: string | null;
  metadata: unknown;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ExternalReferenceRow = {
  id: string;
  organizationId: string;
  clinicId: string | null;
  connectionId: string | null;
  provider: string;
  entityType: string;
  internalId: string;
  externalId: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type InboxRow = IntegrationInboxEnvelope & {
  payloadHash: string;
  status: "RECEIVED" | "PROCESSING" | "PROCESSED" | "RETRY" | "FAILED";
  availableAt: Date;
  lastErrorCode: string | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type OutboxRow = IntegrationOutboxEnvelope & {
  dedupeKey: string | null;
  status: "PENDING" | "PROCESSING" | "SENT" | "RETRY" | "FAILED";
  availableAt: Date;
  lockToken: string | null;
  lockedAt: Date | null;
  lastErrorCode: string | null;
  dispatchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function upsertIntegrationConnection(
  db: SqlExecutor,
  input: {
    organizationId: string;
    clinicId?: string | null;
    provider: string;
    status?: "ACTIVE" | "DISABLED" | "ERROR";
    capabilities?: Record<string, unknown>;
    secretRef?: string | null;
    metadata?: Record<string, unknown>;
    lastVerifiedAt?: Date | null;
  },
) {
  const provider = requiredToken(input.provider, "provider");
  const clinicId = input.clinicId ?? null;
  await assertClinicScope(db, input.organizationId, clinicId);

  const existing = await db.$queryRawUnsafe<ConnectionRow[]>(
    `SELECT * FROM "IntegrationConnection"
     WHERE "organizationId" = $1 AND "provider" = $2
       AND "clinicId" IS NOT DISTINCT FROM $3
     LIMIT 1`,
    input.organizationId,
    provider,
    clinicId,
  );

  if (existing[0]) {
    const updated = await db.$queryRawUnsafe<ConnectionRow[]>(
      `UPDATE "IntegrationConnection"
       SET "status" = $2,
           "capabilities" = $3::jsonb,
           "secretRef" = $4,
           "metadata" = $5::jsonb,
           "lastVerifiedAt" = $6,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1
       RETURNING *`,
      existing[0].id,
      input.status ?? existing[0].status,
      json(input.capabilities ?? asRecord(existing[0].capabilities)),
      input.secretRef === undefined ? existing[0].secretRef : input.secretRef,
      json(input.metadata ?? asRecord(existing[0].metadata)),
      input.lastVerifiedAt === undefined
        ? existing[0].lastVerifiedAt
        : input.lastVerifiedAt,
    );
    return updated[0]!;
  }

  const rows = await db.$queryRawUnsafe<ConnectionRow[]>(
    `INSERT INTO "IntegrationConnection"
      ("id", "organizationId", "clinicId", "provider", "status", "capabilities", "secretRef", "metadata", "lastVerifiedAt")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
     RETURNING *`,
    randomUUID(),
    input.organizationId,
    clinicId,
    provider,
    input.status ?? "ACTIVE",
    json(input.capabilities ?? {}),
    input.secretRef ?? null,
    json(input.metadata ?? {}),
    input.lastVerifiedAt ?? null,
  );
  return rows[0]!;
}

export async function createExternalReference(
  db: SqlExecutor,
  input: {
    organizationId: string;
    clinicId?: string | null;
    connectionId?: string | null;
    provider: string;
    entityType: string;
    internalId: string;
    externalId: string;
    metadata?: Record<string, unknown>;
  },
) {
  const provider = requiredToken(input.provider, "provider");
  const entityType = requiredToken(input.entityType, "entityType");
  const internalId = requiredToken(input.internalId, "internalId");
  const externalId = requiredToken(input.externalId, "externalId");
  const clinicId = input.clinicId ?? null;
  const connectionId = input.connectionId ?? null;
  await assertConnectionScope(db, {
    organizationId: input.organizationId,
    clinicId,
    connectionId,
    provider,
  });

  const existingExternal = await db.$queryRawUnsafe<ExternalReferenceRow[]>(
    `SELECT * FROM "ExternalReference"
     WHERE "organizationId" = $1 AND "provider" = $2 AND "entityType" = $3
       AND "connectionId" IS NOT DISTINCT FROM $4 AND "externalId" = $5
     LIMIT 1`,
    input.organizationId,
    provider,
    entityType,
    connectionId,
    externalId,
  );
  if (existingExternal[0]) {
    if (existingExternal[0].internalId !== internalId) {
      throw new IntegrationScopeError("integration-external-reference-conflict");
    }
    return existingExternal[0];
  }

  const existingInternal = await db.$queryRawUnsafe<ExternalReferenceRow[]>(
    `SELECT * FROM "ExternalReference"
     WHERE "organizationId" = $1 AND "provider" = $2 AND "entityType" = $3
       AND "connectionId" IS NOT DISTINCT FROM $4 AND "internalId" = $5
     LIMIT 1`,
    input.organizationId,
    provider,
    entityType,
    connectionId,
    internalId,
  );
  if (existingInternal[0]) {
    if (existingInternal[0].externalId !== externalId) {
      throw new IntegrationScopeError("integration-internal-reference-conflict");
    }
    return existingInternal[0];
  }

  const rows = await db.$queryRawUnsafe<ExternalReferenceRow[]>(
    `INSERT INTO "ExternalReference"
      ("id", "organizationId", "clinicId", "connectionId", "provider", "entityType", "internalId", "externalId", "metadata")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING *`,
    randomUUID(),
    input.organizationId,
    clinicId,
    connectionId,
    provider,
    entityType,
    internalId,
    externalId,
    json(input.metadata ?? {}),
  );
  return rows[0]!;
}

export async function acceptIntegrationInbox(
  db: SqlExecutor,
  input: {
    organizationId: string;
    clinicId?: string | null;
    connectionId?: string | null;
    provider: string;
    externalEventId: string;
    eventType: string;
    payload?: Record<string, unknown>;
  },
) {
  const provider = requiredToken(input.provider, "provider");
  const externalEventId = requiredToken(input.externalEventId, "externalEventId");
  const eventType = requiredToken(input.eventType, "eventType");
  const clinicId = input.clinicId ?? null;
  const connectionId = input.connectionId ?? null;
  await assertConnectionScope(db, {
    organizationId: input.organizationId,
    clinicId,
    connectionId,
    provider,
  });

  const payload = input.payload ?? {};
  const payloadJson = json(payload);
  const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
  const inserted = await db.$queryRawUnsafe<InboxRow[]>(
    `INSERT INTO "IntegrationInbox"
      ("id", "organizationId", "clinicId", "connectionId", "provider", "externalEventId", "eventType", "payload", "payloadHash")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    randomUUID(),
    input.organizationId,
    clinicId,
    connectionId,
    provider,
    externalEventId,
    eventType,
    payloadJson,
    payloadHash,
  );

  if (inserted[0]) {
    return { event: inserted[0], duplicate: false } as const;
  }

  const existing = await db.$queryRawUnsafe<InboxRow[]>(
    `SELECT * FROM "IntegrationInbox"
     WHERE "organizationId" = $1 AND "provider" = $2
       AND "connectionId" IS NOT DISTINCT FROM $3 AND "externalEventId" = $4
     LIMIT 1`,
    input.organizationId,
    provider,
    connectionId,
    externalEventId,
  );
  if (!existing[0]) throw new Error("Integration inbox dedupe lookup failed");
  if (existing[0].payloadHash !== payloadHash) {
    throw new IntegrationScopeError("integration-inbox-payload-conflict");
  }
  return { event: existing[0], duplicate: true } as const;
}

export async function processIntegrationInbox<T>(
  db: PrismaClient,
  inboxId: string,
  handler: (tx: Prisma.TransactionClient, event: IntegrationInboxEnvelope) => Promise<T>,
  options: { maxAttempts?: number; retryDelayMs?: number } = {},
) {
  const maxAttempts = options.maxAttempts ?? 5;
  const retryDelayMs = options.retryDelayMs ?? 1_000;

  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<InboxRow[]>(
        `SELECT * FROM "IntegrationInbox" WHERE "id" = $1 FOR UPDATE`,
        inboxId,
      );
      const event = rows[0];
      if (!event) throw new IntegrationScopeError("integration-inbox-not-found");
      if (event.status === "PROCESSED") {
        return { status: "already_processed", result: null as T | null } as const;
      }
      if (event.status === "FAILED") {
        return { status: "failed", result: null as T | null } as const;
      }
      if (event.availableAt.getTime() > Date.now()) {
        return { status: "retry_pending", result: null as T | null } as const;
      }

      await tx.$executeRawUnsafe(
        `UPDATE "IntegrationInbox"
         SET "status" = 'PROCESSING', "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1`,
        inboxId,
      );

      const result = await handler(tx, event);
      await tx.$executeRawUnsafe(
        `UPDATE "IntegrationInbox"
         SET "status" = 'PROCESSED',
             "attempts" = "attempts" + 1,
             "processedAt" = CURRENT_TIMESTAMP,
             "lastErrorCode" = NULL,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1`,
        inboxId,
      );
      return { status: "processed", result } as const;
    });
  } catch (error) {
    const errorCode = safeErrorCode(error, "integration-handler-failed");
    const retryAt = new Date(Date.now() + retryDelayMs);
    const failedRows = await db.$queryRawUnsafe<
      Array<{ id: string; organizationId: string; attempts: number; status: string }>
    >(
      `UPDATE "IntegrationInbox"
       SET "attempts" = "attempts" + 1,
           "status" = CASE WHEN "attempts" + 1 >= $2 THEN 'FAILED' ELSE 'RETRY' END,
           "availableAt" = CASE WHEN "attempts" + 1 >= $2 THEN "availableAt" ELSE $3 END,
           "lastErrorCode" = $4,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "status" <> 'PROCESSED'
       RETURNING "id", "organizationId", "attempts", "status"`,
      inboxId,
      maxAttempts,
      retryAt,
      errorCode,
    );
    if (failedRows[0]) {
      await writeSystemAudit(db, {
        organizationId: failedRows[0].organizationId,
        action:
          failedRows[0].status === "FAILED"
            ? "integration.inbox_failed"
            : "integration.inbox_retry_scheduled",
        entityType: "IntegrationInbox",
        entityId: failedRows[0].id,
        metadata: {
          attempts: failedRows[0].attempts,
          status: failedRows[0].status,
          errorCode,
        },
      });
    }
    throw error;
  }
}

export async function enqueueIntegrationOutbox(
  db: SqlExecutor,
  input: {
    organizationId: string;
    clinicId?: string | null;
    topic: string;
    eventType: string;
    aggregateType?: string | null;
    aggregateId?: string | null;
    payload?: Record<string, unknown>;
    dedupeKey?: string | null;
    availableAt?: Date;
  },
) {
  const clinicId = input.clinicId ?? null;
  await assertClinicScope(db, input.organizationId, clinicId);
  const topic = requiredToken(input.topic, "topic");
  const eventType = requiredToken(input.eventType, "eventType");
  const dedupeKey = input.dedupeKey?.trim() || null;

  const inserted = await db.$queryRawUnsafe<OutboxRow[]>(
    `INSERT INTO "IntegrationOutbox"
      ("id", "organizationId", "clinicId", "topic", "eventType", "aggregateType", "aggregateId", "payload", "dedupeKey", "availableAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    randomUUID(),
    input.organizationId,
    clinicId,
    topic,
    eventType,
    input.aggregateType ?? null,
    input.aggregateId ?? null,
    json(input.payload ?? {}),
    dedupeKey,
    input.availableAt ?? new Date(),
  );
  if (inserted[0]) return { event: inserted[0], duplicate: false } as const;
  if (!dedupeKey) throw new Error("Integration outbox insert failed without dedupe key");

  const existing = await db.$queryRawUnsafe<OutboxRow[]>(
    `SELECT * FROM "IntegrationOutbox"
     WHERE "organizationId" = $1 AND "topic" = $2 AND "dedupeKey" = $3
     LIMIT 1`,
    input.organizationId,
    topic,
    dedupeKey,
  );
  if (!existing[0]) throw new Error("Integration outbox dedupe lookup failed");
  return { event: existing[0], duplicate: true } as const;
}

export async function dispatchIntegrationOutbox(
  db: PrismaClient,
  transport: IntegrationOutboxTransport,
  options: {
    limit?: number;
    maxAttempts?: number;
    retryDelayMs?: number;
    staleLockMs?: number;
  } = {},
): Promise<OutboxDispatchResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const maxAttempts = options.maxAttempts ?? 5;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const staleLockMs = options.staleLockMs ?? 5 * 60_000;
  const lockToken = randomUUID();
  const staleBefore = new Date(Date.now() - staleLockMs);
  const claimed = await db.$queryRawUnsafe<OutboxRow[]>(
    `WITH picked AS (
       SELECT "id"
       FROM "IntegrationOutbox"
       WHERE (("status" IN ('PENDING', 'RETRY') AND "availableAt" <= CURRENT_TIMESTAMP)
          OR ("status" = 'PROCESSING' AND "lockedAt" < $3))
       ORDER BY "createdAt"
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE "IntegrationOutbox" AS outbox
     SET "status" = 'PROCESSING',
         "attempts" = outbox."attempts" + 1,
         "lockToken" = $2,
         "lockedAt" = CURRENT_TIMESTAMP,
         "updatedAt" = CURRENT_TIMESTAMP
     FROM picked
     WHERE outbox."id" = picked."id"
     RETURNING outbox.*`,
    limit,
    lockToken,
    staleBefore,
  );

  const result: OutboxDispatchResult = {
    claimed: claimed.length,
    sent: 0,
    retried: 0,
    failed: 0,
  };

  for (const event of claimed) {
    try {
      await transport(event);
      await db.$executeRawUnsafe(
        `UPDATE "IntegrationOutbox"
         SET "status" = 'SENT',
             "dispatchedAt" = CURRENT_TIMESTAMP,
             "lockToken" = NULL,
             "lockedAt" = NULL,
             "lastErrorCode" = NULL,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "lockToken" = $2 AND "status" = 'PROCESSING'`,
        event.id,
        lockToken,
      );
      result.sent += 1;
    } catch (error) {
      const terminal = event.attempts >= maxAttempts;
      const errorCode = safeErrorCode(error, "integration-dispatch-failed");
      await db.$executeRawUnsafe(
        `UPDATE "IntegrationOutbox"
         SET "status" = $3,
             "availableAt" = $4,
             "lockToken" = NULL,
             "lockedAt" = NULL,
             "lastErrorCode" = $5,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "lockToken" = $2 AND "status" = 'PROCESSING'`,
        event.id,
        lockToken,
        terminal ? "FAILED" : "RETRY",
        terminal ? event.availableAt : new Date(Date.now() + retryDelayMs),
        errorCode,
      );
      await writeSystemAudit(db, {
        organizationId: event.organizationId,
        action: terminal
          ? "integration.outbox_failed"
          : "integration.outbox_retry_scheduled",
        entityType: "IntegrationOutbox",
        entityId: event.id,
        metadata: {
          topic: event.topic,
          eventType: event.eventType,
          attempts: event.attempts,
          status: terminal ? "FAILED" : "RETRY",
          errorCode,
        },
      });
      if (terminal) result.failed += 1;
      else result.retried += 1;
    }
  }

  return result;
}

export class IntegrationScopeError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "IntegrationScopeError";
  }
}

async function assertConnectionScope(
  db: SqlExecutor,
  input: {
    organizationId: string;
    clinicId: string | null;
    connectionId: string | null;
    provider: string;
  },
) {
  await assertClinicScope(db, input.organizationId, input.clinicId);
  if (!input.connectionId) return;

  const rows = await db.$queryRawUnsafe<ConnectionRow[]>(
    `SELECT * FROM "IntegrationConnection" WHERE "id" = $1 LIMIT 1`,
    input.connectionId,
  );
  const connection = rows[0];
  if (!connection) throw new IntegrationScopeError("integration-connection-not-found");
  if (
    connection.organizationId !== input.organizationId ||
    connection.provider !== input.provider ||
    (input.clinicId && connection.clinicId && connection.clinicId !== input.clinicId)
  ) {
    throw new IntegrationScopeError("integration-tenant-mismatch");
  }
}

async function assertClinicScope(
  db: SqlExecutor,
  organizationId: string,
  clinicId: string | null,
) {
  if (!clinicId) return;
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "Clinic" WHERE "id" = $1 AND "organizationId" = $2 LIMIT 1`,
    clinicId,
    organizationId,
  );
  if (!rows[0]) throw new IntegrationScopeError("integration-tenant-mismatch");
}

async function writeSystemAudit(
  db: SqlExecutor,
  input: {
    organizationId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
) {
  await db.$executeRawUnsafe(
    `INSERT INTO "AuditLog"
      ("id", "organizationId", "actorId", "action", "entityType", "entityId", "metadata", "createdAt")
     VALUES ($1, $2, NULL, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP)`,
    randomUUID(),
    input.organizationId,
    input.action,
    input.entityType,
    input.entityId,
    json(input.metadata),
  );
}

function requiredToken(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new IntegrationScopeError(`integration-${label}-missing`);
  return normalized;
}

function json(value: unknown) {
  return JSON.stringify(value ?? {});
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeErrorCode(error: unknown, fallback: string) {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return /^[a-z0-9_.:-]{1,120}$/i.test(candidate) ? candidate : fallback;
}
