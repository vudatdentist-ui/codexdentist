import { File } from "node:buffer";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { storePatientUpload } from "@/lib/patient-file-storage";
import {
  currentPatientFileStorageProvider,
  patientFileStageStoragePrefix,
} from "@/infrastructure/patient-files/object-gc";
import {
  createPatientFileStage,
  markPatientFileStageGcPending,
  markPatientFileStageStored,
} from "@/infrastructure/patient-files/staging";
import {
  acceptIntegrationInbox,
  createExternalReference,
  processIntegrationInbox,
} from "@/infrastructure/integrations/substrate";
import {
  getExternalReferenceByExternalId,
  getExternalReferenceByInternalId,
  getIntegrationConnectionById,
  lockExternalReferenceByExternalId,
  referenceMetadata,
  updateExternalReferenceMetadata,
} from "@/infrastructure/integrations/phase3-store";
import { reconcileSignedPatientFormCommand } from "@/lib/application/forms/provider-signing";
import { resolveDocumensoConnectionSecrets } from "@/integrations/config";
import {
  documensoWebhookEventId,
  downloadDocumensoSignedPdf,
  minimalDocumensoWebhookPayload,
  verifyDocumensoWebhook,
} from "@/integrations/documenso/client";

export async function POST(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await context.params;
  const connection = await getIntegrationConnectionById(
    prisma,
    connectionId,
    "documenso",
  );
  if (!connection || connection.status !== "ACTIVE") {
    return error("documenso-connection-not-found", 404);
  }

  let verified;
  let secrets;
  try {
    const payload = await request.json();
    secrets = resolveDocumensoConnectionSecrets(connection.secretRef);
    verified = verifyDocumensoWebhook(
      payload,
      request.headers.get("x-documenso-secret"),
      secrets.webhookSecret,
    );
  } catch (cause) {
    return error(
      errorCode(cause, "documenso-webhook-invalid"),
      statusCode(cause, 400),
    );
  }

  // Secret verification happens before inbox acceptance or any domain mutation.
  await prisma.$executeRawUnsafe(
    `UPDATE "IntegrationConnection"
     SET "lastVerifiedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    connection.id,
  );

  const minimal = minimalDocumensoWebhookPayload(verified);
  const envelopeId = minimal.envelopeId;
  if (!envelopeId) return error("documenso-envelope-id-missing", 400);

  let envelopeRef = await getExternalReferenceByExternalId(prisma, {
    organizationId: connection.organizationId,
    connectionId: connection.id,
    provider: "documenso",
    entityType: "DOCUMENSO_ENVELOPE",
    externalId: envelopeId,
  });

  // Recovery path: provider may have created the envelope while Codex crashed
  // before saving the returned envelope id. externalId is the opaque PatientForm id.
  if (!envelopeRef && minimal.externalId) {
    const patientForm = await prisma.patientForm.findFirst({
      where: {
        id: minimal.externalId,
        organizationId: connection.organizationId,
      },
      select: { id: true, clinicId: true, patientId: true },
    });
    if (patientForm?.clinicId) {
      try {
        envelopeRef = await createExternalReference(prisma, {
          organizationId: connection.organizationId,
          clinicId: patientForm.clinicId,
          connectionId: connection.id,
          provider: "documenso",
          entityType: "DOCUMENSO_ENVELOPE",
          internalId: patientForm.id,
          externalId: envelopeId,
          metadata: {
            patientFormId: patientForm.id,
            patientId: patientForm.patientId,
            status: "RECOVERED_WEBHOOK",
          },
        });
      } catch {
        envelopeRef = null;
      }
    }
  }
  if (!envelopeRef || !envelopeRef.clinicId) {
    return error("documenso-envelope-not-found", 404);
  }

  const eventId = documensoWebhookEventId(verified);
  let accepted;
  try {
    accepted = await acceptIntegrationInbox(prisma, {
      organizationId: connection.organizationId,
      clinicId: envelopeRef.clinicId,
      connectionId: connection.id,
      provider: "documenso",
      externalEventId: eventId,
      eventType: verified.event,
      payload: minimal,
    });
  } catch (cause) {
    return error(errorCode(cause, "documenso-inbox-rejected"), 409);
  }

  const existingInbox = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
    `SELECT "status" FROM "IntegrationInbox" WHERE "id" = $1 LIMIT 1`,
    accepted.event.id,
  );
  if (accepted.duplicate && existingInbox[0]?.status === "PROCESSED") {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      inboxStatus: "already_processed",
    });
  }

  if (verified.event !== "DOCUMENT_COMPLETED") {
    try {
      const result = await processIntegrationInbox(
        prisma,
        accepted.event.id,
        async (tx) => {
          const locked = await lockExternalReferenceByExternalId(tx, {
            organizationId: connection.organizationId,
            connectionId: connection.id,
            provider: "documenso",
            entityType: "DOCUMENSO_ENVELOPE",
            externalId: envelopeId,
          });
          if (!locked) throw coded("documenso-envelope-not-found");
          const metadata = referenceMetadata(locked);
          if (metadata.status !== "SIGNED") {
            await updateExternalReferenceMetadata(tx, locked.id, {
              ...metadata,
              status: minimal.status ?? metadata.status ?? "PENDING",
              lastEvent: verified.event,
              lastEventId: eventId,
              lastEventAt: minimal.createdAt ?? new Date().toISOString(),
            });
          }
          return { status: "event_recorded" as const };
        },
        { maxAttempts: 5, retryDelayMs: 5_000 },
      );
      return NextResponse.json({
        ok: true,
        duplicate: accepted.duplicate,
        inboxStatus: result.status,
      });
    } catch (cause) {
      return error(errorCode(cause, "documenso-processing-failed"), 500);
    }
  }

  const beforeDownload = referenceMetadata(envelopeRef);
  if (beforeDownload.status === "SIGNED" && typeof beforeDownload.patientFileId === "string") {
    try {
      const result = await processIntegrationInbox(
        prisma,
        accepted.event.id,
        async () => ({ status: "already_signed" as const }),
        { maxAttempts: 5, retryDelayMs: 5_000 },
      );
      return NextResponse.json({
        ok: true,
        duplicate: accepted.duplicate,
        inboxStatus: result.status,
        patientFileId: beforeDownload.patientFileId,
      });
    } catch (cause) {
      return error(errorCode(cause, "documenso-processing-failed"), 500);
    }
  }

  const patientForm = await prisma.patientForm.findFirst({
    where: {
      id: envelopeRef.internalId,
      organizationId: connection.organizationId,
      clinicId: envelopeRef.clinicId,
    },
    select: { id: true, patientId: true, formNo: true },
  });
  if (!patientForm) return error("documenso-form-not-found", 404);

  let signedPdf;
  try {
    signedPdf = await downloadDocumensoSignedPdf(secrets, envelopeId);
  } catch (cause) {
    return error(
      errorCode(cause, "documenso-signed-pdf-download-failed"),
      statusCode(cause, 502),
    );
  }

  const stageId = randomUUID();
  const patientFileId = randomUUID();
  const storageProvider = currentPatientFileStorageProvider();
  const storagePrefix = patientFileStageStoragePrefix({
    organizationId: connection.organizationId,
    patientId: patientForm.patientId,
    patientFileId,
  });
  const file = new File([new Uint8Array(signedPdf.bytes)], signedPdf.fileName, {
    type: "application/pdf",
  });

  try {
    await createPatientFileStage(prisma, {
      id: stageId,
      organizationId: connection.organizationId,
      clinicId: envelopeRef.clinicId,
      patientId: patientForm.patientId,
      uploadedById: null,
      targetPatientFileId: patientFileId,
      fileName: signedPdf.fileName,
      mimeType: "application/pdf",
      sizeBytes: signedPdf.bytes.byteLength,
      storageProvider,
      storageKey: storagePrefix,
    });
    const storedUpload = await storePatientUpload({
      file,
      organizationId: connection.organizationId,
      patientId: patientForm.patientId,
      patientFileId,
    });
    await markPatientFileStageStored(prisma, {
      stageId,
      checksumSha256: storedUpload.checksumSha256,
      storageKey: storedUpload.storageKey,
      previewStorageKey: storedUpload.preview?.storageKey ?? null,
      thumbnailStorageKey: storedUpload.thumbnail?.storageKey ?? null,
    });

    const result = await processIntegrationInbox(
      prisma,
      accepted.event.id,
      async (tx) => {
        const locked = await lockExternalReferenceByExternalId(tx, {
          organizationId: connection.organizationId,
          connectionId: connection.id,
          provider: "documenso",
          entityType: "DOCUMENSO_ENVELOPE",
          externalId: envelopeId,
        });
        if (!locked) throw coded("documenso-envelope-not-found");
        const metadata = referenceMetadata(locked);
        if (metadata.status === "SIGNED" && typeof metadata.patientFileId === "string") {
          return {
            status: "already_signed" as const,
            patientFileId: metadata.patientFileId,
          };
        }

        const reconciled = await reconcileSignedPatientFormCommand(tx, {
          organizationId: connection.organizationId,
          clinicId: envelopeRef!.clinicId!,
          patientId: patientForm.patientId,
          patientFormId: patientForm.id,
          stageId,
          patientFileId,
          storedUpload,
          provider: "documenso",
          externalEnvelopeId: envelopeId,
          completedAt: validDate(minimal.completedAt),
        });
        await updateExternalReferenceMetadata(tx, locked.id, {
          ...metadata,
          status: "SIGNED",
          patientFileId,
          signedAt: new Date().toISOString(),
          completedEventId: eventId,
        });
        const requestReference = await getExternalReferenceByInternalId(tx, {
          organizationId: connection.organizationId,
          connectionId: connection.id,
          provider: "documenso",
          entityType: "DOCUMENSO_REQUEST",
          internalId: patientForm.id,
        });
        if (requestReference) {
          await updateExternalReferenceMetadata(tx, requestReference.id, {
            ...referenceMetadata(requestReference),
            status: "SIGNED",
            envelopeId,
            patientFileId,
          });
        }
        return reconciled;
      },
      { maxAttempts: 5, retryDelayMs: 5_000 },
    );

    if (
      result.status !== "processed" ||
      result.result?.status === "already_signed"
    ) {
      await markPatientFileStageGcPending(
        prisma,
        stageId,
        "documenso-duplicate-signed-object",
      );
    }
    return NextResponse.json({
      ok: true,
      duplicate: accepted.duplicate,
      inboxStatus: result.status,
      result: result.result,
    });
  } catch (cause) {
    await markPatientFileStageGcPending(
      prisma,
      stageId,
      errorCode(cause, "documenso-signed-file-reconcile-failed"),
    ).catch(() => {});
    return error(errorCode(cause, "documenso-processing-failed"), 500);
  }
}

function validDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function coded(code: string) {
  return Object.assign(new Error(code), { code });
}

function errorCode(cause: unknown, fallback: string) {
  return cause && typeof cause === "object" && "code" in cause
    ? String((cause as { code?: unknown }).code || fallback)
    : fallback;
}

function statusCode(cause: unknown, fallback: number) {
  return cause && typeof cause === "object" && "status" in cause
    ? Number((cause as { status?: unknown }).status) || fallback
    : fallback;
}

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}
