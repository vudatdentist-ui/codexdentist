import { File } from "node:buffer";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const { createJourneyCommentCommand } = await import(
  "../src/lib/application/journey/commands.ts"
);
const { deletePatientFileStageObjects } = await import(
  "../src/infrastructure/patient-files/object-gc.ts"
);

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const body = `Phase2 staged journey upload ${suffix}`;
let createdCommentId = null;
let createdFileId = null;
let createdStage = null;

try {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.JOURNEY_FILE_OWNER_EMAIL ?? "owner@nhavista.vn" },
    select: {
      id: true,
      email: true,
      fullName: true,
      organizationId: true,
      role: true,
    },
  });
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: owner.organizationId },
    select: { id: true, name: true, slug: true, domain: true },
  });
  const clinic = await prisma.clinic.findFirstOrThrow({
    where: { organizationId: owner.organizationId },
    select: { id: true, name: true, city: true },
  });
  const patient = await prisma.patient.findFirstOrThrow({
    where: { organizationId: owner.organizationId, clinicId: clinic.id },
    select: { id: true },
  });

  const session = {
    sessionId: `phase2-${suffix}`,
    userId: owner.id,
    email: owner.email,
    fullName: owner.fullName,
    role: owner.role,
    roles: [owner.role],
    roleAssignments: [
      {
        role: owner.role,
        organizationId: owner.organizationId,
        clinicId: null,
      },
    ],
    organizationId: owner.organizationId,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    organizationDomain: organization.domain,
    isDemo: false,
    workspaceExpiresAt: null,
    clinicIds: [clinic.id],
    clinics: [clinic],
    activeClinicId: clinic.id,
    expiresAt: Date.now() + 60_000,
  };

  const file = new File(
    [Buffer.from("%PDF-1.4\n% Phase2 staged journey upload\n")],
    `phase2-${suffix}.pdf`,
    { type: "application/pdf" },
  );

  const result = await createJourneyCommentCommand(session, {
    patientId: patient.id,
    body,
    files: [file],
  });
  createdCommentId = result.commentId;

  const comment = await prisma.journeyComment.findUniqueOrThrow({
    where: { id: createdCommentId },
    select: { id: true, patientFileId: true },
  });
  assert(Boolean(comment.patientFileId), "journey comment links committed PatientFile");
  createdFileId = comment.patientFileId;

  const patientFile = await prisma.patientFile.findUniqueOrThrow({
    where: { id: createdFileId },
    select: {
      id: true,
      organizationId: true,
      clinicId: true,
      patientId: true,
      storageProvider: true,
      storageKey: true,
      checksumSha256: true,
    },
  });
  assert(patientFile.patientId === patient.id, "committed PatientFile retains patient scope");
  assert(patientFile.organizationId === owner.organizationId, "committed PatientFile retains tenant scope");
  assert(Boolean(patientFile.storageKey), "committed PatientFile has storage key");
  assert(/^[a-f0-9]{64}$/.test(patientFile.checksumSha256 ?? ""), "committed PatientFile has checksum");

  const stages = await prisma.$queryRawUnsafe(
    `SELECT * FROM "PatientFileObjectStage" WHERE "committedPatientFileId" = $1`,
    patientFile.id,
  );
  createdStage = stages[0] ?? null;
  assert(createdStage?.state === "COMMITTED", "Journey command moves stage to COMMITTED");
  assert(createdStage?.targetPatientFileId === patientFile.id, "stage target matches PatientFile");
  assert(createdStage?.storedAt, "stage records completed object write");
  assert(createdStage?.committedAt, "stage records domain commit");

  const outbox = await prisma.$queryRawUnsafe(
    `SELECT "id", "status", "eventType", "aggregateId"
     FROM "IntegrationOutbox"
     WHERE "organizationId" = $1
       AND "topic" = 'patient-files'
       AND "aggregateId" = $2`,
    owner.organizationId,
    patientFile.id,
  );
  assert(outbox.length === 1, "Journey command writes one patient-file outbox event");
  assert(outbox[0].eventType === "patient_file.committed", "Journey command writes committed event type");
  assert(outbox[0].status === "PENDING", "committed file outbox starts pending");

  const audit = await prisma.auditLog.findFirst({
    where: {
      organizationId: owner.organizationId,
      action: "journey.comment_created",
      entityId: comment.id,
    },
    select: { id: true },
  });
  assert(Boolean(audit), "Journey staged upload remains auditable");

  console.log("ok phase2 journey file command smoke");
} finally {
  if (createdFileId) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "IntegrationOutbox" WHERE "aggregateId" = $1`,
      createdFileId,
    ).catch(() => {});
  }
  if (createdCommentId) {
    await prisma.journeyCommentAttachment.deleteMany({
      where: { journeyCommentId: createdCommentId },
    }).catch(() => {});
    await prisma.journeyComment.delete({ where: { id: createdCommentId } }).catch(() => {});
    await prisma.auditLog.deleteMany({
      where: { entityId: createdCommentId },
    }).catch(() => {});
  }
  if (createdStage) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "PatientFileObjectStage" WHERE "id" = $1`,
      createdStage.id,
    ).catch(() => {});
  }
  if (createdFileId) {
    await prisma.patientFile.delete({ where: { id: createdFileId } }).catch(() => {});
  }
  if (createdStage) {
    await deletePatientFileStageObjects(createdStage).catch(() => {});
    if (createdStage.storageProvider === "local" && createdStage.storageKey) {
      await unlink(localPath(createdStage.storageKey)).catch(() => {});
    }
  }
  await prisma.$disconnect();
}

function localPath(storageKey) {
  return path.resolve(
    process.env.PATIENT_FILE_STORAGE_ROOT ?? path.join(process.cwd(), "storage", "patient-files"),
    storageKey.replace(/^patient-files\//, ""),
  );
}

function assert(condition, label) {
  if (!condition) throw new Error(`Phase2 journey file command smoke failed: ${label}`);
  console.log(`ok ${label}`);
}
