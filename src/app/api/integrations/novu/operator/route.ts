import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";
import { getNovuOperatorWorkspace, runNovuOperatorCommand } from "@/lib/application/integrations/novu-operator";
import { NovuError } from "@/integrations/novu/client";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  return error instanceof NovuError ? json({ error: error.code }, [400, 403, 404, 409].includes(error.status) ? error.status : 502)
    : json({ error: "novu-operation-failed" }, 502);
}
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, 401);
  const query = new URL(request.url).searchParams;
  try { return json(await getNovuOperatorWorkspace(session, query.get("clinicId") ?? "", query.get("patientId") || undefined)); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return json({ error: "csrf-origin-invalid" }, 403);
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, 401);
  try {
    // Stream-bound the transport before parsing; no arbitrary recipient/content
    // or credentials can enter the synthetic test command.
    if (!request.body) return json({ error: "novu-input-invalid" }, 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return json({ error: "novu-input-too-large" }, 413); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json({ error: "novu-input-invalid" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => !["clinicId", "patientId", "action", "deliveryId"].includes(key))) return json({ error: "novu-input-invalid" }, 400);
    return json(await runNovuOperatorCommand(session, body as Record<string, unknown>));
  } catch (error) { return failure(error); }
}
