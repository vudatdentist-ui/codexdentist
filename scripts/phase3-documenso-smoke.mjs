import { File } from "node:buffer";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const {
  createDocumensoSigningEnvelope,
  documensoWebhookEventId,
  downloadDocumensoSignedPdf,
  verifyDocumensoWebhook,
} = await import("../src/integrations/documenso/client.ts");
const {
  acceptIntegrationInbox,
  createExternalReference,
  processIntegrationInbox,
  upsertIntegrationConnection,
} = await import("../src/infrastructure/integrations/substrate.ts");
const {
  referenceMetadata,
  updateExternalReferenceMetadata,
} = await import("../src/infrastructure/integrations/phase3-store.ts");
const {
  createPatientFileStage,
  getPatientFileStage,
  markPatientFileStageGcPending,
  markPatientFileStageStored,
  reconcilePatientFileStages,
} = await import("../src/infrastructure/patient-files/staging.ts");
const {
  currentPatientFileStorageProvider,
  deletePatientFileStageObjects,
  patientFileStageStoragePrefix,
} = await import("../src/infrastructure/patient-files/object-gc.ts");
const { storePatientUpload } = await import("../src/lib/patient-file-storage.ts");
const { reconcileSignedPatientFormCommand } = await import(
  "../src/lib/application/forms/provider-signing.ts"
);

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const suffix = randomUUID().replaceAll("-", "");
const createdFormIds = [];
const createdFileIds = [];
const stageIds = [];
let connectionId = null;

try {
  await verifyProviderAdapter();

  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.PHASE3_OWNER_EMAIL ?? "owner@nhavista.vn" },
    select: { id: true, organizationId: true },
  });
  const clinic = await prisma.clinic.findFirstOrThrow({
    where: { organizationId: owner.organizationId },
    select: { id: true },
  });
  const patient = await prisma.patient.findFirstOrThrow({
    where: { organizationId: owner.organizationId, clinicId: clinic.id },
    select: { id: true },
  });
  const template = await prisma.formTemplate.findFirst({
    where: {
      organizationId: owner.organizationId,
      requiresSignature: true,
      active: true,
      OR: [{ clinicId: null }, { clinicId: clinic.id }],
    },
    select: { id: true },
  }) ?? await prisma.formTemplate.create({
    data: {
      organizationId: owner.organizationId,
      clinicId: clinic.id,
      createdById: owner.id,
      type: "CONSENT",
      code: `P3-${suffix.slice(0, 12)}`,
      name: "Phase 3 consent smoke",
      version: "1.0",
      schema: { fields: [] },
      body: "Phase 3 consent smoke",
      requiresSignature: true,
      active: true,
    },
    select: { id: true },
  });

  const connection = await upsertIntegrationConnection(prisma, {
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    provider: "documenso",
    capabilities: { signing: true, webhooks: true },
    secretRef: "env:DOCUMENSO_CI",
    metadata: { mode: "phase3-smoke" },
  });
  connectionId = connection.id;

  const successForm = await createPatientForm(owner, clinic, patient, template, "success");
  const successEnvelopeId = `env-${suffix}-success`;
  const envelopeRef = await createExternalReference(prisma, {
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    connectionId: connection.id,
    provider: "documenso",
    entityType: "DOCUMENSO_ENVELOPE",
    internalId: successForm.id,
    externalId: successEnvelopeId,
    metadata: {
      patientFormId: successForm.id,
      patientId: patient.id,
      status: "PENDING",
    },
  });
  await createExternalReference(prisma, {
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    connectionId: connection.id,
    provider: "documenso",
    entityType: "DOCUMENSO_REQUEST",
    internalId: successForm.id,
    externalId: `request-${suffix}-success`,
    metadata: {
      patientFormId: successForm.id,
      sourcePatientFileId: `source-${suffix}`,
      status: "PENDING",
      envelopeId: successEnvelopeId,
    },
  });

  const successStored = await createStoredStage({
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    patientId: patient.id,
    label: "success",
  });
  const completedPayload = {
    event: "DOCUMENT_COMPLETED",
    payload: {
      envelopeId: successEnvelopeId,
      externalId: successForm.id,
      status: "COMPLETED",
      completedAt: "2026-09-02T03:00:00.000Z",
    },
    createdAt: "2026-09-02T03:00:01.000Z",
  };
  const inbox = await acceptIntegrationInbox(prisma, {
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    connectionId: connection.id,
    provider: "documenso",
    externalEventId: documensoWebhookEventId(completedPayload),
    eventType: completedPayload.event,
    payload: {
      event: completedPayload.event,
      envelopeId: successEnvelopeId,
      externalId: successForm.id,
      status: "COMPLETED",
    },
  });
  const processed = await processIntegrationInbox(
    prisma,
    inbox.event.id,
    async (tx) => {
      const reconciled = await reconcileSignedPatientFormCommand(tx, {
        organizationId: owner.organizationId,
        clinicId: clinic.id,
        patientId: patient.id,
        patientFormId: successForm.id,
        stageId: successStored.stageId,
        patientFileId: successStored.patientFileId,
        storedUpload: successStored.storedUpload,
        provider: "documenso",
        externalEnvelopeId: successEnvelopeId,
        completedAt: new Date(completedPayload.payload.completedAt),
      });
      await updateExternalReferenceMetadata(tx, envelopeRef.id, {
        ...referenceMetadata(envelopeRef),
        status: "SIGNED",
        patientFileId: successStored.patientFileId,
      });
      return reconciled;
    },
  );
  assert(processed.status === "processed", "Documenso completion inbox processes once");

  const formAfter = await prisma.patientForm.findUniqueOrThrow({
    where: { id: successForm.id },
    select: { status: true, signatureUrl: true, attachments: true },
  });
  assert(formAfter.status === "COMPLETED", "signed result completes Codex-owned PatientForm");
  assert(
    formAfter.signatureUrl === `/patient-files/${successStored.patientFileId}`,
    "PatientForm signature points to protected Codex patient file",
  );
  assert(
    formAfter.attachments.includes(`/patient-files/${successStored.patientFileId}`),
    "signed PatientForm records protected attachment",
  );
  const successStage = await getPatientFileStage(prisma, successStored.stageId);
  assert(successStage?.state === "COMMITTED", "signed PDF stage commits");
  const patientFile = await prisma.patientFile.findUnique({
    where: { id: successStored.patientFileId },
    select: { category: true, patientId: true, storageKey: true },
  });
  assert(patientFile?.category === "SIGNED_CONSENT", "signed PDF is a protected consent PatientFile");
  assert(patientFile?.patientId === patient.id, "signed PDF preserves patient scope");
  const journey = await prisma.journeyComment.findFirst({
    where: { patientFileId: successStored.patientFileId },
    select: { id: true },
  });
  assert(Boolean(journey), "signed consent appears in Journey timeline");
  const audit = await prisma.auditLog.findFirst({
    where: {
      action: "patient_form.signed_reconciled",
      entityId: successForm.id,
    },
    select: { id: true },
  });
  assert(Boolean(audit), "signed consent reconciliation is audited");
  const outbox = await prisma.$queryRawUnsafe(
    `SELECT "status" FROM "IntegrationOutbox"
     WHERE "topic" = 'patient-files' AND "aggregateId" = $1`,
    successStored.patientFileId,
  );
  assert(outbox.length === 1 && outbox[0].status === "PENDING", "signed PDF commit emits one atomic outbox event");

  let replayHandlerCalls = 0;
  const replay = await processIntegrationInbox(
    prisma,
    inbox.event.id,
    async () => {
      replayHandlerCalls += 1;
      return null;
    },
  );
  assert(replay.status === "already_processed", "duplicate Documenso event is idempotent");
  assert(replayHandlerCalls === 0, "duplicate Documenso event skips domain handler");

  const failedForm = await createPatientForm(owner, clinic, patient, template, "rollback");
  const failedStored = await createStoredStage({
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    patientId: patient.id,
    label: "rollback",
  });
  const failedInbox = await acceptIntegrationInbox(prisma, {
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    connectionId: connection.id,
    provider: "documenso",
    externalEventId: `phase3-doc-failure-${suffix}`,
    eventType: "DOCUMENT_COMPLETED",
    payload: { envelopeId: `env-${suffix}-rollback`, externalId: failedForm.id },
  });
  let transactionFailed = false;
  try {
    await processIntegrationInbox(
      prisma,
      failedInbox.event.id,
      async (tx) => {
        await reconcileSignedPatientFormCommand(tx, {
          organizationId: owner.organizationId,
          clinicId: clinic.id,
          patientId: patient.id,
          patientFormId: failedForm.id,
          stageId: failedStored.stageId,
          patientFileId: failedStored.patientFileId,
          storedUpload: failedStored.storedUpload,
          provider: "documenso",
          externalEnvelopeId: `env-${suffix}-rollback`,
        });
        throw Object.assign(new Error("phase3-forced-documenso-rollback"), {
          code: "phase3-forced-documenso-rollback",
        });
      },
      { retryDelayMs: 0 },
    );
  } catch {
    transactionFailed = true;
  }
  assert(transactionFailed, "Documenso reconciliation failure propagates for retry");
  const failedFormAfter = await prisma.patientForm.findUniqueOrThrow({
    where: { id: failedForm.id },
    select: { status: true, signatureUrl: true },
  });
  assert(failedFormAfter.status === "SENT" && !failedFormAfter.signatureUrl, "failed transaction rolls back consent state");
  assert(
    !(await prisma.patientFile.findUnique({ where: { id: failedStored.patientFileId } })),
    "failed transaction rolls back PatientFile",
  );
  assert(
    !(await prisma.journeyComment.findFirst({ where: { patientFileId: failedStored.patientFileId } })),
    "failed transaction rolls back Journey event",
  );
  await markPatientFileStageGcPending(
    prisma,
    failedStored.stageId,
    "documenso-signed-file-reconcile-failed",
  );
  const gcResult = await reconcilePatientFileStages(
    prisma,
    deletePatientFileStageObjects,
    { limit: 20, retryDelayMs: 0 },
  );
  assert(gcResult.deleted >= 1, "failed signed PDF is garbage-collected through staged lifecycle");
  const failedStage = await getPatientFileStage(prisma, failedStored.stageId);
  assert(failedStage?.state === "DELETED", "failed signed PDF stage is recoverably deleted");

  console.log("ok phase3 Documenso adapter and reconciliation smoke");
} finally {
  await cleanup();
  await prisma.$disconnect();
}

async function verifyProviderAdapter() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const signedPdf = Buffer.from("%PDF-1.4\n% Phase3 Documenso signed\n");
  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const target = String(url);
      if (target.endsWith("/envelope/create")) {
        const form = init.body;
        assert(form instanceof FormData, "Documenso create uses multipart FormData");
        const payload = JSON.parse(String(form.get("payload")));
        assert(payload.externalId === "form-opaque-id", "Documenso sends opaque form external id");
        assert(payload.recipients.length === 1, "Documenso sends only required signer recipient");
        assert(!JSON.stringify(payload).includes("090"), "Documenso request omits patient phone");
        return jsonResponse({ id: "env-test-1" });
      }
      if (target.endsWith("/envelope/distribute")) {
        return jsonResponse({
          recipients: [{ signingUrl: "https://sign.example.test/token" }],
        });
      }
      if (target.endsWith("/envelope/env-test-1")) {
        return jsonResponse({
          id: "env-test-1",
          status: "COMPLETED",
          envelopeItems: [{ id: "item-test-1" }],
        });
      }
      if (target.includes("/envelope/item/item-test-1/download?version=signed")) {
        return new Response(signedPdf, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": 'attachment; filename="signed-consent.pdf"',
          },
        });
      }
      throw new Error(`Unexpected Documenso mock URL: ${target}`);
    };

    const secrets = {
      apiToken: "test-token",
      webhookSecret: "test-webhook-secret",
      baseUrl: "http://documenso.test/api/v2",
    };
    const envelope = await createDocumensoSigningEnvelope(secrets, {
      externalId: "form-opaque-id",
      title: "Consent",
      pdfBytes: Buffer.from("%PDF-1.4\n% source\n"),
      fileName: "form-F-1.pdf",
      recipientEmail: "signer@example.test",
      recipientName: "Signer",
      redirectUrl: "https://codexdentist.test/forms",
    });
    assert(envelope.envelopeId === "env-test-1", "Documenso envelope create response is mapped");
    assert(envelope.signingUrl === "https://sign.example.test/token", "Documenso distribute signing URL is mapped");

    let invalidSecretDenied = false;
    try {
      verifyDocumensoWebhook(
        { event: "DOCUMENT_COMPLETED", payload: { envelopeId: "env-test-1" } },
        "wrong-secret",
        secrets.webhookSecret,
      );
    } catch (error) {
      invalidSecretDenied = error?.code === "documenso-webhook-secret-invalid";
    }
    assert(invalidSecretDenied, "Documenso invalid webhook secret is rejected");
    const verified = verifyDocumensoWebhook(
      { event: "DOCUMENT_COMPLETED", payload: { envelopeId: "env-test-1" } },
      secrets.webhookSecret,
      secrets.webhookSecret,
    );
    assert(verified.event === "DOCUMENT_COMPLETED", "Documenso valid webhook secret verifies");

    const downloaded = await downloadDocumensoSignedPdf(secrets, "env-test-1");
    assert(downloaded.bytes.equals(signedPdf), "Documenso signed PDF downloader returns exact bytes");
    assert(downloaded.fileName === "signed-consent.pdf", "Documenso signed PDF filename is sanitized");
    assert(calls.length === 4, "Documenso adapter uses envelope create/distribute/get/download flow");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function createPatientForm(owner, clinic, patient, template, label) {
  const form = await prisma.patientForm.create({
    data: {
      organizationId: owner.organizationId,
      clinicId: clinic.id,
      patientId: patient.id,
      templateId: template.id,
      requestedById: owner.id,
      formNo: `P3-${label}-${suffix.slice(0, 12)}`,
      status: "SENT",
      sentAt: new Date(),
    },
    select: { id: true },
  });
  createdFormIds.push(form.id);
  return form;
}

async function createStoredStage(input) {
  const stageId = randomUUID();
  const patientFileId = randomUUID();
  stageIds.push(stageId);
  createdFileIds.push(patientFileId);
  const storageProvider = currentPatientFileStorageProvider();
  const storagePrefix = patientFileStageStoragePrefix({
    organizationId: input.organizationId,
    patientId: input.patientId,
    patientFileId,
  });
  const bytes = Buffer.from(`%PDF-1.4\n% Phase3 ${input.label} signed consent\n`);
  await createPatientFileStage(prisma, {
    id: stageId,
    organizationId: input.organizationId,
    clinicId: input.clinicId,
    patientId: input.patientId,
    uploadedById: null,
    targetPatientFileId: patientFileId,
    fileName: `${input.label}-signed.pdf`,
    mimeType: "application/pdf",
    sizeBytes: bytes.byteLength,
    storageProvider,
    storageKey: storagePrefix,
  });
  const storedUpload = await storePatientUpload({
    file: new File([new Uint8Array(bytes)], `${input.label}-signed.pdf`, {
      type: "application/pdf",
    }),
    organizationId: input.organizationId,
    patientId: input.patientId,
    patientFileId,
  });
  await markPatientFileStageStored(prisma, {
    stageId,
    checksumSha256: storedUpload.checksumSha256,
    storageKey: storedUpload.storageKey,
    previewStorageKey: storedUpload.preview?.storageKey ?? null,
    thumbnailStorageKey: storedUpload.thumbnail?.storageKey ?? null,
  });
  return { stageId, patientFileId, storedUpload };
}

async function cleanup() {
  if (connectionId) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "IntegrationInbox" WHERE "connectionId" = $1`,
      connectionId,
    ).catch(() => {});
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ExternalReference" WHERE "connectionId" = $1`,
      connectionId,
    ).catch(() => {});
    await prisma.$executeRawUnsafe(
      `DELETE FROM "IntegrationConnection" WHERE "id" = $1`,
      connectionId,
    ).catch(() => {});
  }
  if (createdFileIds.length > 0) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "IntegrationOutbox" WHERE "aggregateId" = ANY($1::text[])`,
      createdFileIds,
    ).catch(() => {});
    await prisma.journeyComment.deleteMany({
      where: { patientFileId: { in: createdFileIds } },
    }).catch(() => {});
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...createdFileIds, ...createdFormIds] } },
    }).catch(() => {});
    await prisma.patientFile.deleteMany({ where: { id: { in: createdFileIds } } }).catch(() => {});
  }
  if (createdFormIds.length > 0) {
    await prisma.patientForm.deleteMany({ where: { id: { in: createdFormIds } } }).catch(() => {});
  }
  for (const stageId of stageIds) {
    const stage = await getPatientFileStage(prisma, stageId).catch(() => null);
    if (stage && stage.state !== "DELETED") {
      await deletePatientFileStageObjects(stage).catch(() => {});
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM "PatientFileObjectStage" WHERE "id" = $1`,
      stageId,
    ).catch(() => {});
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function assert(condition, label) {
  if (!condition) throw new Error(`Phase3 Documenso smoke failed: ${label}`);
  console.log(`ok ${label}`);
}
