"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  parseLowercaseTags,
  requiredString,
} from "@/lib/form-validation";
import { canUseAllClinics, hasAnyRole, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
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

const managerRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"];

export async function createCommunityPostAction(formData: FormData) {
  const session = await requireViewSession("community");

  if (!canWriteCommunity(session)) {
    redirect("/community?notice=community-denied");
  }

  const title = requiredString(formData.get("title"));
  const body = requiredString(formData.get("body"));
  const type = parsePostType(formData.get("type"));
  const tags = parseLowercaseTags(formData.get("tags"));
  const clinicId = normalizeClinicId(formData.get("clinicId"), session);

  if (!title || !body || !type || clinicId === "denied") {
    redirect("/community?notice=community-missing");
  }

  let notice: string | null = null;

  try {
    const author = await prisma.user.findFirst({
      where: {
        id: session.userId,
        organizationId: session.organizationId,
        active: true,
      },
      select: {
        id: true,
      },
    });

    if (!author) {
      notice = "community-author-not-found";
    } else {
      const post = await prisma.communityPost.create({
        data: {
          organizationId: session.organizationId,
          clinicId,
          authorId: author.id,
          type,
          title,
          body,
          tags,
        },
        select: {
          id: true,
        },
      });

      await writeCommunityAuditLog({
        organizationId: session.organizationId,
        actorId: author.id,
        action: "community_post.created",
        entityType: "CommunityPost",
        entityId: post.id,
        metadata: {
          clinicId,
          type,
          tags,
        },
      });
    }
  } catch {
    notice = "community-database";
  }

  if (notice) {
    redirect(`/community?notice=${notice}`);
  }

  revalidatePath("/community");
  redirect("/community?notice=community-created");
}

export async function addCommunityCommentAction(formData: FormData) {
  const session = await requireViewSession("community");

  if (!canWriteCommunity(session)) {
    redirect("/community?notice=community-denied");
  }

  const postId = requiredString(formData.get("postId"));
  const body = requiredString(formData.get("body"));

  if (!postId || !body) {
    redirect("/community?notice=community-comment-missing");
  }

  let notice: string | null = null;

  try {
    const [post, author] = await Promise.all([
      prisma.communityPost.findFirst({
        where: {
          id: postId,
          organizationId: session.organizationId,
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
        },
      }),
      prisma.user.findFirst({
        where: {
          id: session.userId,
          organizationId: session.organizationId,
          active: true,
        },
        select: {
          id: true,
        },
      }),
    ]);

    if (!post || !author) {
      notice = "community-post-not-found";
    } else {
      const comment = await prisma.postComment.create({
        data: {
          postId,
          authorId: author.id,
          body,
        },
        select: {
          id: true,
        },
      });

      await writeCommunityAuditLog({
        organizationId: session.organizationId,
        actorId: author.id,
        action: "community_comment.created",
        entityType: "PostComment",
        entityId: comment.id,
        metadata: {
          postId,
        },
      });
    }
  } catch {
    notice = "community-database";
  }

  if (notice) {
    redirect(`/community?notice=${notice}`);
  }

  revalidatePath("/community");
  redirect("/community?notice=community-commented");
}

export async function deleteCommunityPostAction(formData: FormData) {
  const session = await requireViewSession("community");

  if (!canWriteCommunity(session)) {
    redirect("/community?notice=community-denied");
  }

  const postId = requiredString(formData.get("postId"));

  if (!postId) {
    redirect("/community?notice=community-post-not-found");
  }

  let notice: string | null = null;

  try {
    const post = await prisma.communityPost.findFirst({
      where: {
        id: postId,
        organizationId: session.organizationId,
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
        authorId: true,
      },
    });

    if (!post || (!hasAnyRole(session, managerRoles) && post.authorId !== session.userId)) {
      notice = "community-post-not-found";
    } else {
      await prisma.$transaction([
        prisma.postComment.deleteMany({
          where: {
            postId,
          },
        }),
        prisma.communityPost.delete({
          where: {
            id: postId,
          },
        }),
        prisma.auditLog.create({
          data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "community_post.deleted",
            entityType: "CommunityPost",
            entityId: postId,
          },
        }),
      ]);
    }
  } catch {
    notice = "community-database";
  }

  if (notice) {
    redirect(`/community?notice=${notice}`);
  }

  revalidatePath("/community");
  redirect("/community?notice=community-deleted");
}

function canWriteCommunity(session: AppSession) {
  return hasAnyRole(session, mutableCommunityRoles);
}

function allowedClinicIds(session: AppSession) {
  return session.activeClinicId
    ? [session.activeClinicId]
    : session.clinicIds;
}

function normalizeClinicId(value: FormDataEntryValue | null, session: AppSession) {
  const parsed = requiredString(value);

  if (!parsed || parsed === "all") {
    return canUseAllClinics(session) ? null : session.activeClinicId ?? "denied";
  }

  return session.clinicIds.includes(parsed) ? parsed : "denied";
}

function parsePostType(value: FormDataEntryValue | null) {
  const parsed = requiredString(value);
  const allowed = [
    "ANNOUNCEMENT",
    "CASE_DISCUSSION",
    "SHIFT_HANDOFF",
    "TRAINING",
    "POLICY",
  ] as const;

  return allowed.find((type) => type === parsed) ?? null;
}

async function writeCommunityAuditLog(input: {
  organizationId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
