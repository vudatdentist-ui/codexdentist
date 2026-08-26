import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

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
) {
  if (input.sizeBytes < 0) throw new Error("patient-file-stage-invalid-size");
  await assertPatientScope(db, input);
  await assertUploaderScope(db, input.organizationId, input.uploadedById ?? null);

  const rows = await db.$queryRawUnsafe<PatientFileStageRow[]>(
    `INSERT INTO "PatientFileObjectStage"
      ("id", "organizationId", "clinicId", "patientId", "uploadedById", "targetPatientFileId",
       "fileName", "mimeType", "sizeBytes", "storageProvider", "storageKey",
       "previewStorageKey", "thumbnailStorageKey", "gcAfter")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
         "storedAt" = CURRENT_TIMESTAMP,
         "lastErrorCode" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP
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
         "committedAt" = CURRENT_TIMESTAMP,
         "lastErrorCode" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP
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
         "gcAfter" = CURRENT_TIMESTAMP,
         "lastErrorCode" = $2,
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "state" IN ('STAGED', 'GC_PENDING')
     RETURNING *`,
    stageId,
    safeErrorCode(errorCode),
  );
  return rows[0] ?? null;
}

export async function reconcilePatientFileStages(
  db: PrismaClient,
  deleteObjects: DeletePatientFileStageObjects,
  options: { limit?: number; retryDelayMs?: number } = {},
) {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  const claimed = await db.$queryRawUnsafe<PatientFileStageRow[]>(
    `WITH picked AS (
       SELECT "id"
       FROM "PatientFileObjectStage"
       WHERE "state" IN ('STAGED', 'GC_PENDING')
         AND "gcAfter" <= CURRENT_TIMESTAMP
       ORDER BY "createdAt"
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE "PatientFileObjectStage" AS stage
     SET "state" = 'GC_PENDING', "updatedAt" = CURRENT_TIMESTAMP
     FROM picked
     WHERE stage."id" = picked."id" AND stage."state" <> 'COMMITTED'
     RETURNING stage.*`,
    limit,
  );

  let deleted = 0;
  let failed = 0;
  for (const stage of claimed) {
    try {
      await deleteObjects(stage);
      await db.$executeRawUnsafe(
        `UPDATE "PatientFileObjectStage"
         SET "state" = 'DELETED',
             "deletedAt" = CURRENT_TIMESTAMP,
             "lastErrorCode" = NULL,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "state" = 'GC_PENDING'`,
        stage.id,
      );
      await writeStageAudit(db, stage, "patient_file.stage_deleted", null);
      deleted += 1;
    } catch (error) {
      const errorCode = safeUnknownErrorCode(error, "patient-file-gc-failed");
      await db.$executeRawUnsafe(
        `UPDATE "PatientFileObjectStage"
         SET "gcAfter" = $2,
             "lastErrorCode" = $3,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "state" = 'GC_PENDING'`,
        stage.id,
        new Date(Date.now() + retryDelayMs),
        errorCode,
      );
      await writeStageAudit(db, stage, "patient_file.stage_gc_retry", errorCode);
      failed += 1;
    }
  }

  return { claimed: claimed.length, deleted, failed };
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
     VALUES ($1, $2, NULL, $3, 'PatientFileObjectStage', $4, $5::jsonb, CURRENT_TIMESTAMP)`,
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

function safeUnknownErrorCode(error: unknown, fallback: string) {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return /^[a-z0-9_.:-]{1,120}$/i.test(candidate) ? candidate : fallback;
}
