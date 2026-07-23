import "server-only";

import type { Notification, Prisma } from "@prisma/client";
import { createHmac } from "crypto";
import {
  notificationBatchLimit,
  notificationDeliveryMode,
  notificationWebhookSecret,
  notificationWebhookUrl,
  resendEmailConfig,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";

type ProcessDueNotificationsInput = {
  now?: Date;
  limit?: number;
};

type NotificationDeliveryResult = {
  id: string;
  channel: string;
  recipient: string;
  status: "sent" | "failed" | "skipped";
  reason?: string;
};

export async function processDueNotifications(input: ProcessDueNotificationsInput = {}) {
  const now = input.now ?? new Date();
  const limit = sanitizeLimit(input.limit);
  const mode = notificationDeliveryMode();
  const notifications = await prisma.notification.findMany({
    where: {
      status: {
        in: ["DRAFT", "SCHEDULED"],
      },
      OR: [
        {
          scheduledAt: null,
        },
        {
          scheduledAt: {
            lte: now,
          },
        },
      ],
    },
    orderBy: [
      {
        scheduledAt: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    take: limit,
  });

  if (mode === "disabled") {
    await writeBatchAudit(notifications, {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: notifications.length,
      mode,
    });

    return {
      mode,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: notifications.length,
      results: notifications.map((notification) => ({
        id: notification.id,
        channel: notification.channel,
        recipient: notification.recipient,
        status: "skipped" as const,
        reason: "Notification delivery is disabled.",
      })),
    };
  }

  const results: NotificationDeliveryResult[] = [];

  for (const notification of notifications) {
    if (shouldThrottleResendEmail(mode, notification, results)) {
      await sleep(600);
    }

    const result = await deliverNotification(notification, mode);
    results.push(result);
  }

  const sent = results.filter((result) => result.status === "sent").length;
  const failed = results.filter((result) => result.status === "failed").length;

  await writeBatchAudit(notifications, {
    processed: results.length,
    sent,
    failed,
    skipped: 0,
    mode,
  });

  return {
    mode,
    processed: results.length,
    sent,
    failed,
    skipped: 0,
    results,
  };
}

export async function processNotificationNow(id: string) {
  const mode = notificationDeliveryMode();
  const notification = await prisma.notification.findUnique({
    where: {
      id,
    },
  });

  if (!notification) {
    return {
      mode,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };
  }

  if (mode === "disabled") {
    await writeBatchAudit([notification], {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 1,
      mode,
    });

    return {
      mode,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 1,
      results: [
        {
          id: notification.id,
          channel: notification.channel,
          recipient: notification.recipient,
          status: "skipped" as const,
          reason: "Notification delivery is disabled.",
        },
      ],
    };
  }

  const result = await deliverNotification(notification, mode);

  await writeBatchAudit([notification], {
    processed: 1,
    sent: result.status === "sent" ? 1 : 0,
    failed: result.status === "failed" ? 1 : 0,
    skipped: result.status === "skipped" ? 1 : 0,
    mode,
  });

  return {
    mode,
    processed: 1,
    sent: result.status === "sent" ? 1 : 0,
    failed: result.status === "failed" ? 1 : 0,
    skipped: result.status === "skipped" ? 1 : 0,
    results: [result],
  };
}

async function deliverNotification(
  notification: Notification,
  mode: Exclude<ReturnType<typeof notificationDeliveryMode>, "disabled">,
): Promise<NotificationDeliveryResult> {
  try {
    const organization = await prisma.organization.findUnique({
      where: {
        id: notification.organizationId,
      },
      select: {
        isDemo: true,
      },
    });

    if (organization?.isDemo) {
      await prisma.notification.update({
        where: {
          id: notification.id,
        },
        data: {
          status: "CANCELLED",
          failedReason: "External delivery is disabled for demo workspaces.",
        },
      });

      return {
        id: notification.id,
        channel: notification.channel,
        recipient: notification.recipient,
        status: "skipped",
        reason: "External delivery is disabled for demo workspaces.",
      };
    }

    if (mode === "log") {
      console.info(
        `[notification:${notification.channel}] ${notification.recipient} ${notification.subject ?? ""}`,
      );
    } else if (mode === "resend") {
      if (notification.channel === "EMAIL") {
        await deliverToResend(notification);
      } else {
        console.info(
          `[notification:${notification.channel}] ${notification.recipient} ${notification.subject ?? ""}`,
        );
      }
    } else {
      await deliverToWebhook(notification);
    }

    await prisma.notification.update({
      where: {
        id: notification.id,
      },
      data: {
        status: "SENT",
        sentAt: new Date(),
        failedReason: null,
      },
    });

    return {
      id: notification.id,
      channel: notification.channel,
      recipient: notification.recipient,
      status: "sent",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown delivery error";

    await prisma.notification.update({
      where: {
        id: notification.id,
      },
      data: {
        status: "FAILED",
        failedReason: reason.slice(0, 500),
      },
    });

    return {
      id: notification.id,
      channel: notification.channel,
      recipient: notification.recipient,
      status: "failed",
      reason,
    };
  }
}

async function deliverToResend(notification: Notification) {
  const config = resendEmailConfig();

  if (!config) {
    throw new Error("Resend delivery is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [notification.recipient],
      subject: notification.subject ?? "Codexdentist notification",
      text: notification.body,
      html: notificationHtml(notification),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Resend returned HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
    );
  }
}

async function deliverToWebhook(notification: Notification) {
  const webhookUrl = notificationWebhookUrl(notification.channel);

  if (!webhookUrl) {
    throw new Error("Notification webhook URL is not configured.");
  }

  const payload = webhookPayload(notification);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: webhookHeaders(payload, notification.channel),
    body: payload,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Notification webhook returned HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }
}

function notificationHtml(notification: Notification) {
  const escapedBody = escapeHtml(notification.body)
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "<br />");

  return [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#102027">',
    `<p>${escapedBody}</p>`,
    "</div>",
  ].join("");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function webhookPayload(notification: Notification) {
  return JSON.stringify({
    id: notification.id,
    organizationId: notification.organizationId,
    clinicId: notification.clinicId,
    patientId: notification.patientId,
    userId: notification.userId,
    campaignId: notification.campaignId,
    channel: notification.channel,
    recipient: notification.recipient,
    subject: notification.subject,
    body: notification.body,
    templateKey: notification.templateKey,
    metadata: notification.metadata,
  });
}

function webhookHeaders(payload: string, channel: string) {
  const secret = notificationWebhookSecret(channel);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-nhavista-event": "notification.delivery",
    "x-nhavista-channel": channel,
  };

  if (secret) {
    headers["x-nhavista-signature"] = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
  }

  return headers;
}

async function writeBatchAudit(
  notifications: Notification[],
  metadata: Prisma.InputJsonObject,
) {
  if (notifications.length === 0) {
    return;
  }

  const organizationIds = Array.from(
    new Set(notifications.map((notification) => notification.organizationId)),
  );

  await prisma.auditLog.createMany({
    data: organizationIds.map((organizationId) => ({
      organizationId,
      actorId: null,
      action: "notification.batch_processed",
      entityType: "Notification",
      entityId: organizationId,
      metadata,
    })),
  });
}

function sanitizeLimit(limit?: number) {
  if (!limit || !Number.isFinite(limit)) {
    return notificationBatchLimit();
  }

  return Math.min(Math.max(Math.floor(limit), 1), notificationBatchLimit());
}

function shouldThrottleResendEmail(
  mode: ReturnType<typeof notificationDeliveryMode>,
  notification: Notification,
  results: NotificationDeliveryResult[],
) {
  return mode === "resend" && notification.channel === "EMAIL" && results.length > 0;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
