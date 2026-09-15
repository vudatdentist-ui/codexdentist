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
  if (prefix !== "PAYOS_DEFAULT") {
    throw new IntegrationConfigurationError("payos-secret-ref-invalid", "payOS connections must use env:PAYOS_DEFAULT");
  }
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
  if (prefix !== "DOCUMENSO_DEFAULT") {
    throw new IntegrationConfigurationError("documenso-secret-ref-invalid", "Documenso connections must use env:DOCUMENSO_DEFAULT");
  }
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
  if (prefix !== "ORTHANC_DEFAULT") {
    throw new IntegrationConfigurationError(
      "orthanc-secret-ref-invalid",
      "Orthanc connections must use env:ORTHANC_DEFAULT",
    );
  }
  const baseUrl = orthancBaseUrl(
    `${prefix}_BASE_URL`,
    process.env.NODE_ENV === "production" ? "https://orthanc.invalid" : "http://127.0.0.1:8042",
  );
  const viewerBaseUrl = optionalViewerBaseUrl(`${prefix}_VIEWER_BASE_URL`);
  const viewerAccessMode = (process.env[`${prefix}_VIEWER_ACCESS_MODE`]?.trim() || "disabled") as "private" | "disabled";
  if (viewerAccessMode !== "private" && viewerAccessMode !== "disabled") {
    throw new IntegrationConfigurationError(
      "ohif-viewer-access-mode-invalid",
      `${prefix}_VIEWER_ACCESS_MODE must be private or disabled`,
    );
  }
  const username = process.env[`${prefix}_USERNAME`]?.trim() || null;
  const password = process.env[`${prefix}_PASSWORD`]?.trim() || null;
  if ((username && !password) || (!username && password)) {
    throw new IntegrationConfigurationError(
      "orthanc-credentials-incomplete",
      "Orthanc username and password must be configured together",
    );
  }

  return { baseUrl, viewerBaseUrl, viewerAccessMode, username, password };
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
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IntegrationConfigurationError(
      "ohif-viewer-url-insecure",
      `${name} must use HTTP or HTTPS`,
    );
  }
  if (process.env.NODE_ENV === "production" && process.env.DEPLOYMENT_MODE !== "self-hosted" && url.protocol !== "https:") {
    throw new IntegrationConfigurationError("ohif-viewer-url-insecure", `${name} must use HTTPS outside self-hosted deployments`);
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
