import "server-only";

import { credentialNotificationTemplateKeys } from "@/lib/notification-templates";
import { accessibleViews, canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import type { AppShellNotification } from "@/shared/layout/AppShell/types";

export async function loadAppShellContext(session: AppSession) {
  const notifications = await loadNotificationSummary(session);

  return {
    allowedViews: accessibleViews(session),
    context: {
      fullName: session.fullName,
      organizationName: session.organizationName,
      role: session.role,
      clinics: session.clinics.map((clinic) => ({
        id: clinic.id,
        name: clinic.name,
      })),
    },
    notifications,
  };
}

async function loadNotificationSummary(session: AppSession): Promise<AppShellNotification[]> {
  const clinicIds = canUseAllClinics(session)
    ? session.clinicIds
    : session.activeClinicId
      ? [session.activeClinicId]
      : session.clinicIds;

  try {
    const notifications = await prisma.notification.findMany({
      where: {
        organizationId: session.organizationId,
        AND: [
          {
            OR: [
              { templateKey: null },
              { templateKey: { notIn: credentialNotificationTemplateKeys } },
            ],
          },
          {
            OR: [
              { userId: session.userId },
              { userId: null, clinicId: { in: clinicIds } },
              { clinicId: null, userId: null },
            ],
          },
          {
            OR: [
              { status: { in: ["DRAFT", "SCHEDULED", "FAILED"] } },
              { channel: "IN_APP", status: "SENT" },
            ],
          },
        ],
      },
      select: {
        id: true,
        subject: true,
        templateKey: true,
        body: true,
        metadata: true,
        createdAt: true,
        clinic: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
    });

    return notifications.map((notification) => ({
      id: `notification-${notification.id}`,
      title: notification.subject ?? notification.templateKey ?? "Notification",
      detail: notification.body,
      href: metadataActionUrl(notification.metadata) ?? "/dashboard",
      clinicName: notification.clinic?.name ?? null,
      createdAt: vietnamDateTime(notification.createdAt),
    }));
  } catch {
    return [];
  }
}

function metadataActionUrl(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || !("actionUrl" in metadata)) {
    return null;
  }

  const value = (metadata as { actionUrl?: unknown }).actionUrl;
  return typeof value === "string" && value.startsWith("/") ? value : null;
}

function vietnamDateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}
