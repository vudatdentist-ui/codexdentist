import "server-only";

const developmentDatabaseUrl =
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const developmentAuthSecret = "development-only-nhavista-auth-secret";
const developmentJobSecret = "development-only-nhavista-job-secret";
const developmentAppBaseUrl = "http://127.0.0.1:3000";
const buildAuthSecret = "codexdentist-build-only-auth-secret-never-used-at-runtime";
const buildJobSecret = "codexdentist-build-only-job-secret-never-used-at-runtime";
const weakAuthSecretValues = new Set([
  developmentAuthSecret,
  "replace-with-a-long-random-secret-before-production",
  "local-development-nhavista-secret-change-before-production",
]);
const weakJobSecretValues = new Set([
  developmentJobSecret,
  "replace-with-a-long-random-job-secret-before-production",
]);

export type NotificationDeliveryMode = "disabled" | "log" | "webhook" | "resend";
export type NotificationWebhookChannel = "EMAIL" | "SMS" | "ZALO" | "PUSH" | "IN_APP" | "PHONE";
export type PatientFileStorageDriver = "local" | "r2";
export type CodexMedAiProvider = "openai-compatible";
export type DeploymentMode = "hosted" | "self-hosted";
export type TrustedProxyProvider = "none" | "cloudflare" | "reverse-proxy";

export function databaseUrl() {
  const value = process.env.DATABASE_URL?.trim();

  if (value) {
    return value;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production.");
  }

  return developmentDatabaseUrl;
}

export function authSecret() {
  if (process.env.CODEXDENTIST_BUILD === "1") {
    return buildAuthSecret;
  }

  const value = process.env.AUTH_SECRET?.trim() || developmentAuthSecret;

  if (process.env.NODE_ENV === "production") {
    if (weakAuthSecretValues.has(value) || value.length < 32) {
      throw new Error("AUTH_SECRET must be a strong unique value in production.");
    }
  }

  return value;
}

export function jobSecret() {
  if (process.env.CODEXDENTIST_BUILD === "1") {
    return buildJobSecret;
  }

  const value = process.env.JOB_SECRET?.trim() || developmentJobSecret;

  if (process.env.NODE_ENV === "production") {
    if (weakJobSecretValues.has(value) || value.length < 32) {
      throw new Error("JOB_SECRET must be a strong unique value in production.");
    }
  }

  return value;
}

export function demoAuthEnabled() {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return process.env.DEMO_AUTH_ENABLED !== "false";
}

export function defaultDataSeedEnabled() {
  return process.env.DEFAULT_DATA_SEED_ENABLED === "true";
}

export function deploymentMode(): DeploymentMode {
  return process.env.DEPLOYMENT_MODE === "self-hosted" ? "self-hosted" : "hosted";
}

export function trustedProxyProvider(): TrustedProxyProvider {
  const value = process.env.TRUSTED_PROXY_PROVIDER?.trim().toLowerCase() || "none";

  if (!["none", "cloudflare", "reverse-proxy"].includes(value)) {
    throw new Error(
      "TRUSTED_PROXY_PROVIDER must be none, cloudflare, or reverse-proxy.",
    );
  }

  return value as TrustedProxyProvider;
}

export function demoWorkspaceEnabled() {
  return process.env.DEMO_WORKSPACE_ENABLED === "true";
}

export function demoWorkspaceTtlHours() {
  const parsed = Number(process.env.DEMO_WORKSPACE_TTL_HOURS ?? "24");

  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 72) : 24;
}

export function demoWorkspaceLimit() {
  const parsed = Number(process.env.DEMO_WORKSPACE_LIMIT ?? "30");

  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 250) : 30;
}

export function appRootDomain() {
  return process.env.APP_ROOT_DOMAIN?.trim().toLowerCase() || "codexdentist.com";
}

export function sessionCookieSecure() {
  const value = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();

  if (value) {
    return ["1", "true", "yes"].includes(value);
  }

  return process.env.NODE_ENV === "production";
}

export function notificationDeliveryMode(): NotificationDeliveryMode {
  const value = (process.env.NOTIFICATION_DELIVERY_MODE?.trim().toLowerCase() ||
    (process.env.NODE_ENV === "production" ? "disabled" : "log")) as NotificationDeliveryMode;

  if (!["disabled", "log", "webhook", "resend"].includes(value)) {
    throw new Error(
      "NOTIFICATION_DELIVERY_MODE must be one of disabled, log, webhook, or resend.",
    );
  }

  return value;
}

export function resendEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();

  if (notificationDeliveryMode() !== "resend") {
    return null;
  }

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required when NOTIFICATION_DELIVERY_MODE=resend.");
  }

  if (!from) {
    throw new Error("RESEND_FROM_EMAIL is required when NOTIFICATION_DELIVERY_MODE=resend.");
  }

  return {
    apiKey,
    from,
  };
}

export function notificationWebhookUrl(channel?: string) {
  const normalizedChannel = normalizeNotificationChannel(channel);
  const channelValue = normalizedChannel
    ? process.env[`NOTIFICATION_${normalizedChannel}_WEBHOOK_URL`]?.trim()
    : "";
  const value = channelValue || process.env.NOTIFICATION_WEBHOOK_URL?.trim();

  if (!value) {
    if (notificationDeliveryMode() === "webhook") {
      throw new Error(
        normalizedChannel
          ? `NOTIFICATION_${normalizedChannel}_WEBHOOK_URL or NOTIFICATION_WEBHOOK_URL is required for webhook delivery.`
          : "NOTIFICATION_WEBHOOK_URL is required for webhook delivery.",
      );
    }

    return null;
  }

  const parsed = new URL(value);

  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("Notification webhook URLs must use HTTPS in production.");
  }

  return parsed.toString();
}

export function notificationWebhookSecret(channel?: string) {
  const normalizedChannel = normalizeNotificationChannel(channel);
  const channelSecret = normalizedChannel
    ? process.env[`NOTIFICATION_${normalizedChannel}_WEBHOOK_SECRET`]?.trim()
    : "";

  return channelSecret || process.env.NOTIFICATION_WEBHOOK_SECRET?.trim() || "";
}

export function notificationBatchLimit() {
  const parsed = Number(process.env.NOTIFICATION_BATCH_LIMIT ?? "50");

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 50;
  }

  return Math.min(Math.floor(parsed), 500);
}

export function appBaseUrl() {
  const value = process.env.APP_BASE_URL?.trim() || developmentAppBaseUrl;
  const parsed = new URL(value);

  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use HTTPS in production.");
  }

  return parsed.toString().replace(/\/$/, "");
}

export function patientFileStorageDriver(): PatientFileStorageDriver {
  const value = process.env.PATIENT_FILE_STORAGE_DRIVER?.trim().toLowerCase() || "local";

  if (value !== "local" && value !== "r2") {
    throw new Error("PATIENT_FILE_STORAGE_DRIVER must be local or r2.");
  }

  if (
    value === "local" &&
    process.env.NODE_ENV === "production" &&
    deploymentMode() !== "self-hosted"
  ) {
    throw new Error(
      "Local patient file storage is blocked in production. Use PATIENT_FILE_STORAGE_DRIVER=r2.",
    );
  }

  return value as PatientFileStorageDriver;
}

export function patientFileStorageRoot() {
  return process.env.PATIENT_FILE_STORAGE_ROOT?.trim() || "";
}

export function r2StorageConfig() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

  if (patientFileStorageDriver() !== "r2") {
    return null;
  }

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ACCOUNT_ID or R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required for R2 storage.",
    );
  }

  const parsed = new URL(endpoint);

  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("R2_ENDPOINT must use HTTPS in production.");
  }

  return {
    endpoint: parsed.toString().replace(/\/$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

export function codexMedAiConfig() {
  const enabled = process.env.CODEXMED_AI_ENABLED === "true";
  const provider =
    (process.env.CODEXMED_AI_PROVIDER?.trim().toLowerCase() || "openai-compatible") as CodexMedAiProvider;
  const baseUrl = process.env.CODEXMED_AI_BASE_URL?.trim() || "";
  const apiKey = process.env.CODEXMED_AI_API_KEY?.trim() || "";
  const model = process.env.CODEXMED_AI_MODEL?.trim() || "cx/gpt-5.5";

  if (provider !== "openai-compatible") {
    throw new Error("CODEXMED_AI_PROVIDER must be openai-compatible.");
  }

  if (!enabled) {
    return {
      enabled,
      provider,
      baseUrl,
      apiKey: "",
      model,
    };
  }

  if (!baseUrl) {
    throw new Error("CODEXMED_AI_BASE_URL is required when CODEXMED_AI_ENABLED=true.");
  }

  if (!apiKey) {
    throw new Error("CODEXMED_AI_API_KEY is required when CODEXMED_AI_ENABLED=true.");
  }

  const parsedBaseUrl = new URL(baseUrl);

  if (
    process.env.NODE_ENV === "production" &&
    parsedBaseUrl.protocol !== "https:" &&
    !isLoopbackUrl(parsedBaseUrl)
  ) {
    throw new Error("CODEXMED_AI_BASE_URL must use HTTPS in production.");
  }

  return {
    enabled,
    provider,
    baseUrl: parsedBaseUrl.toString().replace(/\/$/, ""),
    apiKey,
    model,
  };
}

function isLoopbackUrl(url: URL) {
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function normalizeNotificationChannel(channel?: string): NotificationWebhookChannel | null {
  const value = channel?.trim().toUpperCase();

  if (!value) {
    return null;
  }

  if (["EMAIL", "SMS", "ZALO", "PUSH", "IN_APP", "PHONE"].includes(value)) {
    return value as NotificationWebhookChannel;
  }

  return null;
}
