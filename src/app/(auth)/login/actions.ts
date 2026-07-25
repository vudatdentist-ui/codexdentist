"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { signIn } from "@/lib/auth";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { processNotificationNow } from "@/lib/notifications";
import { createPasswordSetupToken } from "@/lib/password-reset";
import { prisma } from "@/lib/prisma";
import { superAdminEmails } from "@/lib/super-admin";
import {
  currentHostname,
  findTenantOrganization,
  isNeutralAppHostname,
  tenantSlugFromHostname,
} from "@/lib/tenant";
import {
  clearLoginAttempts,
  consumeLoginAttempt,
  consumePasswordResetAttempt,
} from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/request-ip";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const key = await loginRateLimitKey(email);
  const limit = await consumeLoginAttempt(key);

  if (!limit.allowed) {
    redirect("/login?error=rate-limited");
  }

  const result = await signIn(email, password);

  if (!result.ok) {
    redirect(`/login?error=${result.reason}`);
  }

  await clearLoginAttempts(key);
  redirect("/dashboard");
}

export async function forgotPasswordAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const key = await loginRateLimitKey(`forgot:${email}`);
  const limit = await consumePasswordResetAttempt(key);

  if (!limit.allowed) {
    redirect("/login?forgot=sent");
  }

  if (!email) {
    redirect("/login?forgot=sent");
  }

  try {
    const hostname = await currentHostname();
    const tenantSlug = tenantSlugFromHostname(hostname);
    const tenant = tenantSlug ? await findTenantOrganization(tenantSlug) : null;

    if (tenantSlug && !tenant) {
      redirect("/login?forgot=sent");
    }

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
      select: {
        id: true,
        organizationId: true,
        fullName: true,
        email: true,
        active: true,
        clinics: {
          select: {
            clinicId: true,
          },
          take: 1,
        },
      },
    });

    const canResetOnThisDomain = tenant
      ? user?.organizationId === tenant.id
      : !isNeutralAppHostname(hostname) || superAdminEmails().includes(email);

    if (user?.active && canResetOnThisDomain) {
      const reset = await createPasswordSetupToken({
        organizationId: user.organizationId,
        userId: user.id,
        purpose: "PASSWORD_RESET",
      });
      const rendered = renderNotificationTemplate("PASSWORD_RESET", {
        fullName: user.fullName,
        resetUrl: reset.url,
        expiresAt: reset.expiresAt.toISOString(),
      });

      const notification = await prisma.notification.create({
        data: {
          organizationId: user.organizationId,
          clinicId: user.clinics[0]?.clinicId ?? null,
          userId: user.id,
          channel: "EMAIL",
          status: "SCHEDULED",
          templateKey: "PASSWORD_RESET",
          recipient: user.email,
          subject: rendered.subject,
          body: rendered.body,
          scheduledAt: new Date(),
          metadata: {
            purpose: "PASSWORD_RESET",
          },
        },
      });

      await processNotificationNow(notification.id);
      await prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorId: null,
          action: "user.password_reset_requested",
          entityType: "User",
          entityId: user.id,
          metadata: {
            notificationId: notification.id,
          },
        },
      });
    }
  } catch {
    // Keep the same response to avoid account enumeration from the login page.
  }

  redirect("/login?forgot=sent");
}

async function loginRateLimitKey(email: string) {
  const headerStore = await headers();
  const ip = clientIpFromHeaders(headerStore);

  return `${ip}:${email}`;
}
