import { NextResponse } from "next/server";

export function payOSJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function payOSError(cause: unknown) {
  const error = cause as { code?: string; status?: number } | null;
  const code = typeof error?.code === "string" && /^[a-z0-9-]{1,100}$/.test(error.code)
    ? error.code : "payos-operation-failed";
  return payOSJson({ error: code }, error?.status && error.status >= 400 && error.status <= 599 ? error.status : 503);
}
export async function payOSRequestBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error("Invalid request"), { code: "payos-input-invalid", status: 400 });
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) throw new Error("Request too large");
      parts.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request");
    return body as Record<string, unknown>;
  } catch {
    await reader.cancel().catch(() => {});
    throw Object.assign(new Error("Invalid request"), { code: "payos-input-invalid", status: 400 });
  } finally { reader.releaseLock(); }
}
