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

test("owned email go-live accepts only a signed private HTTPS gateway and an actual sender", () => {
  const valid={NOTIFICATION_DELIVERY_MODE:"owned-mail",OWNED_MAIL_BASE_URL:"https://codexdentist-mail-gateway:3443",OWNED_MAIL_SIGNING_SECRET:"a".repeat(32),OWNED_MAIL_FROM:"no-reply@example.test"};
  assert.deepEqual(notificationConfigurationErrors(valid),[]);
  for(const url of ["http://codexdentist-mail-gateway:3443","https://cloud-mail.example.com","https://user:secret@codexdentist-mail-gateway:3443","https://codexdentist-mail-gateway:3443/other","https://codexdentist-mail-gateway:3443/?key=secret"]){
    assert.ok(notificationConfigurationErrors({...valid,OWNED_MAIL_BASE_URL:url}).length);
  }
  for(const from of ["","Name <no-reply@example.test>","a@example.test\r\nBcc: other@example.test"]){
    assert.ok(notificationConfigurationErrors({...valid,OWNED_MAIL_FROM:from}).length);
  }
});
