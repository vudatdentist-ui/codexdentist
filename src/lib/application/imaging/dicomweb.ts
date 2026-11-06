import "server-only";
import { authorizeImagingStudy } from "@/lib/application/imaging/commands";
import type { AppSession } from "@/lib/session";
import { optionalProviderFetch } from "@/integrations/optional-http";
import { OrthancProviderError } from "@/integrations/orthanc/client";
import { orthancAuthorization } from "@/integrations/orthanc/connection";
import { rewriteDicomJson, validateDicomwebRequest } from "@/integrations/orthanc/dicomweb-policy";

export async function getImagingDicomweb(
  session: AppSession, studyId: string, parts: string[], request: Request,
): Promise<Response> {
  // Reject hostile syntax before any provider access. Authorize canonical scope
  // before resolving credentials; authorizeImagingStudy also rechecks PACS identity.
  const url = new URL(request.url);
  if (/%|\\/u.test(url.pathname)) throw new OrthancProviderError("imaging-dicomweb-request-invalid", 400);
  const requestedUid = parts.length === 1 ? url.searchParams.get("StudyInstanceUID") || url.searchParams.get("0020000D") || "" : parts[1] || "";
  const validated = validateDicomwebRequest(parts, url.searchParams, requestedUid);
  const { study, secrets } = await authorizeImagingStudy(session, studyId, requestedUid);
  const headers = orthancAuthorization(secrets);
  const accept = request.headers.get("accept");
  if (!validated.json && accept && (accept.length > 512 || !/^[A-Za-z0-9\s/*;=",.\-+]+$/u.test(accept))) {
    throw new OrthancProviderError("imaging-dicomweb-request-invalid", 400);
  }
  headers.set("accept", validated.json ? "application/dicom+json" : accept || 'multipart/related; type="application/octet-stream"; transfer-syntax=*');
  const upstreamRoot = `${secrets.baseUrl}/dicom-web`;
  const response = await optionalProviderFetch(`${upstreamRoot}/${validated.path}${validated.query ? `?${validated.query}` : ""}`, {
    headers, signal: request.signal,
  }, { maxBytes: 64 * 1024 * 1024 });
  if (!response.ok) throw new OrthancProviderError(response.status === 404 ? "orthanc-study-not-found" : "orthanc-request-failed", response.status === 404 ? 404 : 503);
  const resultHeaders = imagingPrivateHeaders();
  if (validated.json) {
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (response.status !== 204 && type !== "application/dicom+json" && type !== "application/json") {
      throw new OrthancProviderError("orthanc-dicomweb-response-invalid", 502);
    }
    const body = response.status === 204 ? [] : await response.json().catch(() => null);
    const rewritten = rewriteDicomJson(body, { upstreamRoot, proxyRoot: `/api/imaging/dicomweb/${studyId}`,
      studyUid: study.studyInstanceUid!, request: validated });
    resultHeaders.set("content-type", "application/dicom+json");
    return new Response(JSON.stringify(rewritten), { headers: resultHeaders });
  }
  const type = response.headers.get("content-type") || "";
  if (!/^(multipart\/related\s*;|application\/(octet-stream|dicom|pdf)(\s*;|$)|image\/(jpeg|jp2|jpx|png)(\s*;|$)|video\/mp4(\s*;|$))/iu.test(type)) {
    throw new OrthancProviderError("orthanc-dicomweb-response-invalid", 502);
  }
  resultHeaders.set("content-type", type);
  return new Response(response.body, { headers: resultHeaders });
}

export function imagingPrivateHeaders() {
  return new Headers({ "cache-control": "private, no-store, max-age=0", "vary": "Cookie",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin" });
}

export function imagingProxyError(cause: unknown) {
  const code = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string" ? cause.code : "imaging-provider-unavailable";
  const status = code.endsWith("not-found") ? 404 : code.startsWith("orthanc-") ? 503 : code.endsWith("denied") || code.includes("forbidden") || code.includes("demo-unavailable") ? 403 : code === "imaging-dicomweb-request-invalid" || code === "imaging-viewer-request-invalid" ? 400 : 503;
  // Only machine codes cross the transport; provider responses/errors can contain PHI or credentials.
  return new Response(JSON.stringify({ error: /^[a-z][a-z0-9-]{1,80}$/u.test(code) ? code : "imaging-provider-unavailable" }), {
    status, headers: new Headers({ ...Object.fromEntries(imagingPrivateHeaders()), "content-type": "application/json" }),
  });
}
