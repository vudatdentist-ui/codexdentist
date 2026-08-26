import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { canPerformAction } from "@/lib/actions/permissions";
import { ApplicationCommandError } from "@/lib/application/errors";
import { databaseActorId } from "@/lib/form-validation";
import {
  currentPatientFileStorageProvider,
  patientFileStageStoragePrefix,
} from "@/infrastructure/patient-files/object-gc";
import {
  createPatientFileStage,
  markPatientFileStageCommitted,
  markPatientFileStageGcPending,
  markPatientFileStageStored,
} from "@/infrastructure/patient-files/staging";
import { enqueueIntegrationOutbox } from "@/infrastructure/integrations/substrate";
import {
  patientFileValidationError,
  storePatientUpload,
} from "@/lib/patient-file-storage";
import { patientAccessWhere } from "@/lib/patient-access";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export const MAX_JOURNEY_COMMENT_FILES = 10;

export async function updateJourneyStateCommand(
  session: AppSession,
  input: {
    patientId: string;
    treatmentGoal: string | null;
    treatmentPlan: string | null;
    odontogramTeeth: string[];
  },
) {
  if (!canPerformAction(session, "treatment.plan.create")) {
    throw new ApplicationCommandError("journey-denied");
  }

  const patient = await prisma.patient.findFirst({
    where: { ...patientAccessWhere(session), id: input.patientId },
    select: { id: true, clinicId: true },
  });
  if (!patient) throw new ApplicationCommandError("journey-state-missing");

  return prisma.$transaction(async (tx) => {
    const state = await tx.patientJourneyState.upsert({
      where: { patientId: patient.id },
      update: {
        clinicId: patient.clinicId,
        treatmentGoal: input.treatmentGoal,
        treatmentPlan: input.treatmentPlan,
        odontogramTeeth: input.odontogramTeeth,
        odontogramSnapshot: { selectedTargets: input.odontogramTeeth } as Prisma.InputJsonValue,
        updatedById: databaseActorId(session.userId),
      },
      create: {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        treatmentGoal: input.treatmentGoal,
        treatmentPlan: input.treatmentPlan,
        odontogramTeeth: input.odontogramTeeth,
        odontogramSnapshot: { selectedTargets: input.odontogramTeeth } as Prisma.InputJsonValue,
        updatedById: databaseActorId(session.userId),
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "journey.state_updated",
        entityType: "PatientJourneyState",
        entityId: state.id,
        metadata: {
          patientId: patient.id,
          odontogramTeeth: input.odontogramTeeth,
        } as Prisma.InputJsonValue,
      },
    });
    return state;
  });
}

export async function createJourneyCommentCommand(
  session: AppSession,
  input: { patientId: string; body: string; files: File[] },
) {
  if (!canPerformAction(session, "patient.update")) {
    throw new ApplicationCommandError("journey-denied");
  }
  if (!input.patientId || (!input.body && input.files.length === 0)) {
    throw new ApplicationCommandError("journey-comment-missing");
  }
  if (input.files.length > MAX_JOURNEY_COMMENT_FILES) {
    throw new ApplicationCommandError("files-too-many");
  }
  const uploadValidationError = input.files.map(patientFileValidationError).find(Boolean);
  if (uploadValidationError) throw new ApplicationCommandError(uploadValidationError);

  const patient = await prisma.patient.findFirst({
    where: { ...patientAccessWhere(session), id: input.patientId },
    select: { id: true, clinicId: true },
  });
  if (!patient) throw new ApplicationCommandError("journey-comment-missing");

  const commentId = randomUUID();
  const storageProvider = currentPatientFileStorageProvider();
  const actorId = databaseActorId(session.userId);
  const plannedAttachments = input.files.map((uploadedFile, index) => {
    const stageId = randomUUID();
    const patientFileId = randomUUID();
    return {
      index,
      stageId,
      patientFileId,
      uploadedFile,
      storagePrefix: patientFileStageStoragePrefix({
        organizationId: session.organizationId,
        patientId: patient.id,
        patientFileId,
      }),
      attachmentUrl: `/patient-files/${patientFileId}`,
    };
  });

  if (plannedAttachments.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const attachment of plannedAttachments) {
        await createPatientFileStage(tx, {
          id: attachment.stageId,
          organizationId: session.organizationId,
          clinicId: patient.clinicId,
          patientId: patient.id,
          uploadedById: actorId,
          targetPatientFileId: attachment.patientFileId,
          fileName: attachment.uploadedFile.name || "patient-file",
          mimeType:
            attachment.uploadedFile.type || "application/octet-stream",
          sizeBytes: attachment.uploadedFile.size,
          storageProvider,
          storageKey: attachment.storagePrefix,
        });
      }
    });
  }

  const storedAttachments: Array<{
    index: number;
    stageId: string;
    patientFileId: string;
    attachmentUrl: string;
    storedUpload: Awaited<ReturnType<typeof storePatientUpload>>;
  }> = [];

  try {
    for (const attachment of plannedAttachments) {
      const storedUpload = await storePatientUpload({
        file: attachment.uploadedFile,
        organizationId: session.organizationId,
        patientId: patient.id,
        patientFileId: attachment.patientFileId,
      });
      await markPatientFileStageStored(prisma, {
        stageId: attachment.stageId,
        checksumSha256: storedUpload.checksumSha256,
        storageKey: storedUpload.storageKey,
        previewStorageKey: storedUpload.preview?.storageKey ?? null,
        thumbnailStorageKey: storedUpload.thumbnail?.storageKey ?? null,
      });
      storedAttachments.push({
        index: attachment.index,
        stageId: attachment.stageId,
        patientFileId: attachment.patientFileId,
        storedUpload,
        attachmentUrl: attachment.attachmentUrl,
      });
    }
  } catch (error) {
    await markStagesForGc(plannedAttachments, "patient-file-object-write-failed");
    throw error;
  }

  const firstStoredAttachment = storedAttachments[0] ?? null;
  const commentBody =
    input.body ||
    input.files.map((file) => file.name).filter(Boolean).join(", ") ||
    "File đính kèm";

  try {
    await prisma.$transaction(async (tx) => {
      const createdFiles = await Promise.all(
        storedAttachments.map((attachment) =>
          tx.patientFile.create({
            data: {
              id: attachment.patientFileId,
              organizationId: session.organizationId,
              clinicId: patient.clinicId,
              patientId: patient.id,
              uploadedById: actorId,
              category: "TIMELINE_COMMENT",
              title: commentBody.slice(0, 80),
              url: attachment.attachmentUrl,
              fileName: attachment.storedUpload.fileName,
              mimeType: attachment.storedUpload.mimeType,
              sizeBytes: attachment.storedUpload.sizeBytes,
              notes: commentBody,
              sourceType: attachment.storedUpload.storageProvider === "r2" ? "R2_UPLOAD" : "LOCAL_UPLOAD",
              sourceId: attachment.storedUpload.relativePath,
              storageProvider: attachment.storedUpload.storageProvider,
              storageKey: attachment.storedUpload.storageKey,
              checksumSha256: attachment.storedUpload.checksumSha256,
              previewUrl: attachment.storedUpload.preview ? `${attachment.attachmentUrl}?variant=preview` : null,
              previewMimeType: attachment.storedUpload.preview?.mimeType ?? null,
              previewSizeBytes: attachment.storedUpload.preview?.sizeBytes ?? null,
              previewStorageKey: attachment.storedUpload.preview?.storageKey ?? null,
              thumbnailUrl: attachment.storedUpload.thumbnail ? `${attachment.attachmentUrl}?variant=thumbnail` : null,
              thumbnailMimeType: attachment.storedUpload.thumbnail?.mimeType ?? null,
              thumbnailSizeBytes: attachment.storedUpload.thumbnail?.sizeBytes ?? null,
              thumbnailStorageKey: attachment.storedUpload.thumbnail?.storageKey ?? null,
              virusScanStatus: "NOT_SCANNED",
            },
            select: { id: true },
          }),
        ),
      );

      await tx.journeyComment.create({
        data: {
          id: commentId,
          organizationId: session.organizationId,
          clinicId: patient.clinicId,
          patientId: patient.id,
          authorId: actorId,
          body: commentBody,
          attachmentUrl: firstStoredAttachment?.attachmentUrl ?? null,
          attachmentName: firstStoredAttachment?.storedUpload.fileName ?? null,
          attachmentMime: firstStoredAttachment?.storedUpload.mimeType ?? null,
          patientFileId: createdFiles[0]?.id ?? null,
          attachments: {
            create: storedAttachments.map((attachment, index) => ({
              patientFileId: createdFiles[index]?.id ?? attachment.patientFileId,
              url: attachment.attachmentUrl,
              name: attachment.storedUpload.fileName,
              mimeType: attachment.storedUpload.mimeType,
              fileKind: attachment.storedUpload.fileKind,
              sizeBytes: attachment.storedUpload.sizeBytes,
              previewUrl: attachment.storedUpload.preview ? `${attachment.attachmentUrl}?variant=preview` : null,
              thumbnailUrl: attachment.storedUpload.thumbnail ? `${attachment.attachmentUrl}?variant=thumbnail` : null,
              sortOrder: attachment.index,
            })),
          },
        },
      });

      for (const attachment of storedAttachments) {
        await markPatientFileStageCommitted(
          tx,
          attachment.stageId,
          attachment.patientFileId,
        );
        await enqueueIntegrationOutbox(tx, {
          organizationId: session.organizationId,
          clinicId: patient.clinicId,
          topic: "patient-files",
          eventType: "patient_file.committed",
          aggregateType: "PatientFile",
          aggregateId: attachment.patientFileId,
          dedupeKey: `patient-file:${attachment.patientFileId}:committed`,
          payload: {
            patientId: patient.id,
            patientFileId: attachment.patientFileId,
            journeyCommentId: commentId,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId,
          action: "journey.comment_created",
          entityType: "JourneyComment",
          entityId: commentId,
          metadata: {
            patientId: patient.id,
            patientFileIds: createdFiles.map((file) => file.id),
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    await markStagesForGc(plannedAttachments, "patient-file-domain-commit-failed");
    throw error;
  }

  return { commentId };
}

async function markStagesForGc(
  attachments: Array<{ stageId: string }>,
  errorCode: string,
) {
  await Promise.all(
    attachments.map((attachment) =>
      markPatientFileStageGcPending(prisma, attachment.stageId, errorCode).catch(
        () => null,
      ),
    ),
  );
}
