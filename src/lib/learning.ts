import "server-only";

import { defaultDataSeedEnabled } from "@/lib/env";
import { canUseAllClinics, hasAnyRole, type AppRole, type RoleSource } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type {
  LearningAssetSummary,
  LearningContentSummary,
  LearningEnrollmentSummary,
  LearningWorkspace,
} from "@/lib/learning-types";
import type { AppSession } from "@/lib/session";

const mutableLearningRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"];
const selfLearningRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
  "BILLING",
];

const defaultLearningContent = [
  {
    code: "POL-STERILE-01",
    type: "POLICY" as const,
    title: "Quy trình tiệt khuẩn dụng cụ",
    summary: "Luồng dụng cụ bẩn-sạch, đóng gói, nhật ký hấp và kiểm tra ghế sau mỗi ca.",
    body:
      "Dùng checklist này để kiểm tra luồng dụng cụ bẩn-sạch, chu kỳ hấp, túi đóng gói còn nguyên và việc vệ sinh ghế trước bệnh nhân tiếp theo.",
    durationMinutes: 20,
  },
  {
    code: "CHK-ENDO-01",
    type: "CHECKLIST" as const,
    title: "Checklist chuẩn bị nội nha",
    summary: "Chuẩn bị đê cao su, file, dung dịch bơm rửa, máy định vị chóp và vật liệu tạm.",
    body:
      "Xác nhận consent, phim X-quang, cô lập, dung dịch bơm rửa, file máy, côn chính, sealer, vật liệu tạm và hướng dẫn sau điều trị.",
    durationMinutes: 15,
  },
  {
    code: "COURSE-FRONTDESK-01",
    type: "COURSE" as const,
    title: "Bàn giao thu phí từ Journey",
    summary: "Cách đọc dịch vụ Journey, thu cọc và xuất hóa đơn từng phần đúng quy trình.",
    body:
      "Dùng tiến độ dịch vụ Journey và thẻ dịch vụ trong Billing để tách phiếu thu khỏi hóa đơn. Không xuất hóa đơn cho dịch vụ chỉ mới planned nếu chưa có thu tiền hoặc chính sách chưa yêu cầu.",
    durationMinutes: 30,
  },
];

export async function getLearningWorkspace(
  session: AppSession,
): Promise<LearningWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);
    if (defaultDataSeedEnabled()) {
      await ensureLearningSeed(session);
    }

    const [clinics, users, contents, enrollments] = await Promise.all([
      prisma.clinic.findMany({
        where: {
          organizationId: session.organizationId,
          id: {
            in: clinicIds,
          },
        },
        select: {
          id: true,
          name: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.user.findMany({
        where: {
          organizationId: session.organizationId,
          active: true,
          role: {
            not: "PATIENT",
          },
          clinics: {
            some: {
              clinicId: {
                in: clinicIds,
              },
            },
          },
        },
        include: {
          clinics: {
            select: {
              clinicId: true,
            },
          },
        },
        orderBy: {
          fullName: "asc",
        },
      }),
      prisma.learningContent.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        include: {
          author: {
            select: {
              fullName: true,
            },
          },
          enrollments: {
            select: {
              status: true,
            },
          },
          assets: {
            include: {
              uploadedBy: {
                select: {
                  fullName: true,
                },
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
        },
        orderBy: [
          {
            active: "desc",
          },
          {
            createdAt: "desc",
          },
        ],
        take: 120,
      }),
      prisma.learningEnrollment.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        include: {
          content: {
            select: {
              code: true,
              title: true,
              type: true,
            },
          },
          user: {
            select: {
              fullName: true,
            },
          },
          assignedBy: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          assignedAt: "desc",
        },
        take: 200,
      }),
    ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableLearningRoles),
      canSelfUpdate: hasAnyRole(session, selfLearningRoles),
      message: null,
      clinics,
      users: users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        role: user.role as AppRole,
        active: user.active,
        clinicIds: user.clinics.map((clinic) => clinic.clinicId),
      })),
      contents: contents.map(toContentSummary),
      enrollments: enrollments.map(toEnrollmentSummary),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "learning");
    return {
      source: "demo",
      canMutate: false,
      canSelfUpdate: false,
      message:
        "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
      clinics: [],
      users: [],
      contents: [],
      enrollments: [],
    };
  }
}

export function canMutateLearning(source: RoleSource) {
  return hasAnyRole(source, mutableLearningRoles);
}

export function canSelfUpdateLearning(source: RoleSource) {
  return hasAnyRole(source, selfLearningRoles);
}

export async function nextLearningContentCode(organizationId: string, type: string) {
  const prefix = type.slice(0, 3).toUpperCase();
  const count = await prisma.learningContent.count({
    where: {
      organizationId,
      code: {
        startsWith: `${prefix}-`,
      },
    },
  });

  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

export async function ensureLearningSeed(session: AppSession) {
  for (const content of defaultLearningContent) {
    await prisma.learningContent.upsert({
      where: {
        organizationId_code: {
          organizationId: session.organizationId,
          code: content.code,
        },
      },
      update: {
        type: content.type,
        title: content.title,
        summary: content.summary,
        body: content.body,
        durationMinutes: content.durationMinutes,
        active: true,
      },
      create: {
        organizationId: session.organizationId,
        authorId: databaseUserId(session.userId),
        ...content,
        publishedAt: new Date(),
        active: true,
      },
    });
  }
}

function toContentSummary(content: {
  id: string;
  clinicId: string | null;
  code: string;
  type: string;
  title: string;
  summary: string | null;
  body: string | null;
  mediaUrl: string | null;
  durationMinutes: number | null;
  publishedAt: Date | null;
  active: boolean;
  createdAt: Date;
  author: {
    fullName: string;
  } | null;
  assets: Array<{
    id: string;
    contentId: string;
    kind: string;
    title: string;
    fileName: string | null;
    mimeType: string | null;
    url: string;
    sizeBytes: number | null;
    previewUrl: string | null;
    thumbnailUrl: string | null;
    createdAt: Date;
    uploadedBy: {
      fullName: string;
    } | null;
  }>;
  enrollments: Array<{
    status: string;
  }>;
}): LearningContentSummary {
  return {
    id: content.id,
    clinicId: content.clinicId,
    authorName: content.author?.fullName ?? null,
    code: content.code,
    type: content.type as LearningContentSummary["type"],
    title: content.title,
    summary: content.summary,
    body: content.body,
    mediaUrl: content.mediaUrl,
    durationMinutes: content.durationMinutes,
    publishedAt: content.publishedAt ? vietnamDate(content.publishedAt) : null,
    active: content.active,
    assets: content.assets.map(toAssetSummary),
    enrollmentCount: content.enrollments.length,
    completedCount: content.enrollments.filter(
      (enrollment) => enrollment.status === "COMPLETED",
    ).length,
    createdAt: vietnamDateTime(content.createdAt),
  };
}

function toAssetSummary(asset: {
  id: string;
  contentId: string;
  kind: string;
  title: string;
  fileName: string | null;
  mimeType: string | null;
  url: string;
  sizeBytes: number | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: Date;
  uploadedBy: {
    fullName: string;
  } | null;
}): LearningAssetSummary {
  return {
    id: asset.id,
    contentId: asset.contentId,
    uploadedByName: asset.uploadedBy?.fullName ?? null,
    kind: normalizeAssetKind(asset.kind),
    title: asset.title,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    url: asset.url,
    sizeBytes: asset.sizeBytes,
    previewUrl: asset.previewUrl,
    thumbnailUrl: asset.thumbnailUrl,
    createdAt: vietnamDateTime(asset.createdAt),
  };
}

function normalizeAssetKind(kind: string): LearningAssetSummary["kind"] {
  if (kind === "image" || kind === "video" || kind === "pdf" || kind === "model3d") {
    return kind;
  }

  return "document";
}

function toEnrollmentSummary(enrollment: {
  id: string;
  clinicId: string | null;
  contentId: string;
  userId: string;
  status: string;
  assignedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  score: unknown;
  content: {
    code: string;
    title: string;
    type: string;
  };
  user: {
    fullName: string;
  };
  assignedBy: {
    fullName: string;
  } | null;
}): LearningEnrollmentSummary {
  return {
    id: enrollment.id,
    clinicId: enrollment.clinicId,
    contentId: enrollment.contentId,
    contentCode: enrollment.content.code,
    contentTitle: enrollment.content.title,
    contentType: enrollment.content.type as LearningEnrollmentSummary["contentType"],
    userId: enrollment.userId,
    userName: enrollment.user.fullName,
    assignedByName: enrollment.assignedBy?.fullName ?? null,
    status: enrollment.status as LearningEnrollmentSummary["status"],
    assignedAt: vietnamDateTime(enrollment.assignedAt),
    startedAt: enrollment.startedAt ? vietnamDateTime(enrollment.startedAt) : null,
    completedAt: enrollment.completedAt ? vietnamDateTime(enrollment.completedAt) : null,
    score: enrollment.score == null ? null : Number(enrollment.score),
  };
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function databaseUserId(userId: string) {
  return userId.startsWith("demo-") ? null : userId;
}

function vietnamDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function vietnamDateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}
