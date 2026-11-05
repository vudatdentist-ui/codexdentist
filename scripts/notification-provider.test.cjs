const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./audit-source-loader.cjs");
const templates = load("src/lib/notification-templates.ts");

test("internal notifications remain local while unsupported external delivery fails without PHI logging", async () => {
  for (const [channel, demo] of ["SMS", "ZALO", "PUSH", "PHONE", "IN_APP"].flatMap(channel => [[channel, false], [channel, true]])) {
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
        organization: { findUnique: async () => ({ isDemo: demo }) }, auditLog: { createMany: async () => ({}) },
      } },
    }, { fetch: async () => { network++; }, console: { info: (...items) => logs.push(items), error: (...items) => logs.push(items) } });
    const result = await service.processNotificationNow("notification");
    const internal = channel === "IN_APP";
    assert.equal(result.sent, internal ? 1 : 0);
    assert.equal(result.failed, internal || demo ? 0 : 1);
    assert.equal(result.skipped, !internal && demo ? 1 : 0);
    assert.equal(status, internal ? "SENT" : demo ? "CANCELLED" : "FAILED");
    assert.equal(network, 0);
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE/);
    assert.equal(result.results[0].reason, internal ? undefined : demo ? "External delivery is disabled for demo workspaces." : "notification-channel-not-configured");
  }
});
