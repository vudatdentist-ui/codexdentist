"use server";

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  optionalString,
  parseMoney,
  requiredString,
} from "@/lib/form-validation";
import {
  canMutateLearning,
  canSelfUpdateLearning,
  nextLearningContentCode,
} from "@/lib/learning";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import {
  isUploadedPatientFile,
  patientFileValidationError,
  storeLearningUpload,
} from "@/lib/patient-file-storage";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const learningTypes = ["BOOK", "ARTICLE", "VIDEO", "COURSE", "CHECKLIST", "POLICY"] as const;
const enrollmentStatuses = ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "EXPIRED"] as const;
const MAX_LEARNING_ASSET_FILES = 20;

export async function createLearningContentAction(formData: FormData) {
  const session = await requireViewSession("learning");

  if (!canMutateLearning(session)) {
    redirect("/learning?notice=learning-denied");
  }

  const type = normalizeLearningType(formData.get("type"));
  const title = requiredString(formData.get("title"));
  const rawCode = requiredString(formData.get("code")).toUpperCase();
  const code = rawCode || (type ? await nextLearningContentCode(session.organizationId, type) : "");
  const clinicId = normalizeClinicId(formData.get("clinicId"), session);
  const durationMinutes = parseMoney(formData.get("durationMinutes"));
  const resources = learningResourceLines(formData);
  const body = [optionalString(formData.get("body")), resources.lines].filter(Boolean).join("\n\n") || null;
  const mediaUrl = optionalString(formData.get("mediaUrl")) ?? resources.firstUrl;
  const uploadedFiles = formData.getAll("assetFile").filter(isUploadedPatientFile);
  const uploadTitles = formData.getAll("assetTitle");

  if (!type || !title || !code || clinicId === "denied") {
    redirect("/learning?notice=learning-missing");
  }

  if (uploadedFiles.length > MAX_LEARNING_ASSET_FILES) {
    redirect("/learning?notice=files-too-many");
  }

  const uploadValidationError = uploadedFiles.map(patientFileValidationError).find(Boolean);

  if (uploadValidationError) {
    redirect(`/learning?notice=${uploadValidationError}`);
  }

  try {
    const content = await prisma.learningContent.upsert({
      where: {
        organizationId_code: {
          organizationId: session.organizationId,
          code,
        },
      },
      update: {
        clinicId: clinicId === "all" ? null : clinicId,
        type,
        title,
        summary: optionalString(formData.get("summary")),
        body,
        mediaUrl,
        durationMinutes,
        publishedAt: requiredString(formData.get("published")) === "on" ? new Date() : null,
        active: true,
      },
      create: {
        organizationId: session.organizationId,
        clinicId: clinicId === "all" ? null : clinicId,
        authorId: databaseActorId(session.userId),
        code,
        type,
        title,
        summary: optionalString(formData.get("summary")),
        body,
        mediaUrl,
        durationMinutes,
        publishedAt: requiredString(formData.get("published")) === "on" ? new Date() : null,
        active: true,
      },
      select: {
        id: true,
      },
    });

    if (uploadedFiles.length > 0) {
      const storedAssets = await Promise.all(
        uploadedFiles.map(async (file, index) => {
          const assetId = randomUUID();
          const storedUpload = await storeLearningUpload({
            file,
            organizationId: session.organizationId,
            contentId: content.id,
            assetId,
          });
          const assetUrl = `/learning-assets/${assetId}`;

          return {
            id: assetId,
            organizationId: session.organizationId,
            clinicId: clinicId === "all" ? null : clinicId,
            contentId: content.id,
            uploadedById: databaseActorId(session.userId),
            kind: storedUpload.fileKind,
            title:
              optionalString(uploadTitles[index] ?? null) ??
              storedUpload.fileName ??
              `${title} ${index + 1}`,
            fileName: storedUpload.fileName,
            mimeType: storedUpload.mimeType,
            url: assetUrl,
            sizeBytes: storedUpload.sizeBytes,
            storageProvider: storedUpload.storageProvider,
            storageKey: storedUpload.storageKey,
            checksumSha256: storedUpload.checksumSha256,
            previewUrl: storedUpload.preview ? `${assetUrl}?variant=preview` : null,
            previewMimeType: storedUpload.preview?.mimeType ?? null,
            previewSizeBytes: storedUpload.preview?.sizeBytes ?? null,
            previewStorageKey: storedUpload.preview?.storageKey ?? null,
            thumbnailUrl: storedUpload.thumbnail ? `${assetUrl}?variant=thumbnail` : null,
            thumbnailMimeType: storedUpload.thumbnail?.mimeType ?? null,
            thumbnailSizeBytes: storedUpload.thumbnail?.sizeBytes ?? null,
            thumbnailStorageKey: storedUpload.thumbnail?.storageKey ?? null,
          };
        }),
      );

      await prisma.learningAsset.createMany({
        data: storedAssets,
      });
    }

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "learning.content_upserted",
        entityType: "LearningContent",
        entityId: content.id,
        metadata: {
          code,
          type,
          assetCount: uploadedFiles.length,
        } as Prisma.InputJsonValue,
      },
    });
  } catch {
    redirect("/learning?notice=learning-database");
  }

  revalidateLearningViews();
  redirect("/learning?notice=learning-content-saved");
}

export async function assignLearningContentAction(formData: FormData) {
  const session = await requireViewSession("learning");

  if (!canMutateLearning(session)) {
    redirect("/learning?notice=learning-denied");
  }

  const contentId = requiredString(formData.get("contentId"));
  const userId = requiredString(formData.get("userId"));

  if (!contentId || !userId) {
    redirect("/learning?notice=learning-missing");
  }

  try {
    const [content, user] = await Promise.all([
      prisma.learningContent.findFirst({
        where: {
          id: contentId,
          organizationId: session.organizationId,
          active: true,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: allowedClinicIds(session),
              },
            },
          ],
        },
        select: {
          id: true,
          clinicId: true,
          title: true,
        },
      }),
      prisma.user.findFirst({
        where: {
          id: userId,
          organizationId: session.organizationId,
          active: true,
          clinics: {
            some: {
              clinicId: {
                in: allowedClinicIds(session),
              },
            },
          },
        },
        include: {
          clinics: {
            select: {
              clinicId: true,
            },
            take: 1,
          },
        },
      }),
    ]);

    if (!content || !user) {
      redirect("/learning?notice=learning-missing");
    }

    const clinicId = content.clinicId ?? user.clinics[0]?.clinicId ?? session.activeClinicId;
    const enrollment = await prisma.learningEnrollment.upsert({
      where: {
        contentId_userId: {
          contentId: content.id,
          userId: user.id,
        },
      },
      update: {
        clinicId,
        status: "ASSIGNED",
        assignedById: databaseActorId(session.userId),
        assignedAt: new Date(),
        startedAt: null,
        completedAt: null,
        score: null,
      },
      create: {
        organizationId: session.organizationId,
        clinicId,
        contentId: content.id,
        userId: user.id,
        assignedById: databaseActorId(session.userId),
        status: "ASSIGNED",
      },
      select: {
        id: true,
      },
    });

    const message = renderNotificationTemplate("LEARNING_ASSIGNMENT", {
      contentTitle: content.title,
    });

    await prisma.notification.create({
      data: {
        organizationId: session.organizationId,
        clinicId,
        userId: user.id,
        channel: "IN_APP",
        status: "SCHEDULED",
        templateKey: "LEARNING_ASSIGNMENT",
        recipient: user.email,
        subject: message.subject,
        body: message.body,
        scheduledAt: new Date(),
        metadata: {
          contentId: content.id,
          enrollmentId: enrollment.id,
        } as Prisma.InputJsonValue,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "learning.content_assigned",
        entityType: "LearningEnrollment",
        entityId: enrollment.id,
        metadata: {
          contentId: content.id,
          userId: user.id,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/learning?notice=learning-database");
  }

  revalidateLearningViews();
  redirect("/learning?notice=learning-assigned");
}

export async function updateLearningEnrollmentStatusAction(formData: FormData) {
  const session = await requireViewSession("learning");

  if (!canSelfUpdateLearning(session)) {
    redirect("/learning?notice=learning-denied");
  }

  const enrollmentId = requiredString(formData.get("enrollmentId"));
  const status = normalizeEnrollmentStatus(formData.get("status"));
  const score = parseMoney(formData.get("score"));

  if (!enrollmentId || !status) {
    redirect("/learning?notice=learning-missing");
  }

  if (score != null && (score < 0 || score > 100)) {
    redirect("/learning?notice=learning-score-invalid");
  }

  try {
    const enrollment = await prisma.learningEnrollment.findFirst({
      where: {
        id: enrollmentId,
        organizationId: session.organizationId,
        OR: canMutateLearning(session)
          ? [
              {
                clinicId: null,
              },
              {
                clinicId: {
                  in: allowedClinicIds(session),
                },
              },
              {
                userId: session.userId,
              },
            ]
          : [
              {
                userId: session.userId,
              },
            ],
      },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!enrollment) {
      redirect("/learning?notice=learning-missing");
    }

    const now = new Date();
    await prisma.learningEnrollment.update({
      where: {
        id: enrollment.id,
      },
      data: {
        status,
        startedAt: status === "IN_PROGRESS" ? now : undefined,
        completedAt: status === "COMPLETED" ? now : status === "ASSIGNED" ? null : undefined,
        score: status === "COMPLETED" ? score : undefined,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "learning.enrollment_updated",
        entityType: "LearningEnrollment",
        entityId: enrollment.id,
        metadata: {
          status,
          score,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/learning?notice=learning-database");
  }

  revalidateLearningViews();
  redirect("/learning?notice=learning-progress-updated");
}

function normalizeLearningType(value: FormDataEntryValue | null) {
  const parsed = requiredString(value);

  return learningTypes.find((type) => type === parsed) ?? null;
}

function learningResourceLines(formData: FormData) {
  const kinds = formData.getAll("resourceKind");
  const titles = formData.getAll("resourceTitle");
  const urls = formData.getAll("resourceUrl");
  const lines: string[] = [];
  let firstUrl: string | null = null;

  urls.forEach((urlValue, index) => {
    const url = optionalString(urlValue);

    if (!url) {
      return;
    }

    const kind = normalizeLearningResourceKind(kinds[index] ?? null);
    const title = optionalString(titles[index] ?? null) ?? url;
    lines.push(`[${kind}] ${title} | ${url}`);
    firstUrl ??= url;
  });

  return {
    firstUrl,
    lines: lines.join("\n"),
  };
}

function normalizeLearningResourceKind(value: FormDataEntryValue | null) {
  const parsed = requiredString(value).toUpperCase();

  return ["VIDEO", "IMAGE", "DOCUMENT", "LINK"].includes(parsed) ? parsed : "LINK";
}

function normalizeEnrollmentStatus(value: FormDataEntryValue | null) {
  const parsed = requiredString(value);

  return enrollmentStatuses.find((status) => status === parsed) ?? null;
}

function normalizeClinicId(value: FormDataEntryValue | null, session: AppSession) {
  const parsed = requiredString(value);

  if (!parsed || parsed === "all") {
    return canUseAllClinics(session) ? "all" : session.activeClinicId ?? "denied";
  }

  return session.clinicIds.includes(parsed) ? parsed : "denied";
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function revalidateLearningViews() {
  revalidatePath("/learning");
  revalidatePath("/employee-app");
  revalidatePath("/dashboard");
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}
