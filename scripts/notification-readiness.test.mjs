import test from "node:test";
import assert from "node:assert/strict";
import { notificationConfigurationErrors } from "./lib/notification-readiness.mjs";
test("go-live validates the configured supported provider without requiring unused webhook credentials", () => {
  assert.deepEqual(notificationConfigurationErrors({ NOTIFICATION_DELIVERY_MODE: "resend", RESEND_API_KEY: "synthetic", RESEND_FROM_EMAIL: "clinic@example.test" }), []);
  assert.equal(notificationConfigurationErrors({ NOTIFICATION_DELIVERY_MODE: "resend" }).length, 2);
  for (const mode of ["", "disabled", "log", "unknown"]) assert.ok(notificationConfigurationErrors({ NOTIFICATION_DELIVERY_MODE: mode }).length);
  const webhook = { NOTIFICATION_DELIVERY_MODE: "webhook", NOTIFICATION_WEBHOOK_URL: "https://notify.example.test", NOTIFICATION_WEBHOOK_SECRET: "a".repeat(32) };
  assert.deepEqual(notificationConfigurationErrors(webhook), []);
  assert.ok(notificationConfigurationErrors({ ...webhook, NOTIFICATION_WEBHOOK_URL: "http://notify.example.test" }).length);
  assert.ok(notificationConfigurationErrors({ ...webhook, NOTIFICATION_WEBHOOK_SECRET: "short" }).length);
});
