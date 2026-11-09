export function notificationConfigurationErrors(environment) {
  const value = name => String(environment[name] ?? "").trim();
  const mode = value("NOTIFICATION_DELIVERY_MODE");
  if (mode === "owned-mail") {
    const errors = [];
    let valid = false;
    try {
      const url = new URL(value("OWNED_MAIL_BASE_URL"));
      valid = url.protocol === "https:" && ["codexdentist-mail-gateway", "127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
        !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
    } catch { /* Invalid owned origin remains a failed gate. */ }
    if (!valid) errors.push("Set an explicit private HTTPS owned mail gateway origin.");
    if (String(environment.OWNED_MAIL_SIGNING_SECRET ?? "").length < 32) errors.push("Set a strong owned mail signing secret.");
    if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(value("OWNED_MAIL_FROM")) || value("OWNED_MAIL_FROM").length > 254) errors.push("Set the owned mail sender address.");
    return errors;
  }
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
