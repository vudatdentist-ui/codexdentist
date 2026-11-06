import "server-only";

export class OptionalProviderHttpError extends Error {
  constructor(public readonly code: string, public readonly status = 503) { super(code); }
}
const reject = (code = "integration-origin-not-allowed", status = 400): never => { throw new OptionalProviderHttpError(code, status); };
function normalizedOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return reject(); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/") return reject();
  return url.origin;
}
export function assertOptionalProviderUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { return reject(); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash ||
      ["169.254.169.254", "metadata.google.internal", "[fd00:ec2::254]"].includes(url.hostname)) return reject();
  const approved = (process.env.OPTIONAL_PROVIDER_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean).map(normalizedOrigin);
  if (!approved.includes(url.origin)) return reject();
  // Plain HTTP is opt-in only on the trusted container network/loopback; a tenant
  // cannot grant approval by submitting an origin in their connection settings.
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]",
    "codexdentist-orthanc", "codexdentist-chatwoot", "codexdentist-novu", "codexdentist-medplum",
    "codexdentist-documenso"].includes(url.hostname)) return reject();
  return url;
}
export function optionalProviderBaseUrl(value: string) {
  const url = assertOptionalProviderUrl(value);
  if (url.search) return reject();
  return url.toString().replace(/\/$/, "");
}
export async function optionalProviderFetch(url: string, init: RequestInit = {}, options: { maxBytes?: number } = {}): Promise<Response> {
  const approved = assertOptionalProviderUrl(url);
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) return reject("integration-response-limit-invalid");
  if (typeof init.body === "string" && Buffer.byteLength(init.body) > 1024 * 1024) return reject("integration-request-too-large", 413);
  let response: Response;
  try {
    response = await fetch(approved, { ...init, cache: "no-store", redirect: "manual",
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
  } catch { return reject("integration-provider-unavailable", 503); }
  if (response.status >= 300 && response.status < 400 && response.status !== 304) {
    await response.body?.cancel(); return reject("integration-provider-redirect", 502);
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) { await response.body?.cancel(); return reject("integration-response-too-large", 502); }
  const parts: Uint8Array[] = [];
  let bytes = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) { await reader.cancel(); return reject("integration-response-too-large", 502); }
        parts.push(value);
      }
    } catch (error) {
      if (error instanceof OptionalProviderHttpError) throw error;
      return reject("integration-provider-unavailable", 503);
    } finally { reader.releaseLock(); }
  }
  const headers = new Headers();
  for (const name of ["content-type", "etag", "last-modified", "content-range", "accept-ranges"]) {
    const value = response.headers.get(name); if (value) headers.set(name, value);
  }
  headers.set("cache-control", "no-store");
  return new Response([204, 205, 304].includes(response.status) ? null : Buffer.concat(parts), { status: response.status, headers });
}
