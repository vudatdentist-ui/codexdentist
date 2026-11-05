import { safeErrorCode as safeUnknownErrorCode } from "@/shared/error-codes";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { startObjectGcLease } from "@/infrastructure/patient-files/gc-lease";

type SqlExecutor = Pick<
  PrismaClient,
  "$executeRawUnsafe" | "$queryRawUnsafe"
> | Prisma.TransactionClient;

export type PatientFileStageRow = {
  id: string;
  organizationId: string;
  clinicId: string;
  patientId: string;
  uploadedById: string | null;
  targetPatientFileId: string;
  committedPatientFileId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  storageKey: string;
  previewStorageKey: string | null;
  thumbnailStorageKey: string | null;
  checksumSha256: string | null;
  state: "STAGED" | "COMMITTED" | "GC_PENDING" | "DELETED";
  storedAt: Date | null;
  committedAt: Date | null;
  gcAfter: Date;
  lastErrorCode: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DeletePatientFileStageObjects = (
  stage: Pick<
    PatientFileStageRow,
    | "id"
    | "organizationId"
    | "storageProvider"
    | "storageKey"
    | "previewStorageKey"
    | "thumbnailStorageKey"
  >,
) => Promise<void>;

export async function createPatientFileStage(
  db: PrismaClient,
  input: Parameters<typeof createPatientFileStageInTransaction>[1],
): Promise<PatientFileStageRow> {
  // This API returns only after the discoverable pre-upload stage has committed.
  return db.$transaction((tx) => createPatientFileStageInTransaction(tx, input));
}

/** Use only for callers explicitly managing their own pre-upload transaction. */
export async function createPatientFileStageInTransaction(
  db: SqlExecutor,
  input: {
    id: string;
    organizationId: string;
    clinicId: string;
    patientId: string;
    uploadedById?: string | null;
    targetPatientFileId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storageProvider: "local" | "r2";
    storageKey: string;
    previewStorageKey?: string | null;
    thumbnailStorageKey?: string | null;
    gcAfter?: Date;
  },
): Promise<PatientFileStageRow> {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) throw new Error("patient-file-stage-invalid-size");
  await db.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    `patient-file-organization:${input.organizationId}`,
  );
  await assertPatientScope(db, input);
  await assertUploaderScope(db, input.organizationId, input.uploadedById ?? null);

  const rows = await db.$queryRawUnsafe<PatientFileStageRow[]>(
    `INSERT INTO "PatientFileObjectStage"
      ("id", "organizationId", "clinicId", "patientId", "uploadedById", "targetPatientFileId",
       "fileName", "mimeType", "sizeBytes", "storageProvider", "storageKey",
       "previewStorageKey", "thumbnailStorageKey", "gcAfter", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
     RETURNING *`,
    input.id,
    input.organizationId,
    input.clinicId,
    input.patientId,
    input.uploadedById ?? null,
    input.targetPatientFileId,
    input.fileName,
    input.mimeType,
    input.sizeBytes,
    input.storageProvider,
    input.storageKey,
    input.previewStorageKey ?? null,
    input.thumbnailStorageKey ?? null,
    input.gcAfter ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
  );
  return rows[0]!;
}

export async function markPatientFileStageStored(
  db: SqlExecutor,
  input: {
    stageId: string;
    checksumSha256: string;
    storageKey: string;
    previewStorageKey?: string | null;
    thumbnailStorageKey?: string | null;
  },
) {
  const rows = await db.$queryRawUnsafe<PatientFileStageRow[]>(
    `UPDATE "PatientFileObjectStage"
     SET "checksumSha256" = $2,
         "storageKey" = $3,
         "previewStorageKey" = $4,
         "thumbnailStorageKey" = $5,
         "storedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
         "lastErrorCode" = NULL,
         "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     WHERE "id" = $1 AND "state" = 'STAGED'
     RETURNING *`,
    input.stageId,
    input.checksumSha256,
    input.storageKey,
    input.previewStorageKey ?? null,
    input.thumbnailStorageKey ?? null,
  );
  if (!rows[0]) throw new Error("patient-file-stage-not-staged");
  return rows[0];
}

export async function markPatientFileStageCommitted(
  db: SqlExecutor,
  stageId: string,
  patientFileId: string,
) {
  const rows = await db.$queryRawUnsafe<PatientFileStageRow[]>(
    `UPDATE "PatientFileObjectStage" AS stage
     SET "state" = 'COMMITTED',
         "committedPatientFileId" = $2,
         "committedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
         "lastErrorCode" = NULL,
         "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     WHERE stage."id" = $1
       AND stage."state" = 'STAGED'
       AND stage."targetPatientFileId" = $2
       AND stage."storedAt" IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM "PatientFile" AS file
         WHERE file."id" = $2
           AND file."organizationId" = stage."organizationId"
           AND file."clinicId" = stage."clinicId"
           AND file."patientId" = stage."patientId"
       )
     RETURNING stage.*`,
    stageId,
    patientFileId,
  );
  if (!rows[0]) throw new Error("patient-file-stage-commit-mismatch");
  return rows[0];
}

export async function markPatientFileStageGcPending(
  db: SqlExecutor,
  stageId: string,
  errorCode: string,
) {
  const rows = await db.$queryRawUnsafe<PatientFileStageRow[]>(
    `UPDATE "PatientFileObjectStage"
     SET "state" = 'GC_PENDING',
         "gcAfter" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
         "lastErrorCode" = $2,
         "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     WHERE "id" = $1 AND ("state" = 'STAGED'
       OR ("state" = 'GC_PENDING' AND "lastErrorCode" NOT LIKE 'gc-lease:%'))
     RETURNING *`,
    stageId,
    safeErrorCode(errorCode),
  );
  return rows[0] ?? null;
}

export async function reconcilePatientFileStages(
  db: PrismaClient,
  deleteObjects: DeletePatientFileStageObjects,
  options: { limit?: number; retryDelayMs?: number; organizationId?: string; leaseMs?: number } = {},
) {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  const leaseMs = Math.max(30, options.leaseMs ?? Math.max(retryDelayMs, 60_000));
  const leaseToken = `gc-lease:${randomUUID()}`;
  const claimed = await db.$queryRawUnsafe<PatientFileStageRow[]>(
    `WITH picked AS (
       SELECT "id"
       FROM "PatientFileObjectStage"
       WHERE "state" IN ('STAGED', 'GC_PENDING')
         AND "gcAfter" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
         AND ($4::text IS NULL OR "organizationId" = $4)
       ORDER BY "createdAt"
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE "PatientFileObjectStage" AS stage
     SET "state" = 'GC_PENDING',
         "gcAfter" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + ($2 * INTERVAL '1 millisecond'),
         "lastErrorCode" = $3,
         "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     FROM picked
     WHERE stage."id" = picked."id" AND stage."state" <> 'COMMITTED'
     RETURNING stage.*`,
    limit,
    leaseMs,
    leaseToken,
    options.organizationId ?? null,
  );
  if (!claimed.length) return { claimed: 0, deleted: 0, failed: 0, lostLease: 0 };

  let deleted = 0;
  let failed = 0;
  let lostLease = 0;
  const lease = startObjectGcLease(db, "PatientFileObjectStage", claimed.map((row) => row.id), leaseToken, leaseMs);
  try {
    for (const stage of claimed) {
      try {
        if (!(await lease.owns(stage.id))) { lostLease += 1; continue; }
        await deleteObjects(stage);
        if (!(await lease.owns(stage.id))) { lostLease += 1; continue; }
        const finalized = await db.$transaction(async (tx) => {
          const updated = await tx.$executeRawUnsafe(
            `UPDATE "PatientFileObjectStage"
             SET "state" = 'DELETED',
                 "deletedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
                 "lastErrorCode" = NULL,
                 "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
             WHERE "id" = $1 AND "state" = 'GC_PENDING' AND "lastErrorCode" = $2
               AND "gcAfter" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`,
            stage.id,
            leaseToken,
          );
          if (updated === 1) {
            await writeStageAudit(tx, stage, "patient_file.stage_deleted", null);
          }
          return updated;
        });
        if (finalized === 1) {
          deleted += 1;
        } else lostLease += 1;
      } catch (error) {
        if (!(await lease.owns(stage.id))) { lostLease += 1; continue; }
        const errorCode = safeUnknownErrorCode(error, "patient-file-gc-failed");
        const retried = await db.$transaction(async (tx) => {
         const updated = await tx.$executeRawUnsafe(
          `UPDATE "PatientFileObjectStage"
           SET "gcAfter" = $2,
               "lastErrorCode" = $3,
               "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
           WHERE "id" = $1 AND "state" = 'GC_PENDING' AND "lastErrorCode" = $4
             AND "gcAfter" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`,
          stage.id,
          new Date(Date.now() + retryDelayMs),
          errorCode,
          leaseToken,
        );
         if (updated === 1) await writeStageAudit(tx, stage, "patient_file.stage_gc_retry", errorCode);
         return updated;
        });
        if (retried === 1) {
          failed += 1;
        } else lostLease += 1;
      } finally {
        lease.release(stage.id);
      }
    }
  } finally { await lease.stop(); }

  return { claimed: claimed.length, deleted, failed, lostLease };
}

export async function stageExpiredPatientFiles(
  db: PrismaClient,
  options: { limit?: number; organizationId?: string } = {},
) {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      "patient-file-retention-global",
    );
    const expiredFiles = await tx.$queryRawUnsafe<ExpiredPatientFileRow[]>(
      `SELECT file.*,
              stage."id" AS "stageId",
              stage."state" AS "stageState",
              stage."storageProvider" AS "stageStorageProvider",
              stage."storageKey" AS "stageStorageKey"
       FROM "PatientFile" AS file
       LEFT JOIN "PatientFileObjectStage" AS stage
         ON stage."targetPatientFileId" = file."id"
       WHERE file."retentionUntil" IS NOT NULL
         AND file."retentionUntil" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
         AND ($2::text IS NULL OR file."organizationId" = $2)
       ORDER BY file."retentionUntil", file."createdAt"
       FOR UPDATE OF file SKIP LOCKED
       LIMIT $1`,
      limit,
      options.organizationId ?? null,
    );

    const stagedIds: string[] = [];
    for (const file of expiredFiles) {
      let stagedForObjectGc = false;
      if (!file.stageId && isObjectBackedPatientFile(file)) {
        const storageProvider = file.storageProvider ?? legacyStorageProvider(file.sourceType);
        const storageKey = file.storageKey ?? file.sourceId;
        if (!storageProvider || !storageKey) {
          throw new Error(`patient-file-retention-storage-key-missing:${file.id}`);
        }
        const stageId = randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO "PatientFileObjectStage"
            ("id", "organizationId", "clinicId", "patientId", "uploadedById",
             "targetPatientFileId", "fileName", "mimeType", "sizeBytes",
             "storageProvider", "storageKey", "previewStorageKey",
             "thumbnailStorageKey", "checksumSha256", "state", "storedAt",
             "gcAfter", "lastErrorCode", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   $14, 'GC_PENDING', $15, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), $16,
                   (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))`,
          stageId,
          file.organizationId,
          file.clinicId,
          file.patientId,
          file.uploadedById,
          file.id,
          file.fileName ?? file.title,
          file.mimeType ?? "application/octet-stream",
          file.sizeBytes ?? 0,
          storageProvider,
          storageKey,
          file.previewStorageKey,
          file.thumbnailStorageKey,
          file.checksumSha256,
          file.createdAt,
          "patient-file-retention-expired",
        );
        stagedIds.push(stageId);
        stagedForObjectGc = true;
      } else if (file.stageId && file.stageState !== "DELETED") {
        if (!isObjectStorageProvider(file.stageStorageProvider) || !file.stageStorageKey) {
          throw new Error(`patient-file-retention-stage-storage-invalid:${file.id}`);
        }
        await tx.$executeRawUnsafe(
          `UPDATE "PatientFileObjectStage"
           SET "state" = 'GC_PENDING',
               "gcAfter" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
               "lastErrorCode" = $2,
               "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
           WHERE "id" = $1 AND "state" <> 'DELETED'`,
          file.stageId,
          "patient-file-retention-expired",
        );
        stagedIds.push(file.stageId);
        stagedForObjectGc = true;
      }

      await tx.patientFile.delete({ where: { id: file.id } });
      await tx.auditLog.create({
        data: {
          organizationId: file.organizationId,
          actorId: null,
          action: "patient_file.expired_deleted",
          entityType: "PatientFile",
          entityId: file.id,
          metadata: {
            clinicId: file.clinicId,
            patientId: file.patientId,
            storageProvider: file.storageProvider,
            stagedForObjectGc,
            retentionUntil: file.retentionUntil.toISOString(),
          },
        },
      });
    }

    return { claimed: expiredFiles.length, staged: stagedIds.length };
  }, { timeout: 60_000 });
}

export async function getPatientFileStage(
  db: SqlExecutor,
  stageId: string,
) {
  const rows = await db.$queryRawUnsafe<PatientFileStageRow[]>(
    `SELECT * FROM "PatientFileObjectStage" WHERE "id" = $1 LIMIT 1`,
    stageId,
  );
  return rows[0] ?? null;
}

async function assertPatientScope(
  db: SqlExecutor,
  input: { organizationId: string; clinicId: string; patientId: string },
) {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "Patient"
     WHERE "id" = $1 AND "organizationId" = $2 AND "clinicId" = $3
     LIMIT 1`,
    input.patientId,
    input.organizationId,
    input.clinicId,
  );
  if (!rows[0]) throw new Error("patient-file-stage-tenant-mismatch");
}

type ExpiredPatientFileRow = {
  id: string;
  organizationId: string;
  clinicId: string;
  patientId: string;
  uploadedById: string | null;
  title: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  storageProvider: string | null;
  storageKey: string | null;
  sourceType: string | null;
  sourceId: string | null;
  previewStorageKey: string | null;
  thumbnailStorageKey: string | null;
  checksumSha256: string | null;
  retentionUntil: Date;
  createdAt: Date;
  stageId: string | null;
  stageState: string | null;
  stageStorageProvider: string | null;
  stageStorageKey: string | null;
};

function isObjectBackedPatientFile(file: ExpiredPatientFileRow) {
  if (file.sourceType === "EXTERNAL_URL") return false;
  return isObjectStorageProvider(file.storageProvider) || Boolean(file.storageKey || file.sourceId);
}

function legacyStorageProvider(sourceType: string | null) {
  return sourceType === "LOCAL_UPLOAD"
    ? "local"
    : sourceType === "R2_UPLOAD"
      ? "r2"
      : null;
}

function isObjectStorageProvider(provider: string | null): provider is "local" | "r2" {
  return provider === "local" || provider === "r2";
}

async function assertUploaderScope(
  db: SqlExecutor,
  organizationId: string,
  uploadedById: string | null,
) {
  if (!uploadedById) return;
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "User"
     WHERE "id" = $1 AND "organizationId" = $2
     LIMIT 1`,
    uploadedById,
    organizationId,
  );
  if (!rows[0]) throw new Error("patient-file-stage-uploader-mismatch");
}

async function writeStageAudit(
  db: SqlExecutor,
  stage: PatientFileStageRow,
  action: string,
  errorCode: string | null,
) {
  await db.$executeRawUnsafe(
    `INSERT INTO "AuditLog"
      ("id", "organizationId", "actorId", "action", "entityType", "entityId", "metadata", "createdAt")
     VALUES ($1, $2, NULL, $3, 'PatientFileObjectStage', $4, $5::jsonb, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))`,
    randomUUID(),
    stage.organizationId,
    action,
    stage.id,
    JSON.stringify({
      patientId: stage.patientId,
      targetPatientFileId: stage.targetPatientFileId,
      errorCode,
    }),
  );
}

function safeErrorCode(value: string) {
  return /^[a-z0-9_.:-]{1,120}$/i.test(value) ? value : "patient-file-stage-error";
}


