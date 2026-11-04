import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createRequire } from "node:module";

if (process.argv.includes("--unit")) {
  await integrityRegressions();
  process.exit(0);
}
if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Requires NODE_ENV=test and a disposable loopback database.");
}

const {
  createPatientFileStage,
  getPatientFileStage,
  markPatientFileStageCommitted,
  markPatientFileStageGcPending,
  markPatientFileStageStored,
  reconcilePatientFileStages,
} = await import("../src/infrastructure/patient-files/staging.ts");
const { enqueueIntegrationOutbox, dispatchIntegrationOutbox } = await import(
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
let organizationId;

try {
  const organization = await prisma.organization.create({ data: { name: `Synthetic file lifecycle ${randomUUID()}` } });
  organizationId = organization.id;
  const clinic = await prisma.clinic.create({ data: { organizationId, name: "Synthetic clinic", city: "Test", address: "Test" } });
  const owner = await prisma.user.create({
    data: { organizationId, email: `file-lifecycle-${randomUUID()}@example.test`, fullName: "Synthetic owner", role: "OWNER", passwordHash: "test-only" },
  });
  const patient = await prisma.patient.create({
    data: { organizationId, clinicId: clinic.id, fullName: "Synthetic patient", phone: "0000000000" },
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
  const observer = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    assert(Boolean(await getPatientFileStage(observer, orphanStageId)), "stage is committed and visible on a separate connection before upload");
  } finally { await observer.$disconnect(); }

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

  // A slow first provider must not leave the second event's lease to expire.
  const slowTopic = `${outboxTopic}-slow`;
  for (let index = 0; index < 2; index++) await enqueueIntegrationOutbox(prisma, {
    organizationId, topic: slowTopic, eventType: "qa.slow", payload: { index },
  });
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  let firstCalls = 0;
  const first = dispatchIntegrationOutbox(prisma, async () => { firstCalls++; entered(); await gate; }, { topic: slowTopic, staleLockMs: 150 });
  await started;
  let competitor;
  try {
    await new Promise((resolve) => setTimeout(resolve, 450));
    competitor = await dispatchIntegrationOutbox(prisma, async () => { throw new Error("duplicate provider call"); }, { topic: slowTopic, staleLockMs: 150 });
  } finally { release(); }
  const firstResult = await first;
  assert(competitor.claimed === 0 && firstResult.sent === 2 && firstCalls === 2, "PostgreSQL heartbeat protects the entire queued outbox batch");

  const stolenTopic = `${outboxTopic}-stolen`;
  const stolenEvent = await enqueueIntegrationOutbox(prisma, { organizationId, topic: stolenTopic, eventType: "qa.stolen" });
  const stolenResult = await dispatchIntegrationOutbox(prisma, async () => {
    await prisma.$executeRawUnsafe(`UPDATE "IntegrationOutbox" SET "lockToken" = 'other-worker' WHERE "id" = $1`, stolenEvent.event.id);
  }, { topic: stolenTopic });
  assert(stolenResult.sent === 0 && stolenResult.lostLease === 1, "stale outbox owner cannot finalize another worker's event");

  const lostStage = await createPatientFileStage(prisma, {
    id: randomUUID(), organizationId, clinicId: clinic.id, patientId: patient.id,
    targetPatientFileId: randomUUID(), fileName: "lost.pdf", mimeType: "application/pdf", sizeBytes: 10,
    storageProvider: "local", storageKey: `patient-files/${organizationId}/${patient.id}/lost-`, gcAfter: new Date(0),
  });
  stageIds.push(lostStage.id);
  const lostGc = await reconcilePatientFileStages(prisma, async (stage) => {
    await prisma.$executeRawUnsafe(`UPDATE "PatientFileObjectStage" SET "lastErrorCode" = 'gc-lease:other-worker' WHERE "id" = $1`, stage.id);
  }, { organizationId });
  assert(lostGc.deleted === 0 && lostGc.lostLease === 1, "stale staged GC owner cannot finalize another worker's lease");

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
  if (organizationId) {
    await (await import("../src/lib/organization-purge.ts")).purgeOrganization(organizationId);
    await prisma.$executeRawUnsafe(`DELETE FROM "PatientFilePurgeManifest" WHERE "organizationId" = $1`, organizationId);
  }
  await prisma.$disconnect();
  await (await import("../src/lib/prisma.ts")).prisma.$disconnect();
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

async function integrityRegressions() {
  const require = createRequire(import.meta.url);
  const check = require("node:assert/strict");
  const { load } = require("./audit-source-loader.cjs");
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "file-integrity-test-"));
  const timers = { setInterval: () => ({ unref() {} }), clearInterval() {} };
  try {
    // Exercise the actual dispatcher with deterministic heartbeat failures and stale CAS results.
    for (const scenario of ["healthy", "heartbeat-error", "stolen", "sent-cas-lost", "retry-cas-lost"]) {
      let tick;
      let renewFails = false;
      let sends = 0;
      let audits = 0;
      let renewedBatch = false;
      const events = ["one", "two"].map((id) => ({ id, organizationId: "org", attempts: 1, availableAt: new Date() }));
      const db = {
        async $transaction(fn) { return fn(db); },
        async $queryRawUnsafe(sql, ids) {
          if (sql.includes("WITH picked")) return events;
          renewedBatch ||= ids.length === 2;
          if (renewFails) throw new Error("database temporarily unavailable with private details");
          return scenario === "stolen" ? [] : ids.map((id) => ({ id }));
        },
        async $executeRawUnsafe(sql) {
          if (sql.includes('INSERT INTO "AuditLog"')) { audits++; return 1; }
          return scenario.endsWith("cas-lost") ? 0 : 1;
        },
      };
      const { dispatchIntegrationOutbox } = load("src/infrastructure/integrations/substrate.ts", {}, {
        setInterval(fn) { tick = fn; return { unref() {} }; }, clearInterval() {},
      });
      const result = await dispatchIntegrationOutbox(db, async () => {
        sends++;
        if (scenario === "heartbeat-error") { renewFails = true; tick(); await Promise.resolve(); }
        if (scenario === "retry-cas-lost") throw new Error("provider failed");
      }, { topic: "test", staleLockMs: 60 });
      check.ok(renewedBatch, "renew leases for every waiting batch event");
      if (scenario === "healthy") check.equal(result.sent, 2);
      else {
        check.equal(result.sent, 0);
        check.equal(result.lostLease, 2);
        check.equal(audits, 0, "a lost owner cannot audit a retry");
      }
      if (scenario === "stolen") check.equal(sends, 0);
      if (scenario === "heartbeat-error") check.equal(sends, 1, "uncertain queued leases never invoke providers");
    }
    console.log("ok outbox batch renewal, caught heartbeat errors, ownership and CAS counters");

    const emptyDb = { $queryRawUnsafe() { throw new Error("must not drain a global queue"); } };
    const manifests = load("src/infrastructure/patient-files/purge-manifest.ts", {}, timers);
    check.equal((await manifests.reconcilePatientFilePurgeManifests(emptyDb, async () => {}, { ids: [] })).claimed, 0);
    let persistedError;
    const manifestDb = {
      async $queryRawUnsafe(sql, ids) { return sql.includes("WITH picked") ? [{ id: "manifest", organizationId: "deleted-org" }] : ids.map((id) => ({ id })); },
      async $executeRawUnsafe(sql, ...args) { if (sql.includes('"state" = \'PENDING\'')) persistedError = args[2]; return 1; },
    };
    const failed = await manifests.reconcilePatientFilePurgeManifests(manifestDb, async () => {
      throw new Error("patient name and private storage path must not be persisted");
    }, { ids: ["manifest"] });
    check.equal(failed.failed, 1);
    check.equal(persistedError, "patient-file-purge-failed");
    console.log("ok empty purge selection and PHI-free persisted cleanup errors");

    const saved = [];
    const storageMocks = {
      "@aws-sdk/client-s3": require("@aws-sdk/client-s3"),
      "sharp": require("sharp"),
      "@/lib/env": { patientFileStorageDriver: () => "local", patientFileStorageRoot: () => storageRoot, r2StorageConfig: () => null },
      "@/lib/prisma": { prisma: {
        organization: { findUnique: async () => ({ isDemo: false }) },
        $executeRawUnsafe: async (_sql, ...args) => { saved.push(args); return 1; },
      } },
    };
    const { storePatientUpload } = load("src/lib/patient-file-storage.ts", storageMocks);
    const bytes = Buffer.from("%PDF-1.7 synthetic protected file\n");
    const upload = (streams) => {
      let calls = 0;
      return { name: "test.pdf", type: "application/pdf", size: bytes.length,
        slice: (...args) => new Blob([bytes]).slice(...args),
        stream: () => new Blob([streams[Math.min(calls++, streams.length - 1)]]).stream(),
      };
    };
    const store = (file) => storePatientUpload({ file, organizationId: "org", patientId: "patient", patientFileId: randomUUID() });
    await check.rejects(store(upload([Buffer.concat([bytes, bytes])])), /size-mismatch/);
    await check.rejects(store(upload([bytes.subarray(0, 10)])), /size-mismatch/);
    await check.rejects(store(upload([bytes, Buffer.concat([bytes, bytes])])), /size-mismatch/);
    const changed = Buffer.from(bytes); changed[changed.length - 2] ^= 1;
    await check.rejects(store(upload([bytes, changed])), /checksum-mismatch/);
    const actualFiles = async () => (await fs.readdir(storageRoot, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
    check.equal((await actualFiles()).length, 0, "failed stream writes must not leave PHI on disk");
    console.log("ok upload actual byte bounds, truncated streams, changed streams and partial-file cleanup");

    // Fail after the thumbnail has actually been written, and fail object deletion.
    // Both the successful preview and the partial failed write must be recoverable.
    const partialMocks = { ...storageMocks, "node:fs/promises": { ...fs,
      async writeFile(target, data, options) {
        await fs.writeFile(target, data, options);
        if (target.endsWith("-thumbnail.webp")) throw new Error("write failed after creating partial object");
      },
      async unlink(target) {
        if (await fs.access(target).then(() => true, () => false)) throw Object.assign(new Error("private disk path"), { code: "EACCES" });
        return fs.unlink(target);
      },
    } };
    const partialStorage = load("src/lib/patient-file-storage.ts", partialMocks);
    const png = await require("sharp")({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    await check.rejects(partialStorage.storePatientUpload({ file: new File([png], "test.png", { type: "image/png" }), organizationId: "org", patientId: "patient", patientFileId: randomUUID() }));
    check.ok(saved.some((row) => row[3].endsWith("-preview.webp")));
    check.ok(saved.some((row) => row[3].endsWith("-thumbnail.webp")), "partial failed variant is persisted for retry");
    console.log("ok failed preview/thumbnail deletion creates durable manifests for every attempted object");

    let opened = 0;
    const file = { id: "file", organizationId: "org", patientId: "patient", sourceId: "legacy-key", blocked: false };
    const route = load("src/app/(app)/patient-files/[fileId]/route.ts", {
      "@/lib/auth": { requireSession: async () => ({ organizationId: "org" }) },
      "@/lib/audit": { writeAuditLog: async () => {} },
      "@/lib/resource-policy": { getAuthorizedPatientFile: async () => file },
      "@/lib/prisma": { prisma: { patientFile: { findFirst: async () => ({ sourceType: "R2_UPLOAD", retentionUntil: new Date(0) }) } } },
      "@/lib/patient-file-storage": { openStoredPatientFileStream: async () => { opened++; } },
    }, { Request, Response, Headers });
    const expired = await route.GET(new Request("http://localhost/patient-files/file"), { params: Promise.resolve({ fileId: "file" }) });
    check.equal(expired.status, 404);
    check.equal(expired.headers.get("cache-control"), "private, no-store");
    check.equal(opened, 0);
    console.log("ok expired files are denied before opening protected storage");
  } finally {
    // This directory is a newly created test-owned child of the OS temp directory.
    check.ok(path.resolve(storageRoot).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
}
