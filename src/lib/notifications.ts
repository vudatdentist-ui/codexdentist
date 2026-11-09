import "server-only";

import type { Notification, Prisma } from "@prisma/client";
import { createHmac } from "crypto";
import {
  notificationBatchLimit,
  notificationDeliveryMode,
  notificationWebhookSecret,
  notificationWebhookUrl,
  resendEmailConfig,
  ownedMailConfig,
} from "@/lib/env";
import { deliverOwnedMail, ownedMailStatus, OwnedMailError } from "@/integrations/owned-mail/client";
import { prisma } from "@/lib/prisma";
import { credentialNotificationTemplateKeys } from "@/lib/notification-templates";

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

type NotificationDeliveryContent = Pick<Notification, "subject" | "body">;

export async function processDueNotifications(input: ProcessDueNotificationsInput = {}) {
  const now = input.now ?? new Date();
  const limit = sanitizeLimit(input.limit);
  const mode = notificationDeliveryMode();
  if (mode === "owned-mail") await reconcileOwnedMailNotifications(limit);
  const notifications = await prisma.notification.findMany({
    where: {
      // Credential bodies are deliberately redacted at rest. Only the caller
      // holding the ephemeral link can deliver them with processNotificationNow.
      AND: [{ OR: [{ templateKey: null }, { templateKey: { notIn: [...credentialNotificationTemplateKeys] } }] }],
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
  const skipped = results.filter((result) => result.status === "skipped").length;

  await writeBatchAudit(notifications, {
    processed: results.length,
    sent,
    failed,
    skipped,
    mode,
  });

  return {
    mode,
    processed: results.length,
    sent,
    failed,
    skipped,
    results,
  };
}

export async function processNotificationNow(
  id: string,
  deliveryContent?: NotificationDeliveryContent,
) {
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

  if (mode === "owned-mail" && notification.channel === "EMAIL" && notification.status === "PROCESSING") {
    const result = await reconcileOwnedMailNotification(notification);
    return { mode, processed: 1, sent: result.status === "sent" ? 1 : 0, failed: result.status === "failed" ? 1 : 0,
      skipped: result.status === "skipped" ? 1 : 0, results: [result] };
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

  const result = await deliverNotification(
    deliveryContent ? { ...notification, ...deliveryContent } : notification,
    mode,
    Boolean(deliveryContent),
  );

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
  hasCredentialContent = false,
): Promise<NotificationDeliveryResult> {
  const skipped = (reason: string): NotificationDeliveryResult => ({
    id: notification.id, channel: notification.channel,
    recipient: notification.recipient, status: "skipped", reason,
  });
  if (credentialNotificationTemplateKeys.some((key) => key === notification.templateKey) && !hasCredentialContent) {
    return skipped("Credential delivery requires a fresh one-time link.");
  }
  if (mode === "novu" && credentialNotificationTemplateKeys.some(key => key === notification.templateKey)) {
    return skipped("Credential notifications cannot use Novu delivery.");
  }
  // updateMany performs compare-and-set in the database. A stale batch read or
  // a concurrent immediate send cannot deliver a record already claimed/sent.
  const claim = await prisma.notification.updateMany({
    where: { id: notification.id, status: { in: ["DRAFT", "SCHEDULED"] },
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
    data: { status: "PROCESSING" },
  });
  if (claim.count !== 1) return skipped("Notification is not due or has already been claimed.");

  try {
    const organization = await prisma.organization.findUnique({
      where: {
        id: notification.organizationId,
      },
      select: {
        isDemo: true,
      },
    });

    if (organization?.isDemo && notification.channel !== "IN_APP") {
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

    // IN_APP is delivered by the existing persisted inbox, without a vendor.
    if (notification.channel !== "IN_APP") {
      if (mode === "novu") {
        const { deliverNotificationToNovu } = await import("@/lib/application/integrations/novu-delivery");
        const delivery = await deliverNotificationToNovu(notification);
        if (delivery.state === "REJECTED") throw new Error("novu-delivery-rejected");
        // Novu acknowledges queueing, not sending. Keep the atomic PROCESSING
        // claim until authenticated reconciliation confirms the message status.
        if (delivery.state !== "SENT") return skipped("Novu delivery awaits authenticated reconciliation.");
      } else if (mode === "log") {
        console.info("notification.simulated", { id: notification.id, channel: notification.channel });
      } else if (mode === "owned-mail") {
        if (notification.channel !== "EMAIL") throw new Error("notification-channel-not-configured");
        const config = ownedMailConfig();
        if (!config) throw new OwnedMailError("owned-mail-configuration-invalid");
        // Creation/schedule timestamps bind retries to the same finite envelope.
        // A new credential intent creates its own notification and one-time link.
        const origin = Math.max(notification.createdAt.getTime(), notification.scheduledAt?.getTime() ?? 0);
        const receipt = await deliverOwnedMail(config, { id: notification.id, organizationId: notification.organizationId,
          recipient: notification.recipient, subject: notification.subject, body: notification.body,
          templateKey: notification.templateKey, expiresAt: origin + 24 * 60 * 60 * 1000 });
        if (receipt.state === "REJECTED") throw new OwnedMailError("owned-mail-rejected", false);
        if (receipt.state !== "SENT") throw new OwnedMailError("owned-mail-awaiting-reconciliation");
        const sent = await prisma.notification.updateMany({ where: { id: notification.id, organizationId: notification.organizationId, status: "PROCESSING" },
          data: { status: "SENT", sentAt: new Date(), failedReason: null } });
        return sent.count === 1 ? { id: notification.id, channel: notification.channel, recipient: notification.recipient, status: "sent" }
          : skipped("Notification has already been reconciled.");
      } else if (mode === "resend") {
        if (notification.channel === "EMAIL") {
          await deliverToResend(notification);
        } else {
          throw new Error("notification-channel-not-configured");
        }
      } else {
        await deliverToWebhook(notification);
      }
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
    if (mode === "owned-mail" && error instanceof OwnedMailError && error.uncertain) {
      return skipped("Email delivery awaits authenticated reconciliation.");
    }
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

async function reconcileOwnedMailNotification(notification: Notification): Promise<NotificationDeliveryResult> {
  const result = (status: NotificationDeliveryResult["status"], reason?: string): NotificationDeliveryResult =>
    ({ id: notification.id, channel: notification.channel, recipient: notification.recipient, status, ...(reason ? { reason } : {}) });
  try {
    const config = ownedMailConfig();
    if (!config) return result("skipped", "Email delivery awaits authenticated reconciliation.");
    const receipt = await ownedMailStatus(config, { id: notification.id, organizationId: notification.organizationId });
    // Missing evidence never releases a previous uncertain dispatch for resend.
    if (!receipt || !["SENT", "REJECTED"].includes(receipt.state)) return result("skipped", "Email delivery awaits authenticated reconciliation.");
    const changed = await prisma.notification.updateMany({ where: { id: notification.id, organizationId: notification.organizationId, status: "PROCESSING" },
      data: receipt.state === "SENT" ? { status: "SENT", sentAt: new Date(), failedReason: null } : { status: "FAILED", failedReason: "owned-mail-rejected" } });
    if (changed.count !== 1) return result("skipped", "Notification has already been reconciled.");
    return result(receipt.state === "SENT" ? "sent" : "failed");
  } catch { return result("skipped", "Email delivery awaits authenticated reconciliation."); }
}

async function reconcileOwnedMailNotifications(limit: number) {
  const pending = await prisma.notification.findMany({ where: { channel: "EMAIL", status: "PROCESSING" },
    orderBy: { updatedAt: "asc" }, take: limit });
  for (const notification of pending) await reconcileOwnedMailNotification(notification);
}

async function deliverToResend(notification: Notification) {
  const config = resendEmailConfig();

  if (!config) {
    throw new Error("Resend delivery is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
      "Idempotency-Key": `notification/${notification.id}`,
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
    signal: AbortSignal.timeout(30_000),
    headers: { ...webhookHeaders(payload, notification.channel),
      "Idempotency-Key": `notification/${notification.id}` },
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
