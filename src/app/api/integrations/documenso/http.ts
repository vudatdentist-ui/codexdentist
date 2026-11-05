import { NextResponse } from "next/server";

export function documensoJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function documensoError(cause: unknown) {
  const error = cause as { code?: unknown; status?: number } | null;
  const code = typeof error?.code === "string" && /^(?:documenso-|integration-clinic-)[a-z0-9-]{1,90}$/.test(error.code)
    ? error.code : error?.code === "forbidden" ? "forbidden" : "documenso-operation-failed";
  return documensoJson({ error: code }, error?.status && error.status >= 400 && error.status <= 599 ? error.status : 503);
}
export async function documensoRequestBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error("Invalid request"), { code: "documenso-input-invalid", status: 400 });
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) throw new Error("Request too large");
      parts.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid request");
    return data as Record<string, unknown>;
  } catch {
    await reader.cancel().catch(() => {});
    throw Object.assign(new Error("Invalid request"), { code: "documenso-input-invalid", status: 400 });
  } finally { reader.releaseLock(); }
}
