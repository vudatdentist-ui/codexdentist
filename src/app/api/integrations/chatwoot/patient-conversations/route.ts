import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";
import { getChatwootPatient, manageChatwootPatient } from "@/lib/application/integrations/chatwoot-patient";

export const runtime = "nodejs";
function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function failure(error: unknown) {
  const value = error as { code?: string; status?: number };
  return json({ error: /^chatwoot-[a-z-]{1,80}$/.test(value?.code ?? "") ? value.code : "chatwoot-operation-unconfirmed" },
    value?.status && [400, 403, 404, 409].includes(value.status) ? value.status : 503);
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  const parts: Uint8Array[] = []; let length = 0;
  if (!reader) throw Object.assign(new Error(), { code: "chatwoot-input-invalid", status: 400 });
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > 2048) throw new Error(); parts.push(value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    await reader.cancel().catch(() => {});
    throw Object.assign(new Error(), { code: "chatwoot-input-invalid", status: 400 });
  } finally { reader.releaseLock(); }
}
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, 401);
  try { return json(await getChatwootPatient(session, new URL(request.url).searchParams.get("patientId") ?? "")); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return json({ error: "chatwoot-forbidden" }, 403);
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, 401);
  try {
    const data = await body(request);
    if (Object.keys(data).some(key => !["patientId", "action", "contactId", "conversationId"].includes(key)) ||
        typeof data.patientId !== "string" || !["ensure", "recover", "link", "prepare"].includes(String(data.action)) ||
        (data.contactId !== undefined && (typeof data.contactId !== "string" || !/^[1-9][0-9]{0,14}$/.test(data.contactId))) ||
        (data.conversationId !== undefined && (typeof data.conversationId !== "string" || !/^[1-9][0-9]{0,14}$/.test(data.conversationId))))
      return json({ error: "chatwoot-input-invalid" }, 400);
    return json(await manageChatwootPatient(session, { patientId: data.patientId,
      action: data.action as "ensure" | "recover" | "link" | "prepare", contactId: data.contactId as string | undefined,
      conversationId: data.conversationId as string | undefined }));
  } catch (error) { return failure(error); }
}
