import "server-only";

import { communityPosts as demoPosts, type CommunityPost } from "@/lib/data";
import { hasAnyRole, type AppRole } from "@/lib/permissions";
import type { CommunityWorkspace } from "@/lib/community-types";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type { AppSession } from "@/lib/session";

const mutableCommunityRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
  "BILLING",
];

export async function getCommunityWorkspace(
  session: AppSession,
): Promise<CommunityWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);

    const [dbClinics, dbPosts] = await Promise.all([
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
          city: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.communityPost.findMany({
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
          clinic: {
            select: {
              id: true,
              name: true,
            },
          },
          comments: {
            include: {
              author: {
                select: {
                  fullName: true,
                },
              },
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 3,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 24,
      }),
    ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableCommunityRoles),
      message:
        dbPosts.length === 0
          ? "Chưa có dữ liệu trong phạm vi hiện tại."
          : null,
      clinics: dbClinics,
      posts: dbPosts.map((post) => ({
        id: post.id,
        type: postTypeLabel(post.type),
        author: post.author.fullName,
        clinic: post.clinic?.name ?? "All clinics",
        clinicId: post.clinic?.id ?? null,
        title: post.title,
        body: post.body,
        tags: post.tags,
        replies: post.comments.length,
        createdAt: vietnamDateTime(post.createdAt),
        comments: post.comments.map((comment) => ({
          id: comment.id,
          author: comment.author.fullName,
          body: comment.body,
          createdAt: vietnamDateTime(comment.createdAt),
        })),
      })),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "community");
    return demoCommunityWorkspace(session);
  }
}

function demoCommunityWorkspace(session: AppSession): CommunityWorkspace {
  const allowedIds = new Set(session.clinicIds);
  const posts = demoPosts
    .filter((post) => !post.clinicId || allowedIds.has(post.clinicId))
    .map((post) => ({
      ...post,
      comments: [],
    }));

  return {
    source: "demo",
    canMutate: false,
    message:
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    clinics: session.clinics,
    posts,
  };
}

function allowedClinicIds(session: AppSession) {
  return session.activeClinicId
    ? [session.activeClinicId]
    : session.clinicIds;
}

function postTypeLabel(type: string): CommunityPost["type"] {
  const labels: Record<string, CommunityPost["type"]> = {
    ANNOUNCEMENT: "Announcement",
    CASE_DISCUSSION: "Case discussion",
    SHIFT_HANDOFF: "Shift handoff",
    TRAINING: "Training",
    POLICY: "Policy",
  };

  return labels[type] ?? "Announcement";
}

function vietnamDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
