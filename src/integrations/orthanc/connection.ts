import "server-only";
import { createHash } from "node:crypto";
import { OrthancProviderError, type OrthancConnectionSecrets } from "@/integrations/orthanc/client";

export function orthancVaultSecrets(record: Record<string, string>): OrthancConnectionSecrets {
  const baseUrl = record.baseUrl?.trim();
  const username = record.username;
  const password = record.password;
  if (!baseUrl || !username || !password || username.includes(":")) {
    throw new OrthancProviderError("orthanc-credentials-incomplete", 400);
  }
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new OrthancProviderError("orthanc-base-url-invalid", 400); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      /[%\\]/.test(url.pathname)) throw new OrthancProviderError("orthanc-base-url-invalid", 400);
  return { baseUrl: url.toString().replace(/\/$/, ""), username, password,
    viewerBaseUrl: record.viewerBaseUrl?.trim() || null, viewerAccessMode: "private", vault: true };
}

export function orthancAuthorization(secrets: OrthancConnectionSecrets) {
  const headers = new Headers();
  if (secrets.username && secrets.password) {
    headers.set("authorization", `Basic ${Buffer.from(`${secrets.username}:${secrets.password}`).toString("base64")}`);
  }
  return headers;
}

/** Settings fields: baseUrl (Orthanc HTTP root), username, password; viewerBaseUrl
 * is optional legacy metadata and is never used as a browser destination or host.
 * The actual static viewer is selected exclusively by OPTIONAL_OHIF_BASE_URL.
 */
export async function verifyOrthancConnection(record: Record<string, string>): Promise<{ identity: string }> {
  const secrets = orthancVaultSecrets(record);
  const { optionalProviderFetch } = await import("@/integrations/optional-http");
  const headers = orthancAuthorization(secrets);
  headers.set("accept", "application/json");
  const response = await optionalProviderFetch(`${secrets.baseUrl}/system`, { headers });
  const system = await response.json().catch(() => null);
  if (!response.ok || typeof system?.Version !== "string" || typeof system?.DicomAet !== "string" ||
      !system.DicomAet || system.DicomAet.length > 64 || typeof system.Name !== "string" || system.Name.length > 256) {
    throw new OrthancProviderError("orthanc-verification-failed", 502);
  }
  // A system probe alone cannot establish that the required DICOMweb plugin exists.
  const plugins = await optionalProviderFetch(`${secrets.baseUrl}/plugins/dicom-web`, { headers });
  const plugin = await plugins.json().catch(() => null);
  if (!plugins.ok || typeof plugin?.ID !== "string" || plugin.ID !== "dicom-web") {
    throw new OrthancProviderError("orthanc-dicomweb-unavailable", 502);
  }
  // Orthanc exposes configured archive Name/AET, not an immutable account UUID.
  // Deploy a stable, archive-specific Name/AET. Hash these with the fixed HTTP
  // root to avoid PHI in configuration metadata and avoid version-upgrade churn.
  return { identity: `orthanc:${createHash("sha256").update(JSON.stringify([secrets.baseUrl, system.DicomAet, system.Name])).digest("hex")}` };
}
