import { NextResponse } from "next/server";
export function optionalJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "private, no-store", vary: "Cookie" } });
}
export function optionalError(cause: unknown) {
  const error = cause as { code?: unknown; status?: unknown } | null;
  const code = typeof error?.code === "string" && /^(?:integration-|orthanc-|chatwoot-|novu-|medplum-)[a-z0-9-]{1,90}$/.test(error.code)
    ? error.code : error?.code === "forbidden" ? "forbidden" : "integration-operation-unavailable";
  const status = typeof error?.status === "number" && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
  return optionalJson({ error: code }, status);
}
export async function optionalBody(request: Request): Promise<Record<string, unknown>> {
  const fail = (): never => { throw Object.assign(new Error("integration-input-invalid"), { code: "integration-input-invalid", status: 400 }); };
  const reader = request.body?.getReader(); if (!reader) return fail();
  let total = 0; const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > 32768) { await reader.cancel(); return fail(); }
      parts.push(value);
    }
    const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail();
    return body;
  } catch { return fail(); }
  finally { reader.releaseLock(); }
}
