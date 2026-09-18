import { randomUUID } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const { purgeOrganization } = await import("../src/lib/organization-purge.ts");
const { createPatientFileStage } = await import("../src/infrastructure/patient-files/staging.ts");
const {
  createPatientFilePurgeManifests,
  reconcilePatientFilePurgeManifests,
} = await import("../src/infrastructure/patient-files/purge-manifest.ts");
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const token = randomUUID().replaceAll("-", "");
let organizationId = null;
let objectPath = null;
const committedObjectPaths = [];
const namespaceObjectPaths = [];

try {
  const organization = await prisma.organization.create({
    data: { name: `QA purge ${token}`, slug: `qa-purge-${token.slice(0, 20)}` },
  });
  organizationId = organization.id;
  const chain = await prisma.chain.create({
    data: { organizationId, name: `QA chain ${token}` },
  });
  const clinic = await prisma.clinic.create({
    data: {
      organizationId,
      chainId: chain.id,
      name: `QA clinic ${token}`,
      city: "Ho Chi Minh City",
      address: "QA only",
    },
  });
  const owner = await prisma.user.create({
    data: {
      organizationId,
      email: `qa-purge-${token}@example.test`,
      fullName: "QA purge owner",
      passwordHash: "qa-only",
      role: "OWNER",
      active: true,
      mustChangePassword: true,
    },
  });
  const patient = await prisma.patient.create({
    data: {
      organizationId,
      clinicId: clinic.id,
      fullName: "QA purge patient",
      phone: `090${token.slice(0, 8)}`,
    },
  });
  const patientFileId = randomUUID();
  const storagePrefix = `patient-files/${safe(organizationId)}/${safe(patient.id)}/${safe(patientFileId)}-`;
  const storageKey = `${storagePrefix}orphan.pdf`;
  objectPath = localPath(storageKey);
  await mkdir(path.dirname(objectPath), { recursive: true });
  await writeFile(objectPath, Buffer.from("%PDF-purge-smoke\n"), { flag: "wx" });
  await createPatientFileStage(prisma, {
    id: randomUUID(),
    organizationId,
    clinicId: clinic.id,
    patientId: patient.id,
    uploadedById: owner.id,
    targetPatientFileId: patientFileId,
    fileName: "orphan.pdf",
    mimeType: "application/pdf",
    sizeBytes: 18,
    storageProvider: "local",
    storageKey: storagePrefix,
    gcAfter: new Date(0),
  });

  const committedFileId = randomUUID();
  const committedKey = `patient-files/${safe(organizationId)}/${safe(patient.id)}/${safe(committedFileId)}-committed.pdf`;
  const committedPath = localPath(committedKey);
  committedObjectPaths.push(committedPath);
  await mkdir(path.dirname(committedPath), { recursive: true });
  await writeFile(committedPath, Buffer.from("%PDF-committed-purge-smoke\n"), { flag: "wx" });
  await prisma.patientFile.create({
    data: {
      id: committedFileId,
      organizationId,
      clinicId: clinic.id,
      patientId: patient.id,
      uploadedById: owner.id,
      category: "QA_PURGE",
      title: "QA committed purge file",
      fileName: "committed.pdf",
      mimeType: "application/pdf",
      url: `/patient-files/${committedFileId}`,
      sizeBytes: 27,
      sourceType: "LOCAL_UPLOAD",
      sourceId: committedKey,
      storageProvider: "local",
      storageKey: committedKey,
      virusScanStatus: "CLEAN",
    },
  });

  const avatarKey = `staff-profile/${safe(organizationId)}/${safe(owner.id)}/${safe(owner.id)}-avatar.png`;
  const learningKey = `learning-assets/${safe(organizationId)}/qa-content/${safe(token)}-asset.pdf`;
  const accountingKey = `accounting-attachments/${safe(organizationId)}/qa-entry/${safe(token)}-attachment.pdf`;
  for (const key of [avatarKey, learningKey, accountingKey]) {
    const filePath = localPath(key);
    namespaceObjectPaths.push(filePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(`%PDF-${key}\n`), { flag: "wx" });
  }
  await prisma.staffProfile.create({
    data: {
      organizationId,
      userId: owner.id,
      clinicId: clinic.id,
      employeeCode: `QA-${token.slice(0, 12)}`,
      avatarFileName: "avatar.png",
      avatarMimeType: "image/png",
      avatarSizeBytes: 12,
      avatarStorageProvider: "local",
      avatarStorageKey: avatarKey,
    },
  });
  const learningContent = await prisma.learningContent.create({
    data: {
      organizationId,
      clinicId: clinic.id,
      code: `QA-${token.slice(0, 12)}`,
      type: "ARTICLE",
      title: "QA purge content",
    },
  });
  await prisma.learningAsset.create({
    data: {
      organizationId,
      clinicId: clinic.id,
      contentId: learningContent.id,
      uploadedById: owner.id,
      kind: "DOCUMENT",
      title: "QA learning asset",
      fileName: "asset.pdf",
      mimeType: "application/pdf",
      url: "/learning-assets/qa",
      sizeBytes: 12,
      storageProvider: "local",
      storageKey: learningKey,
    },
  });
  const accountingCategory = await prisma.accountingCategory.create({
    data: { organizationId, code: `QA-${token.slice(0, 12)}`, name: "QA purge", kind: "EXPENSE" },
  });
  await prisma.accountingEntry.create({
    data: {
      organizationId,
      clinicId: clinic.id,
      categoryId: accountingCategory.id,
      kind: "EXPENSE",
      amount: 1,
      occurredAt: new Date(),
      description: "QA purge attachment",
      attachmentFileName: "attachment.pdf",
      attachmentMimeType: "application/pdf",
      attachmentSizeBytes: 12,
      attachmentStorageProvider: "local",
      attachmentStorageKey: accountingKey,
    },
  });

  await purgeOrganization(organizationId);
  assert(!(await exists(objectPath)), "organization purge removes staged-only objects");
  assert(!(await exists(committedPath)), "organization purge removes committed objects");
  for (const filePath of namespaceObjectPaths) {
    assert(!(await exists(filePath)), "organization purge removes non-patient object namespaces");
  }
  const remainingManifests = await prisma.$queryRawUnsafe(
    `SELECT "id", "state" FROM "PatientFilePurgeManifest" WHERE "organizationId" = $1`,
    organizationId,
  );
  assert(
    remainingManifests.length > 0 && remainingManifests.every((manifest) => manifest.state === "DELETED"),
    "organization purge records deleted object manifests",
  );

  const retryManifestIds = await createPatientFilePurgeManifests(prisma, [
    {
      organizationId: `qa-retry-${token}`,
      storageProvider: "local",
      storageKey: "patient-files/qa-retry-missing-object",
      previewStorageKey: null,
      thumbnailStorageKey: null,
    },
  ]);
  const failedRetry = await reconcilePatientFilePurgeManifests(
    prisma,
    async () => {
      throw new Error("qa-object-store-temporary-failure");
    },
    { ids: retryManifestIds, retryDelayMs: 1 },
  );
  assert(failedRetry.failed === 1, "purge manifest records a retryable object failure");
  await prisma.$executeRawUnsafe(
    `UPDATE "PatientFilePurgeManifest" SET "availableAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
    retryManifestIds[0],
  );
  const successfulRetry = await reconcilePatientFilePurgeManifests(
    prisma,
    async () => {},
    { ids: retryManifestIds },
  );
  assert(successfulRetry.deleted === 1, "purge manifest retries successfully");
  assert(
    !(await prisma.organization.findUnique({ where: { id: organizationId } })),
    "organization purge removes the disposable organization",
  );
  console.log("ok organization purge smoke");
} finally {
  if (organizationId) {
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
  }
  if (objectPath) await unlink(objectPath).catch(() => {});
  await Promise.all(committedObjectPaths.map((filePath) => unlink(filePath).catch(() => {})));
  await Promise.all(namespaceObjectPaths.map((filePath) => unlink(filePath).catch(() => {})));
  await prisma.$executeRawUnsafe(
    `DELETE FROM "PatientFilePurgeManifest" WHERE "organizationId" LIKE $1`,
    `qa-retry-${token}%`,
  ).catch(() => {});
  await prisma.$disconnect();
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
  if (!condition) throw new Error(`Organization purge smoke failed: ${label}`);
  console.log(`ok ${label}`);
}
