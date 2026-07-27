import "server-only";

import { createHash, randomBytes } from "crypto";
import { hashPassword } from "@/lib/auth";
import { appBaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { tenantDomainForSlug } from "@/lib/tenant";
import { runSerializableTransaction } from "@/lib/transaction";

const TOKEN_TTL_MS =
  process.env.NODE_ENV === "production" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 10;

export async function createPasswordSetupToken(input: {
  organizationId: string;
  userId: string;
  createdById?: string | null;
  purpose?: string;
}) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);

  await prisma.passwordResetToken.updateMany({
    where: {
      userId: input.userId,
      usedAt: null,
      expiresAt: {
        gt: now,
      },
    },
    data: {
      usedAt: now,
    },
  });

  await prisma.passwordResetToken.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      createdById: input.createdById ?? null,
      tokenHash: hashToken(token),
      purpose: input.purpose ?? "STAFF_PASSWORD_SETUP",
      expiresAt,
    },
  });

  return {
    token,
    expiresAt,
    url: await passwordSetupUrl(token, input.organizationId),
  };
}

export async function resetPasswordWithToken(input: {
  token: string;
  password: string;
}) {
  const token = input.token.trim();
  const password = input.password.trim();

  if (!token || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false as const, reason: "invalid" as const };
  }

  const now = new Date();
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: {
      tokenHash: hashToken(token),
    },
    include: {
      user: {
        select: {
          id: true,
          active: true,
        },
      },
    },
  });

  if (!resetToken) {
    return { ok: false as const, reason: "expired" as const };
  }

  if (
    resetToken.usedAt ||
    resetToken.expiresAt <= now ||
    !resetToken.user.active
  ) {
    await prisma.auditLog.create({
      data: {
        organizationId: resetToken.organizationId,
        actorId: null,
        action: "staff.password_reset_failed",
        entityType: "User",
        entityId: resetToken.userId,
        metadata: {
          purpose: resetToken.purpose,
          used: Boolean(resetToken.usedAt),
          expired: resetToken.expiresAt <= now,
          inactiveUser: !resetToken.user.active,
        },
      },
    });

    return { ok: false as const, reason: "expired" as const };
  }

  try {
    await runSerializableTransaction(async (tx) => {
      const claim = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: {
            gt: now,
          },
          user: {
            active: true,
          },
        },
        data: {
          usedAt: now,
        },
      });

      if (claim.count !== 1) {
        throw new PasswordResetClaimError();
      }

      await tx.user.update({
        where: {
          id: resetToken.userId,
        },
        data: {
          passwordHash: hashPassword(password),
          mustChangePassword: false,
          passwordChangedAt: now,
        },
      });
      await tx.session.deleteMany({
        where: {
          userId: resetToken.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: resetToken.organizationId,
          actorId: null,
          action: "staff.password_set",
          entityType: "User",
          entityId: resetToken.userId,
          metadata: {
            purpose: resetToken.purpose,
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof PasswordResetClaimError) {
      return { ok: false as const, reason: "expired" as const };
    }
    throw error;
  }

  return { ok: true as const };
}

class PasswordResetClaimError extends Error {}

export async function passwordSetupUrl(token: string, organizationId: string) {
  const baseUrl = await organizationBaseUrl(organizationId);

  return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

export function passwordRequirementsText(language: "vi" | "en" = "vi") {
  return language === "vi"
    ? `Mật khẩu cần tối thiểu ${MIN_PASSWORD_LENGTH} ký tự.`
    : `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
}
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function organizationBaseUrl(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: {
      id: organizationId,
    },
    select: {
      primaryDomain: true,
      slug: true,
    },
  });
  const domain =
    organization?.primaryDomain?.trim() ||
    (organization?.slug ? tenantDomainForSlug(organization.slug) : "");

  return domain ? absoluteBaseUrlForDomain(domain) : appBaseUrl();
}

function absoluteBaseUrlForDomain(domain: string) {
  const trimmedDomain = domain.trim().replace(/\/+$/, "");

  if (/^https?:\/\//i.test(trimmedDomain)) {
    return new URL(trimmedDomain).toString().replace(/\/+$/, "");
  }

  const protocol = new URL(appBaseUrl()).protocol;

  return `${protocol}//${trimmedDomain}`;
}
