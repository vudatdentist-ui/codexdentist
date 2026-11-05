export function notificationConfigurationErrors(environment) {
  const value = name => String(environment[name] ?? "").trim();
  const mode = value("NOTIFICATION_DELIVERY_MODE");
  if (mode === "resend") {
    const errors = [];
    if (!value("RESEND_API_KEY")) errors.push("Set RESEND_API_KEY for Resend email delivery.");
    if (!value("RESEND_FROM_EMAIL")) errors.push("Set RESEND_FROM_EMAIL for Resend email delivery.");
    return errors;
  }
  if (mode !== "webhook") return ["Configure a production notification provider: resend or webhook."];
  const errors = [];
  for (const channel of ["EMAIL", "SMS", "ZALO"]) {
    const target = value(`NOTIFICATION_${channel}_WEBHOOK_URL`) || value("NOTIFICATION_WEBHOOK_URL");
    const secret = value(`NOTIFICATION_${channel}_WEBHOOK_SECRET`) || value("NOTIFICATION_WEBHOOK_SECRET");
    let secure = false;
    try { secure = new URL(target).protocol === "https:"; } catch { /* Invalid provider URL. */ }
    if (!secure) errors.push(`Set HTTPS notification webhook URL for ${channel}.`);
    if (secret.length < 24) errors.push(`Set notification webhook secret for ${channel}.`);
  }
  return errors;
}
