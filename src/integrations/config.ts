import "server-only";

const SECRET_REF_PATTERN = /^env:([A-Z][A-Z0-9_]*)$/;

function envPrefix(secretRef: string | null, provider: string) {
  const match = secretRef?.match(SECRET_REF_PATTERN);
  if (!match) {
    throw new IntegrationConfigurationError(
      `${provider}-secret-ref-invalid`,
      `${provider} connection secretRef must use env:<PREFIX>`,
    );
  }
  return match[1]!;
}

function requiredEnv(name: string, provider: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new IntegrationConfigurationError(
      `${provider}-credential-missing`,
      `${name} is required for ${provider}`,
    );
  }
  return value;
}

function optionalBaseUrl(name: string, fallback: string, provider: string) {
  const value = process.env[name]?.trim() || fallback;
  const url = new URL(value);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new IntegrationConfigurationError(
      `${provider}-base-url-insecure`,
      `${name} must use HTTPS in production`,
    );
  }
  return url.toString().replace(/\/$/, "");
}

export function resolvePayOSConnectionSecrets(secretRef: string | null) {
  const prefix = envPrefix(secretRef, "payos");
  return {
    clientId: requiredEnv(`${prefix}_CLIENT_ID`, "payos"),
    apiKey: requiredEnv(`${prefix}_API_KEY`, "payos"),
    checksumKey: requiredEnv(`${prefix}_CHECKSUM_KEY`, "payos"),
    baseUrl: optionalBaseUrl(
      `${prefix}_BASE_URL`,
      "https://api-merchant.payos.vn",
      "payos",
    ),
  };
}

export function resolveDocumensoConnectionSecrets(secretRef: string | null) {
  const prefix = envPrefix(secretRef, "documenso");
  return {
    apiToken: requiredEnv(`${prefix}_API_TOKEN`, "documenso"),
    webhookSecret: requiredEnv(`${prefix}_WEBHOOK_SECRET`, "documenso"),
    baseUrl: optionalBaseUrl(
      `${prefix}_BASE_URL`,
      "https://app.documenso.com/api/v2",
      "documenso",
    ),
  };
}

export function resolveOrthancConnectionSecrets(secretRef: string | null) {
  const prefix = envPrefix(secretRef, "orthanc");
  const baseUrl = orthancBaseUrl(
    `${prefix}_BASE_URL`,
    process.env.NODE_ENV === "production" ? "https://orthanc.invalid" : "http://127.0.0.1:8042",
  );
  const viewerBaseUrl = optionalViewerBaseUrl(`${prefix}_VIEWER_BASE_URL`);
  const username = process.env[`${prefix}_USERNAME`]?.trim() || null;
  const password = process.env[`${prefix}_PASSWORD`]?.trim() || null;
  if ((username && !password) || (!username && password)) {
    throw new IntegrationConfigurationError(
      "orthanc-credentials-incomplete",
      "Orthanc username and password must be configured together",
    );
  }

  return { baseUrl, viewerBaseUrl, username, password };
}

function orthancBaseUrl(name: string, fallback: string) {
  const value = process.env[name]?.trim() || fallback;
  const url = new URL(value);
  if (
    process.env.NODE_ENV === "production" &&
    process.env.DEPLOYMENT_MODE !== "self-hosted" &&
    url.protocol !== "https:"
  ) {
    throw new IntegrationConfigurationError(
      "orthanc-base-url-insecure",
      `${name} must use HTTPS outside self-hosted deployments`,
    );
  }
  return url.toString().replace(/\/$/, "");
}

function optionalViewerBaseUrl(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const url = new URL(value);
  if (
    process.env.NODE_ENV === "production" &&
    process.env.DEPLOYMENT_MODE !== "self-hosted" &&
    url.protocol !== "https:"
  ) {
    throw new IntegrationConfigurationError(
      "ohif-viewer-url-insecure",
      `${name} must use HTTPS outside self-hosted deployments`,
    );
  }
  return url.toString().replace(/\/$/, "");
}

export class IntegrationConfigurationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IntegrationConfigurationError";
  }
}
