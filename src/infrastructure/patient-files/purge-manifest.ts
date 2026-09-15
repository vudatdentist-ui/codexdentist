import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

type SqlExecutor = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe"> | Prisma.TransactionClient;

export type PatientFilePurgeManifestRow = {
  id: string;
  organizationId: string;
  storageProvider: string;
  storageKey: string;
  previewStorageKey: string | null;
  thumbnailStorageKey: string | null;
  state: "PENDING" | "PROCESSING" | "DELETED";
  availableAt: Date;
  lastErrorCode: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PurgeObject = Pick<
  PatientFilePurgeManifestRow,
  "organizationId" | "storageProvider" | "storageKey" | "previewStorageKey" | "thumbnailStorageKey"
>;

export type DeletePurgeObject = (object: PurgeObject) => Promise<void>;

export async function createPatientFilePurgeManifests(
  db: SqlExecutor,
  objects: PurgeObject[],
) {
  const unique = new Map<string, PurgeObject>();
  for (const object of objects) {
    const key = [
      object.organizationId,
      object.storageProvider,
      object.storageKey,
      object.previewStorageKey ?? "",
      object.thumbnailStorageKey ?? "",
    ].join("\u0000");
    unique.set(key, object);
  }

  const ids: string[] = [];
  for (const object of unique.values()) {
    const id = randomUUID();
    await db.$executeRawUnsafe(
      `INSERT INTO "PatientFilePurgeManifest"
        ("id", "organizationId", "storageProvider", "storageKey", "previewStorageKey", "thumbnailStorageKey")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      id,
      object.organizationId,
      object.storageProvider,
      object.storageKey,
      object.previewStorageKey,
      object.thumbnailStorageKey,
    );
    ids.push(id);
  }
  return ids;
}

/**
 * The durable manifest is shared by every protected object namespace. The
 * legacy table name is kept for migration compatibility; callers should use
 * this neutral name for upload-failure cleanup outside PatientFile rows.
 */
export async function createStorageObjectPurgeManifests(
  db: SqlExecutor,
  objects: PurgeObject[],
) {
  return createPatientFilePurgeManifests(db, objects);
}

export async function reconcilePatientFilePurgeManifests(
  db: PrismaClient,
  deleteObject: DeletePurgeObject,
  options: { limit?: number; retryDelayMs?: number; organizationId?: string; ids?: string[] } = {},
) {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  const leaseMs = Math.max(retryDelayMs, 60_000);
  const leaseToken = `purge-lease:${randomUUID()}`;
  const claimed = await db.$queryRawUnsafe<PatientFilePurgeManifestRow[]>(
    `WITH picked AS (
       SELECT "id"
       FROM "PatientFilePurgeManifest"
       WHERE "state" IN ('PENDING', 'PROCESSING')
         AND "availableAt" <= CURRENT_TIMESTAMP
         AND ($4::text IS NULL OR "organizationId" = $4)
         AND ($5::text[] IS NULL OR "id" = ANY($5::text[]))
       ORDER BY "createdAt"
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE "PatientFilePurgeManifest" AS manifest
     SET "state" = 'PROCESSING',
         "availableAt" = CURRENT_TIMESTAMP + ($2 * INTERVAL '1 millisecond'),
         "lastErrorCode" = $3,
         "updatedAt" = CURRENT_TIMESTAMP
     FROM picked
     WHERE manifest."id" = picked."id"
     RETURNING manifest.*`,
    limit,
    leaseMs,
    leaseToken,
    options.organizationId ?? null,
    options.ids?.length ? options.ids : null,
  );

  let deleted = 0;
  let failed = 0;
  for (const manifest of claimed) {
    try {
      await deleteObject(manifest);
      deleted += await db.$transaction(async (tx) => {
        const finalized = await tx.$executeRawUnsafe(
          `UPDATE "PatientFilePurgeManifest"
           SET "state" = 'DELETED',
               "deletedAt" = CURRENT_TIMESTAMP,
               "lastErrorCode" = NULL,
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $1 AND "state" = 'PROCESSING' AND "lastErrorCode" = $2`,
          manifest.id,
          leaseToken,
        );
        if (finalized === 1) {
          const organization = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT "id" FROM "Organization" WHERE "id" = $1 LIMIT 1`,
            manifest.organizationId,
          );
          if (organization[0]) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "AuditLog"
                ("id", "organizationId", "actorId", "action", "entityType", "entityId", "metadata", "createdAt")
               VALUES ($1, $2, NULL, 'patient_file.purge_object_deleted',
                       'PatientFilePurgeManifest', $3, $4::jsonb, CURRENT_TIMESTAMP)`,
              randomUUID(),
              manifest.organizationId,
              manifest.id,
              JSON.stringify({
                storageProvider: manifest.storageProvider,
                storageKey: manifest.storageKey,
                previewStorageKey: manifest.previewStorageKey,
                thumbnailStorageKey: manifest.thumbnailStorageKey,
              }),
            );
          }
        }
        return finalized;
      });
    } catch (error) {
      const errorCode = safeErrorCode(error);
      failed += await db.$executeRawUnsafe(
        `UPDATE "PatientFilePurgeManifest"
         SET "state" = 'PENDING',
             "availableAt" = $2,
             "lastErrorCode" = $3,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "state" = 'PROCESSING' AND "lastErrorCode" = $4`,
        manifest.id,
        new Date(Date.now() + retryDelayMs),
        errorCode,
        leaseToken,
      );
    }
  }

  return { claimed: claimed.length, deleted, failed };
}

function safeErrorCode(error: unknown) {
  if (error instanceof Error && error.message) return error.message.slice(0, 240);
  return "patient-file-purge-failed";
}
