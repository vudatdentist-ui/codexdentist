import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { enqueueIntegrationOutbox } from "@/infrastructure/integrations/substrate";
import { markPatientFileStageCommitted } from "@/infrastructure/patient-files/staging";
import type { StoredPatientUpload } from "@/lib/patient-file-storage";
import { referenceMetadata, type ExternalReferenceRecord } from "@/infrastructure/integrations/phase3-store";

export async function reconcileSignedPatientFormCommand(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    clinicId: string;
    patientId: string;
    patientFormId: string;
    stageId: string;
    patientFileId: string;
    storedUpload: StoredPatientUpload;
    provider: string;
    externalEnvelopeId: string;
    completedAt?: Date | null;
  },
) {
  // Different envelope locks do not serialize writes to the same consent form.
  await tx.$executeRaw`
    SELECT id FROM "PatientForm"
    WHERE id = ${input.patientFormId} AND "organizationId" = ${input.organizationId}
      AND "clinicId" = ${input.clinicId} AND "patientId" = ${input.patientId}
    FOR UPDATE
  `;
  const patientForm = await tx.patientForm.findFirst({
    where: {
      id: input.patientFormId,
      organizationId: input.organizationId,
      clinicId: input.clinicId,
      patientId: input.patientId,
    },
    select: {
      id: true,
      formNo: true,
      status: true,
      signatureUrl: true,
      attachments: true,
      template: { select: { requiresSignature: true } },
    },
  });
  if (!patientForm) throw new SignedFormReconciliationError("signed-form-not-found");
  if (!patientForm.template.requiresSignature) {
    throw new SignedFormReconciliationError("signed-form-signature-not-required");
  }
  if (patientForm.status === "VOID") {
    throw new SignedFormReconciliationError("signed-form-void");
  }

  const owners = await tx.$queryRaw<ExternalReferenceRecord[]>`
    SELECT * FROM "ExternalReference"
    WHERE "organizationId" = ${input.organizationId} AND "provider" = ${input.provider}
      AND "entityType" = 'DOCUMENSO_REQUEST' AND "internalId" = ${input.patientFormId}
    ORDER BY "createdAt", "id"
  `;
  const owner = owners[0];
  if (owners.length !== 1 || owner.clinicId !== input.clinicId ||
      referenceMetadata(owner).envelopeId !== input.externalEnvelopeId) {
    throw new SignedFormReconciliationError("signed-form-ceremony-ownership-conflict");
  }

  const fileUrl = `/patient-files/${input.patientFileId}`;
  if (patientForm.status === "COMPLETED" && patientForm.signatureUrl === fileUrl) {
    return { status: "already_reconciled" as const, patientFileId: input.patientFileId };
  }
  if (!["DRAFT", "SENT"].includes(patientForm.status) || patientForm.signatureUrl) {
    throw new SignedFormReconciliationError("signed-form-already-completed");
  }

  await tx.patientFile.create({
    data: {
      id: input.patientFileId,
      organizationId: input.organizationId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      uploadedById: null,
      category: "SIGNED_CONSENT",
      title: `Signed ${patientForm.formNo}`,
      url: fileUrl,
      fileName: input.storedUpload.fileName,
      mimeType: input.storedUpload.mimeType,
      sizeBytes: input.storedUpload.sizeBytes,
      notes: `Signed document returned from ${input.provider}`,
      sourceType:
        input.storedUpload.storageProvider === "r2"
          ? "R2_UPLOAD"
          : "LOCAL_UPLOAD",
      sourceId: input.storedUpload.relativePath,
      storageProvider: input.storedUpload.storageProvider,
      storageKey: input.storedUpload.storageKey,
      checksumSha256: input.storedUpload.checksumSha256,
      previewUrl: input.storedUpload.preview ? `${fileUrl}?variant=preview` : null,
      previewMimeType: input.storedUpload.preview?.mimeType ?? null,
      previewSizeBytes: input.storedUpload.preview?.sizeBytes ?? null,
      previewStorageKey: input.storedUpload.preview?.storageKey ?? null,
      thumbnailUrl: input.storedUpload.thumbnail ? `${fileUrl}?variant=thumbnail` : null,
      thumbnailMimeType: input.storedUpload.thumbnail?.mimeType ?? null,
      thumbnailSizeBytes: input.storedUpload.thumbnail?.sizeBytes ?? null,
      thumbnailStorageKey: input.storedUpload.thumbnail?.storageKey ?? null,
      virusScanStatus: "NOT_SCANNED",
    },
  });

  await markPatientFileStageCommitted(tx, input.stageId, input.patientFileId);
  const attachments = Array.from(
    new Set([...patientForm.attachments, fileUrl]),
  );
  const completed = await tx.patientForm.updateMany({
    where: { id: patientForm.id, organizationId: input.organizationId,
      clinicId: input.clinicId, patientId: input.patientId,
      status: { in: ["DRAFT", "SENT"] }, signatureUrl: null },
    data: {
      status: "COMPLETED",
      completedAt: input.completedAt ?? new Date(),
      signatureUrl: fileUrl,
      attachments,
    },
  });
  if (completed.count !== 1) {
    throw new SignedFormReconciliationError("signed-form-completion-conflict");
  }

  const comment = await tx.journeyComment.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      authorId: null,
      body: `Biểu mẫu ${patientForm.formNo} đã được ký điện tử.`,
      attachmentUrl: fileUrl,
      attachmentName: input.storedUpload.fileName,
      attachmentMime: input.storedUpload.mimeType,
      patientFileId: input.patientFileId,
    },
    select: { id: true },
  });

  await enqueueIntegrationOutbox(tx, {
    organizationId: input.organizationId,
    clinicId: input.clinicId,
    topic: "patient-files",
    eventType: "patient_file.committed",
    aggregateType: "PatientFile",
    aggregateId: input.patientFileId,
    payload: {
      patientFileId: input.patientFileId,
      patientId: input.patientId,
      category: "SIGNED_CONSENT",
      source: input.provider,
    },
    dedupeKey: `patient-file:${input.patientFileId}:committed`,
  });

  await tx.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: null,
      action: "patient_form.signed_reconciled",
      entityType: "PatientForm",
      entityId: patientForm.id,
      metadata: {
        provider: input.provider,
        externalEnvelopeId: input.externalEnvelopeId,
        patientFileId: input.patientFileId,
        journeyCommentId: comment.id,
        formNo: patientForm.formNo,
      } as Prisma.InputJsonValue,
    },
  });

  return {
    status: "reconciled" as const,
    patientFileId: input.patientFileId,
    journeyCommentId: comment.id,
  };
}

export class SignedFormReconciliationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "SignedFormReconciliationError";
  }
}
