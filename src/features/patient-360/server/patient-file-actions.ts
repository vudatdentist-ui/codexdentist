"use server";

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  optionalString,
  parseDateInVietnam,
  requiredString,
} from "@/lib/form-validation";
import {
  isUploadedPatientFile,
  patientFileValidationError,
  storePatientUpload,
} from "@/lib/patient-file-storage";
import { patientAccessWhere } from "@/lib/patient-access";
import { prisma } from "@/lib/prisma";

export async function createPatientFileAction(formData: FormData) {
  const session = await requireViewSession("journey");

  if (!canPerformAction(session, "file.upload")) {
    redirect("/journey?notice=files-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const title = requiredString(formData.get("title"));
  const externalUrl = optionalString(formData.get("url"));
  const uploadedFile = formData.get("file");
  const category = requiredString(formData.get("category")) || "CLINICAL_IMAGE";
  const hasUpload = isUploadedPatientFile(uploadedFile);
  const safeExternalUrl = externalUrl ? normalizeExternalFileUrl(externalUrl) : null;

  if (!patientId || !title || (!hasUpload && !safeExternalUrl)) {
    redirect("/journey?notice=files-missing");
  }

  if (
    (hasUpload && patientFileValidationError(uploadedFile) === "files-unsupported") ||
    (externalUrl && !safeExternalUrl)
  ) {
    redirect("/journey?notice=files-unsupported");
  }

  if (hasUpload && patientFileValidationError(uploadedFile) === "files-too-large") {
    redirect("/journey?notice=files-too-large");
  }

  try {
    const patient = await prisma.patient.findFirst({
      where: {
        ...patientAccessWhere(session),
        id: patientId,
      },
      select: {
        id: true,
        clinicId: true,
      },
    });

    if (!patient) {
      redirect("/journey?notice=files-patient-not-found");
    }

    const patientFileId = randomUUID();
    const storedUpload = hasUpload
      ? await storePatientUpload({
          file: uploadedFile,
          organizationId: session.organizationId,
          patientId: patient.id,
          patientFileId,
        })
      : null;
    const fileUrl = storedUpload ? `/patient-files/${patientFileId}` : safeExternalUrl;

    if (!fileUrl) {
      redirect("/journey?notice=files-missing");
    }

    const file = await prisma.patientFile.create({
      data: {
        id: patientFileId,
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        uploadedById: databaseActorId(session.userId),
        category,
        title,
        url: fileUrl,
        fileName:
          optionalString(formData.get("fileName")) ?? storedUpload?.fileName ?? null,
        mimeType:
          optionalString(formData.get("mimeType")) ?? storedUpload?.mimeType ?? null,
        sizeBytes: storedUpload?.sizeBytes ?? null,
        notes: optionalString(formData.get("notes")),
        sourceType: storedUpload
          ? storedUpload.storageProvider === "r2"
            ? "R2_UPLOAD"
            : "LOCAL_UPLOAD"
          : optionalString(formData.get("sourceType")) ?? "EXTERNAL_URL",
        sourceId: storedUpload?.relativePath ?? optionalString(formData.get("sourceId")),
        storageProvider: storedUpload?.storageProvider ?? "external",
        storageKey: storedUpload?.storageKey ?? safeExternalUrl,
        checksumSha256: storedUpload?.checksumSha256 ?? null,
        previewUrl: storedUpload?.preview ? `/patient-files/${patientFileId}?variant=preview` : null,
        previewMimeType: storedUpload?.preview?.mimeType ?? null,
        previewSizeBytes: storedUpload?.preview?.sizeBytes ?? null,
        previewStorageKey: storedUpload?.preview?.storageKey ?? null,
        thumbnailUrl: storedUpload?.thumbnail
          ? `/patient-files/${patientFileId}?variant=thumbnail`
          : null,
        thumbnailMimeType: storedUpload?.thumbnail?.mimeType ?? null,
        thumbnailSizeBytes: storedUpload?.thumbnail?.sizeBytes ?? null,
        thumbnailStorageKey: storedUpload?.thumbnail?.storageKey ?? null,
        virusScanStatus: storedUpload ? "NOT_SCANNED" : "EXTERNAL_URL",
      },
      select: {
        id: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "patient_file.created",
        entityType: "PatientFile",
        entityId: file.id,
        metadata: {
          patientId: patient.id,
          category,
          sourceType: storedUpload
            ? storedUpload.storageProvider === "r2"
              ? "R2_UPLOAD"
              : "LOCAL_UPLOAD"
            : "EXTERNAL_URL",
          sizeBytes: storedUpload?.sizeBytes ?? null,
          checksumSha256: storedUpload?.checksumSha256 ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    console.error("patient_file.create_failed", error);
    redirect("/journey?notice=files-database");
  }

  revalidatePath("/journey");
  revalidatePath("/forms");
  redirect("/journey?notice=files-created");
}

export async function updatePatientFileGovernanceAction(formData: FormData) {
  const session = await requireViewSession("journey");

  if (!canPerformAction(session, "file.delete")) {
    redirect("/journey?notice=files-denied");
  }

  const fileId = requiredString(formData.get("fileId"));
  const virusScanStatus = requiredString(formData.get("virusScanStatus")) || "NOT_SCANNED";
  const retentionUntilRaw = requiredString(formData.get("retentionUntil"));
  const retentionUntil = retentionUntilRaw
    ? parseDateInVietnam(retentionUntilRaw)
    : null;
  const allowedScanStatuses = new Set([
    "NOT_SCANNED",
    "PENDING",
    "CLEAN",
    "QUARANTINED",
    "INFECTED",
    "EXTERNAL_URL",
  ]);

  if (
    !fileId ||
    !allowedScanStatuses.has(virusScanStatus) ||
    retentionUntil === "invalid"
  ) {
    redirect("/journey?notice=files-governance-invalid");
  }

  try {
    const file = await prisma.patientFile.findFirst({
      where: {
        id: fileId,
        organizationId: session.organizationId,
        patient: patientAccessWhere(session),
      },
      select: {
        id: true,
        patientId: true,
        virusScanStatus: true,
        retentionUntil: true,
      },
    });

    if (!file) {
      redirect("/journey?notice=files-patient-not-found");
    }

    await prisma.$transaction(async (tx) => {
      await tx.patientFile.update({
        where: {
          id: file.id,
        },
        data: {
          virusScanStatus,
          retentionUntil,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "patient_file.governance_updated",
          entityType: "PatientFile",
          entityId: file.id,
          metadata: {
            patientId: file.patientId,
            previousVirusScanStatus: file.virusScanStatus,
            virusScanStatus,
            previousRetentionUntil: file.retentionUntil?.toISOString() ?? null,
            retentionUntil: retentionUntil?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    console.error("patient_file.governance_failed", error);
    redirect("/journey?notice=files-database");
  }

  revalidatePath("/journey");
  redirect("/journey?notice=files-governance-updated");
}

function normalizeExternalFileUrl(value: string) {
  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}
