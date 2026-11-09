import "server-only";
import { canPerformAction } from "@/lib/actions/permissions";
import { authorizeImagingStudy } from "@/lib/application/imaging/commands";
import { imagingPrivateHeaders } from "@/lib/application/imaging/dicomweb";
import type { AppSession } from "@/lib/session";
import { OrthancProviderError } from "@/integrations/orthanc/client";
import { optionalProviderFetch } from "@/integrations/optional-http";

export const ohifBasePath = "/imaging/ohif";
const invalid = (): never => { throw new OrthancProviderError("imaging-viewer-request-invalid", 400); };

function staticBaseUrl() {
  // Only root deployment configuration selects the static service. A tenant's
  // viewerBaseUrl, request URL, Host or forwarded headers never select an upstream.
  const configured = process.env.OPTIONAL_OHIF_BASE_URL?.trim();
  if (!configured) throw new OrthancProviderError("imaging-viewer-not-configured", 503);
  let url: URL;
  try { url = new URL(configured); } catch { throw new OrthancProviderError("imaging-viewer-not-configured", 503); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      /[%\\]/u.test(url.pathname)) throw new OrthancProviderError("imaging-viewer-not-configured", 503);
  return url.toString().replace(/\/$/u, "");
}

export function ohifAppConfig(studyId: string) {
  const root = `/api/imaging/dicomweb/${studyId}`;
  return { routerBasename: ohifBasePath, showStudyList: false, extensions: [], modes: [],
    showWarningMessageForCrossOrigin: false, showCPUFallbackMessage: true,
    dangerouslyUseDynamicConfig: { enabled: false }, maxNumberOfWebWorkers: 3,
    maxNumRequests: { interaction: 8, thumbnail: 4, prefetch: 2 },
    defaultDataSourceName: "dicomweb",
    dataSources: [{ namespace: "@ohif/extension-default.dataSourcesModule.dicomweb", sourceName: "dicomweb",
      configuration: { friendlyName: "Imaging", name: "orthanc", wadoUriRoot: root, qidoRoot: root, wadoRoot: root,
        qidoSupportsIncludeField: true, imageRendering: "wadors", thumbnailRendering: "wadors",
        enableStudyLazyLoad: true, supportsFuzzyMatching: false, supportsWildcard: false,
        dicomUploadEnabled: false, supportsStow: false, supportsReject: false, bulkDataURI: { enabled: true } } }],
  };
}

export function ohifHeaders(contentType: string) {
  const headers = imagingPrivateHeaders();
  headers.set("content-type", contentType);
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-embedder-policy", "require-corp");
  // Scope WASM/workers to this viewer. No browser access to PACS/private services,
  // remote data sources, frames, forms, or image beacons containing clinical data.
  headers.set("content-security-policy", ["default-src 'self'", "base-uri 'self'", "object-src 'none'",
    "frame-ancestors 'none'", "frame-src 'none'", "form-action 'none'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:", "connect-src 'self' blob:", "img-src 'self' data: blob:",
    "media-src 'self' blob:", "font-src 'self' data:", "style-src 'self' 'unsafe-inline'", "manifest-src 'none'"].join("; "));
  headers.set("x-frame-options", "DENY");
  return headers;
}

/** Strict extension and directory allowlist, with no HTML/config/backend fallback.
 * The upstream MUST be a pure static OHIF build, with no PACS/backend proxy routes.
 */
export function validateOhifAsset(parts: string[], query: URLSearchParams) {
  if (!parts.length || parts.length > 16 || parts.join("/").length > 512 ||
      parts.some(p => !/^[A-Za-z0-9_@.-]+$/u.test(p) || p.startsWith(".") || p === "..") ||
      parts.some(p => /^(api|dicom-web|studies|patients|instances|series|tools|plugins|system|config|wado|auth)$/iu.test(p)) ||
      parts.some(p => /(^|[-.])(sw|service-worker|serviceworker|workbox)([-.]|$)/iu.test(p)) ||
      !/\.(js|mjs|css|wasm|png|jpg|jpeg|webp|gif|svg|ico|woff|woff2|ttf|otf)$/iu.test(parts.at(-1)!)) invalid();
  for (const [key, value] of query) if (key !== "v" || !/^[A-Za-z0-9._-]{1,64}$/u.test(value) || query.getAll(key).length !== 1) invalid();
  return parts.join("/");
}

export async function getOhifResource(session: AppSession, parts: string[], request: Request) {
  if (session.isDemo || !canPerformAction(session, "imaging.study.view")) throw new OrthancProviderError("imaging-view-denied", 403);
  const url = new URL(request.url);
  if (/%|\\/u.test(url.pathname) || request.headers.has("service-worker")) invalid();
  const isViewer = parts.length === 1 && parts[0] === "viewer";
  const isConfig = parts.length === 1 && parts[0] === "app-config.js";
  if (isViewer || isConfig) {
    for (const key of url.searchParams.keys()) if (!["studyId", "StudyInstanceUIDs"].includes(key) || url.searchParams.getAll(key).length !== 1) invalid();
    const studyId = url.searchParams.get("studyId");
    const uid = url.searchParams.get("StudyInstanceUIDs");
    if (!studyId || !uid) throw new OrthancProviderError("imaging-viewer-request-invalid", 400);
    const { study } = await authorizeImagingStudy(session, studyId, uid);
    if (uid !== study.studyInstanceUid) invalid();
    const config = `window.config = ${JSON.stringify(ohifAppConfig(study.id)).replace(/</gu, "\\u003c")};`;
    if (isConfig) return new Response(config, { headers: ohifHeaders("application/javascript; charset=utf-8") });
    const response = await optionalProviderFetch(`${staticBaseUrl()}/index.html`, { signal: request.signal }, { maxBytes: 2 * 1024 * 1024 });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("text/html")) {
      throw new OrthancProviderError("imaging-viewer-unavailable", 503);
    }
    let html = await response.text();
    // Official OHIF ships a separate PWA initializer. Omit it and the manifest;
    // PHI must never enter an offline service-worker cache across staff sessions.
    html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*init-service-worker\.js["'][^>]*>\s*<\/script\s*>/giu, "")
      .replace(/<link\b[^>]*\brel\s*=\s*["']manifest["'][^>]*>/giu, "");
    // The supplied index must be the official static shell, built at our subpath.
    // Replace its app-config script; never serve the upstream's data source config.
    let configs = 0;
    const configUrl = `${ohifBasePath}/app-config.js?${new URLSearchParams({ studyId: study.id, StudyInstanceUIDs: uid })}`.replace(/&/gu, "&amp;");
    html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*app-config\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script\s*>/giu,
      () => { configs++; return `<script src="${configUrl}"></script>`; });
    if (configs !== 1 || /\b(?:src|href)\s*=\s*["']\/(?!imaging\/ohif\/)/iu.test(html) ||
        /navigator\.serviceWorker|serviceWorker\.register/iu.test(html)) {
      throw new OrthancProviderError("imaging-viewer-build-invalid", 503);
    }
    return new Response(html, { headers: ohifHeaders("text/html; charset=utf-8") });
  }
  const asset = validateOhifAsset(parts, url.searchParams);
  const response = await optionalProviderFetch(`${staticBaseUrl()}/${asset}`, { signal: request.signal }, { maxBytes: 64 * 1024 * 1024 });
  if (!response.ok) throw new OrthancProviderError("imaging-viewer-asset-not-found", 404);
  const type = response.headers.get("content-type") || "";
  if (/text\/html|application\/(json|dicom)/iu.test(type)) throw new OrthancProviderError("imaging-viewer-build-invalid", 503);
  // A JS fetch could otherwise install a persistent, session-independent cache of PHI.
  if (/\.m?js$/iu.test(asset)) {
    const script = await response.text();
    if (/serviceWorker\s*\.\s*register|importScripts\s*\([^)]*workbox/iu.test(script)) throw new OrthancProviderError("imaging-viewer-build-invalid", 503);
    return new Response(script, { headers: ohifHeaders(type) });
  }
  return new Response(response.body, { headers: ohifHeaders(type) });
}
