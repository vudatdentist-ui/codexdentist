import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const {
  createPatientFileStage,
  getPatientFileStage,
  markPatientFileStageCommitted,
  markPatientFileStageGcPending,
  markPatientFileStageStored,
} = await import("../src/infrastructure/patient-files/staging.ts");
const { enqueueIntegrationOutbox } = await import(
  "../src/infrastructure/integrations/substrate.ts"
);
const { reconcileStagedPatientFiles } = await import(
  "../src/infrastructure/patient-files/reconcile-runtime.ts"
);

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const createdPaths = [];
const stageIds = [];
const patientFileIds = [];
const outboxTopic = `qa-file-stage-${randomUUID()}`;

try {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.FILE_LIFECYCLE_OWNER_EMAIL ?? "owner@nhavista.vn" },
    select: { id: true, organizationId: true },
  });
  const patient = await prisma.patient.findFirstOrThrow({
    where: { organizationId: owner.organizationId },
    select: { id: true, clinicId: true, organizationId: true },
  });

  const orphanStageId = randomUUID();
  const orphanFileId = randomUUID();
  stageIds.push(orphanStageId);
  const orphanPrefix = patientFilePrefix(patient.organizationId, patient.id, orphanFileId);
  const orphanStage = await createPatientFileStage(prisma, {
    id: orphanStageId,
    organizationId: patient.organizationId,
    clinicId: patient.clinicId,
    patientId: patient.id,
    uploadedById: owner.id,
    targetPatientFileId: orphanFileId,
    fileName: "orphan.pdf",
    mimeType: "application/pdf",
    sizeBytes: 18,
    storageProvider: "local",
    storageKey: orphanPrefix,
    gcAfter: new Date(Date.now() + 60_000),
  });
  assert(orphanStage.state === "STAGED", "stage exists before object write");

  const orphanKey = `${orphanPrefix}${randomUUID()}.pdf`;
  const orphanPath = localPath(orphanKey);
  createdPaths.push(orphanPath);
  await mkdir(path.dirname(orphanPath), { recursive: true });
  await writeFile(orphanPath, Buffer.from("%PDF-orphan-stage\n"), { flag: "wx" });
  assert(await exists(orphanPath), "simulated orphan object written after stage");

  await markPatientFileStageGcPending(
    prisma,
    orphanStageId,
    "patient-file-domain-commit-failed",
  );
  const beforeGc = await getPatientFileStage(prisma, orphanStageId);
  assert(beforeGc?.state === "GC_PENDING", "failed domain sequence is discoverable");

  const gcResult = await runGc(patient.organizationId);
  assert(gcResult.deleted >= 1, "GC deletes pending staged objects");
  assert(!(await exists(orphanPath)), "orphan object removed by prefix reconciliation");
  const afterGc = await getPatientFileStage(prisma, orphanStageId);
  assert(afterGc?.state === "DELETED", "stage marked deleted after reconciliation");

  const retryStageId = randomUUID();
  const retryFileId = randomUUID();
  stageIds.push(retryStageId);
  const retryPrefix = patientFilePrefix(patient.organizationId, patient.id, retryFileId);
  await createPatientFileStage(prisma, {
    id: retryStageId,
    organizationId: patient.organizationId,
    clinicId: patient.clinicId,
    patientId: patient.id,
    uploadedById: owner.id,
    targetPatientFileId: retryFileId,
    fileName: "retry.pdf",
    mimeType: "application/pdf",
    sizeBytes: 17,
    storageProvider: "local",
    storageKey: retryPrefix,
    gcAfter: new Date(0),
  });
  await prisma.$executeRawUnsafe(
    `UPDATE "PatientFileObjectStage" SET "storageProvider" = 'unsupported', "state" = 'GC_PENDING', "gcAfter" = CURRENT_TIMESTAMP WHERE "id" = $1`,
    retryStageId,
  );
  const failedGc = await runGc(patient.organizationId);
  assert(failedGc.failed >= 1, "GC failure remains retryable");
  const retryPending = await getPatientFileStage(prisma, retryStageId);
  assert(retryPending?.state === "GC_PENDING", "failed GC keeps pending state");
  const retryAudit = await prisma.auditLog.findFirst({
    where: {
      organizationId: patient.organizationId,
      action: "patient_file.stage_gc_retry",
      entityId: retryStageId,
    },
  });
  assert(Boolean(retryAudit), "GC retry is auditable");

  const retryKey = `${retryPrefix}${randomUUID()}.pdf`;
  const retryPath = localPath(retryKey);
  createdPaths.push(retryPath);
  await mkdir(path.dirname(retryPath), { recursive: true });
  await writeFile(retryPath, Buffer.from("%PDF-retry-stage\n"), { flag: "wx" });
  await prisma.$executeRawUnsafe(
    `UPDATE "PatientFileObjectStage" SET "storageProvider" = 'local', "gcAfter" = CURRENT_TIMESTAMP WHERE "id" = $1`,
    retryStageId,
  );
  const retriedGc = await runGc(patient.organizationId);
  assert(retriedGc.deleted >= 1, "failed GC can be retried successfully");
  assert(!(await exists(retryPath)), "retry reconciliation removes staged object");

  const committedStageId = randomUUID();
  const committedFileId = randomUUID();
  stageIds.push(committedStageId);
  patientFileIds.push(committedFileId);
  const committedPrefix = patientFilePrefix(
    patient.organizationId,
    patient.id,
    committedFileId,
  );
  const committedKey = `${committedPrefix}${randomUUID()}.pdf`;
  const committedPath = localPath(committedKey);
  createdPaths.push(committedPath);
  const committedBytes = Buffer.from("%PDF-committed-stage\n");
  await createPatientFileStage(prisma, {
    id: committedStageId,
    organizationId: patient.organizationId,
    clinicId: patient.clinicId,
    patientId: patient.id,
    uploadedById: owner.id,
    targetPatientFileId: committedFileId,
    fileName: "committed.pdf",
    mimeType: "application/pdf",
    sizeBytes: committedBytes.length,
    storageProvider: "local",
    storageKey: committedPrefix,
    gcAfter: new Date(0),
  });
  await mkdir(path.dirname(committedPath), { recursive: true });
  await writeFile(committedPath, committedBytes, { flag: "wx" });
  await markPatientFileStageStored(prisma, {
    stageId: committedStageId,
    checksumSha256: createHash("sha256").update(committedBytes).digest("hex"),
    storageKey: committedKey,
  });

  await prisma.$transaction(async (tx) => {
    await tx.patientFile.create({
      data: {
        id: committedFileId,
        organizationId: patient.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        uploadedById: owner.id,
        category: "QA_PHASE2",
        title: "QA Phase2 committed file",
        fileName: "committed.pdf",
        mimeType: "application/pdf",
        url: `/patient-files/${committedFileId}`,
        sizeBytes: committedBytes.length,
        sourceType: "LOCAL_UPLOAD",
        sourceId: committedKey,
        storageProvider: "local",
        storageKey: committedKey,
        checksumSha256: createHash("sha256").update(committedBytes).digest("hex"),
        virusScanStatus: "NOT_SCANNED",
      },
    });
    await markPatientFileStageCommitted(tx, committedStageId, committedFileId);
    await enqueueIntegrationOutbox(tx, {
      organizationId: patient.organizationId,
      clinicId: patient.clinicId,
      topic: outboxTopic,
      eventType: "patient_file.committed",
      aggregateType: "PatientFile",
      aggregateId: committedFileId,
      dedupeKey: `patient-file:${committedFileId}:committed`,
      payload: { patientId: patient.id, patientFileId: committedFileId },
    });
  });

  const committedStage = await getPatientFileStage(prisma, committedStageId);
  assert(committedStage?.state === "COMMITTED", "patient file stage commits with domain record");
  const committedOutbox = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "IntegrationOutbox" WHERE "topic" = $1 AND "aggregateId" = $2`,
    outboxTopic,
    committedFileId,
  );
  assert(committedOutbox.length === 1, "file commit and outbox persisted atomically");

  await runGc(patient.organizationId);
  assert(await exists(committedPath), "GC never deletes committed patient file object");
  const stillCommitted = await getPatientFileStage(prisma, committedStageId);
  assert(stillCommitted?.state === "COMMITTED", "committed stage remains committed after GC");

  await prisma.patientFile.update({
    where: { id: committedFileId },
    data: { retentionUntil: new Date(0) },
  });
  const committedExpiredGc = await runGc(patient.organizationId);
  assert(committedExpiredGc.expired >= 1, "committed expired patient file is claimed");
  assert(!(await exists(committedPath)), "committed expired object is removed");
  const deletedCommittedStage = await getPatientFileStage(prisma, committedStageId);
  assert(deletedCommittedStage?.state === "DELETED", "committed expired stage is deleted");
  assert(
    !(await prisma.patientFile.findUnique({ where: { id: committedFileId } })),
    "committed expired patient file record is removed",
  );

  const expiredFileId = randomUUID();
  patientFileIds.push(expiredFileId);
  const expiredKey = patientFilePrefix(
    patient.organizationId,
    patient.id,
    expiredFileId,
  ) + "expired.pdf";
  const expiredPath = localPath(expiredKey);
  createdPaths.push(expiredPath);
  await mkdir(path.dirname(expiredPath), { recursive: true });
  await writeFile(expiredPath, Buffer.from("%PDF-expired-file\n"), { flag: "wx" });
  await prisma.patientFile.create({
    data: {
      id: expiredFileId,
      organizationId: patient.organizationId,
      clinicId: patient.clinicId,
      patientId: patient.id,
      uploadedById: owner.id,
      category: "QA_PHASE2",
      title: "QA expired patient file",
      fileName: "expired.pdf",
      mimeType: "application/pdf",
      url: `/patient-files/${expiredFileId}`,
      sizeBytes: 18,
      sourceType: "LOCAL_UPLOAD",
      sourceId: expiredKey,
      storageProvider: "local",
      storageKey: expiredKey,
      retentionUntil: new Date(0),
      virusScanStatus: "CLEAN",
    },
  });
  const expiredGc = await runGc(patient.organizationId);
  assert(expiredGc.expired >= 1, "expired patient file is claimed for deletion");
  assert(!(await exists(expiredPath)), "expired patient file object is removed");
  assert(
    !(await prisma.patientFile.findUnique({ where: { id: expiredFileId } })),
    "expired patient file record is removed",
  );
  const expiredStage = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "PatientFileObjectStage" WHERE "targetPatientFileId" = $1 LIMIT 1`,
    expiredFileId,
  );
  if (expiredStage[0]?.id) stageIds.push(expiredStage[0].id);
  const expiredAudit = await prisma.auditLog.findFirst({
    where: { action: "patient_file.expired_deleted", entityId: expiredFileId },
  });
  assert(Boolean(expiredAudit), "expired patient file deletion is audited");

  console.log("ok phase2 patient file lifecycle smoke");
} finally {
  await prisma.$executeRawUnsafe(`DELETE FROM "IntegrationOutbox" WHERE "topic" = $1`, outboxTopic).catch(() => {});
  await prisma.auditLog.deleteMany({
    where: {
      entityType: "PatientFileObjectStage",
      entityId: { in: stageIds },
    },
  }).catch(() => {});
  if (stageIds.length) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "PatientFileObjectStage" WHERE "id" = ANY($1::text[])`,
      stageIds,
    ).catch(() => {});
  }
  if (patientFileIds.length) {
    await prisma.patientFile.deleteMany({ where: { id: { in: patientFileIds } } }).catch(() => {});
  }
  await Promise.all(createdPaths.map((filePath) => unlink(filePath).catch(() => {})));
  await prisma.$disconnect();
}

async function runGc(organizationId) {
  return reconcileStagedPatientFiles({ organizationId });
}

function patientFilePrefix(organizationId, patientId, patientFileId) {
  return `patient-files/${safe(organizationId)}/${safe(patientId)}/${safe(patientFileId)}-`;
}

function localPath(storageKey) {
  return path.resolve(
    process.env.PATIENT_FILE_STORAGE_ROOT ?? path.join(process.cwd(), "storage", "patient-files"),
    storageKey.replace(/^patient-files\//, ""),
  );
}

function safe(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

async function exists(filePath) {
  return access(filePath).then(() => true).catch(() => false);
}

function assert(condition, label) {
  if (!condition) throw new Error(`Phase2 file lifecycle smoke failed: ${label}`);
  console.log(`ok ${label}`);
}
