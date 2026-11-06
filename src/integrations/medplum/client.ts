import "server-only";
import { optionalProviderFetch } from "@/integrations/optional-http";

// Contracts: https://www.medplum.com/docs/api/oauth/token and
// https://www.medplum.com/docs/fhir-datastore/updating-data (conditional PUT).
// Required vault fields: baseUrl (API root), clientId, clientSecret, projectId.
export function medplumConfig(secrets: Record<string, string>) {
  const { baseUrl, clientId, clientSecret, projectId } = secrets;
  if (![baseUrl, clientId, clientSecret, projectId].every(v => typeof v === "string" && v.length > 0)) fail("medplum-configuration-required", 409);
  let url: URL;
  try { url = new URL(baseUrl); } catch { fail("medplum-configuration-invalid", 409); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !/^[A-Za-z0-9-]{1,64}$/.test(clientId) || !/^[A-Za-z0-9-]{1,64}$/.test(projectId) || /[\r\n]/.test(clientSecret)) fail("medplum-configuration-invalid", 409);
  return { baseUrl: url.origin, clientId, clientSecret, projectId };
}

export function fail(code: string, status = 503): never { throw Object.assign(new Error(code), { code, status }); }

async function request(url: string, init: RequestInit) {
  try {
    const response = await optionalProviderFetch(url, { ...init, cache: "no-store", redirect: "error" });
    if (!response.ok) fail(response.status === 412 ? "medplum-identity-conflict" : "medplum-provider-rejected");
    return await response.json();
  } catch (error) {
    if (error instanceof Error && /^medplum-/.test(error.message)) throw error;
    fail("medplum-provider-unavailable");
  }
}

async function authenticate(secrets: Record<string, string>) {
  const config = medplumConfig(secrets);
  const token = await request(`${config.baseUrl}/oauth2/token`, { method: "POST", headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
  }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId }).toString() });
  if (token.token_type?.toLowerCase() !== "bearer" || typeof token.access_token !== "string" || !token.access_token || /[\r\n]/.test(token.access_token)) fail("medplum-token-invalid");
  const headers = { Authorization: `Bearer ${token.access_token}`, Accept: "application/fhir+json" };
  // /auth/me is the authenticated project identity used by the Medplum SDK.
  // Source: medplum/packages/server/src/auth/me.ts (project + membership).
  const me = await request(`${config.baseUrl}/auth/me`, { headers });
  if (me.project?.resourceType !== "Project" || me.project.id !== config.projectId ||
      me.profile?.resourceType !== "ClientApplication" || me.profile.id !== config.clientId) fail("medplum-project-mismatch", 409);
  return { config, headers };
}

export async function verifyMedplumConnection(secrets: Record<string, string>): Promise<{ identity: string }> {
  const { config } = await authenticate(secrets);
  return { identity: `Project/${config.projectId}` };
}

type PatientResource = { resourceType: string; identifier: { system: string; value: string }[]; [key: string]: unknown };
export async function upsertMedplumPatient(secrets: Record<string, string>, patient: PatientResource, identity: { system: string; value: string }) {
  const { config, headers } = await authenticate(secrets);
  const { id: _localId, ...body } = patient;
  const query = new URLSearchParams({ identifier: `${identity.system}|${identity.value}` });
  const search = await request(`${config.baseUrl}/fhir/R4/Patient?${query}&_count=2`, { headers });
  if (search.resourceType !== "Bundle" || !Array.isArray(search.entry ?? []) || (search.entry?.length ?? 0) > 1 ||
      (typeof search.total === "number" && search.total > (search.entry?.length ?? 0))) fail("medplum-identity-conflict");
  const existing = search.entry?.[0]?.resource;
  const writes: Record<string, string> = { ...headers, "Content-Type": "application/fhir+json", Prefer: "return=representation" };
  let path = "Patient", method = "POST", payload: Record<string, unknown> = body;
  if (existing) {
    const version = existing.meta?.versionId;
    if (existing.resourceType !== "Patient" || !/^[A-Za-z0-9.-]{1,64}$/.test(existing.id ?? "") ||
        !/^[A-Za-z0-9.-]{1,128}$/.test(version ?? "") || !Array.isArray(existing.identifier) ||
        !existing.identifier.some((v: { system?: string; value?: string }) => v.system === identity.system && v.value === identity.value)) fail("medplum-identity-conflict");
    path += `/${existing.id}`; method = "PUT"; payload = { ...body, id: existing.id };
    writes["If-Match"] = `W/"${version}"`;
  } else {
    // Conditional creation never overwrites a concurrent newer version. An old
    // timed-out request must not replace newer demographics after a lease expires.
    writes["If-None-Exist"] = query.toString();
  }
  const result = await request(`${config.baseUrl}/fhir/R4/${path}`, { method,
    headers: writes, body: JSON.stringify(payload) });
  if (result.resourceType !== "Patient" || typeof result.id !== "string" || !/^[A-Za-z0-9.-]{1,64}$/.test(result.id)) fail("medplum-response-invalid");
  const verified = await request(`${config.baseUrl}/fhir/R4/Patient/${result.id}`, { headers });
  if (verified.resourceType !== "Patient" || verified.id !== result.id || !Array.isArray(verified.identifier) ||
      !verified.identifier.some((v: { system?: string; value?: string }) => v.system === identity.system && v.value === identity.value)) fail("medplum-verification-failed");
  for (const key of ["name", "birthDate", "gender", "telecom", "address"]) {
    if (JSON.stringify(verified[key]) !== JSON.stringify(body[key])) fail("medplum-verification-failed");
  }
  if (!patient.identifier.every(expected => verified.identifier.some((actual: { system?: string; value?: string }) =>
    actual.system === expected.system && actual.value === expected.value))) fail("medplum-verification-failed");
  return { externalId: result.id as string };
}
