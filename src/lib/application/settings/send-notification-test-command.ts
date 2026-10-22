import "server-only";
import type { Prisma } from "@prisma/client";
import { databaseActorId } from "@/lib/form-validation";
import { processNotificationNow } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canWriteSettings, writeSettingsAuditLog, } from "@/lib/application/settings/support";
export async function sendNotificationTestCommand(input: {
    session: AppSession;
    channel: string;
    recipient: string;
    subject: string;
    body: string;
}) {
    const { session, channel, recipient, subject, body } = input;
    if (!canWriteSettings(session)) {
        failCommand("settings-denied");
    }
    const allowedChannels = new Set(["EMAIL", "SMS", "ZALO"]);
    if (!allowedChannels.has(channel) || !recipient) {
        failCommand("settings-notification-test-missing");
    }
    const notification = await prisma.notification.create({
        data: {
            organizationId: session.organizationId,
            clinicId: session.activeClinicId,
            userId: databaseActorId(session.userId),
            channel: channel as "EMAIL" | "SMS" | "ZALO",
            status: "DRAFT",
            templateKey: "SETTINGS_TEST",
            recipient,
            subject,
            body,
            metadata: {
                source: "settings_test",
            } satisfies Prisma.InputJsonObject,
        },
        select: {
            id: true,
        },
    });
    const result = await processNotificationNow(notification.id);
    const firstResult = result.results[0];
    await writeSettingsAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "notification.test_sent",
        entityType: "Notification",
        entityId: notification.id,
        metadata: {
            channel,
            recipient,
            mode: result.mode,
            result: firstResult?.status ?? "unknown",
            reason: firstResult?.reason ?? null,
        },
    });
    if (firstResult?.status === "failed") {
        failCommand("settings-notification-test-failed");
    }
}
