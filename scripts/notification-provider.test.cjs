const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./audit-source-loader.cjs");
const templates = load("src/lib/notification-templates.ts");

test("Resend never claims successful delivery for an unsupported external channel or logs its PHI", async () => {
  for (const channel of ["SMS", "ZALO", "PUSH", "PHONE"]) {
    let status = "SCHEDULED";
    let network = 0;
    const logs = [];
    const service = load("src/lib/notifications.ts", {
      "@/lib/notification-templates": templates,
      "@/lib/env": { notificationDeliveryMode: () => "resend", notificationBatchLimit: () => 10 },
      "@/lib/prisma": { prisma: {
        notification: {
          findUnique: async () => ({ id: "notification", organizationId: "org", channel, status, recipient: "PRIVATE phone", subject: "PRIVATE procedure", templateKey: null }),
          updateMany: async ({ data }) => { status = data.status; return { count: 1 }; },
          update: async ({ data }) => { status = data.status; },
        },
        organization: { findUnique: async () => ({ isDemo: false }) }, auditLog: { createMany: async () => ({}) },
      } },
    }, { fetch: async () => { network++; }, console: { info: (...items) => logs.push(items), error: (...items) => logs.push(items) } });
    const result = await service.processNotificationNow("notification");
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
    assert.equal(status, "FAILED");
    assert.equal(network, 0);
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE/);
    assert.equal(result.results[0].reason, "notification-channel-not-configured");
  }
});
