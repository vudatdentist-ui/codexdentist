import { NextResponse } from "next/server";
export const bankTransferJson = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function bankTransferError(cause: unknown) {
  const error = cause as { code?: unknown; status?: number };
  const code = typeof error?.code === "string" && /^bank-transfer-[a-z-]{1,90}$/.test(error.code) ? error.code : "bank-transfer-unavailable";
  return bankTransferJson({ error: code }, [400, 403, 404, 409].includes(error?.status ?? 0) ? error.status : 503);
}
export async function bankTransferBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw Object.assign(new Error(), { code: "bank-transfer-input-invalid", status: 400 });
  const reader = request.body?.getReader();
  let size = 0, text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    if (!reader) throw new Error();
    for (;;) { const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 4096) { await reader.cancel(); throw new Error(); } text += decoder.decode(value, { stream: true }); }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw Object.assign(new Error(), { code: "bank-transfer-input-invalid", status: 400 }); }
  finally { reader?.releaseLock(); }
}
