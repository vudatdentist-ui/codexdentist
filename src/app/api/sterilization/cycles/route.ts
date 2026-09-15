import { NextResponse } from "next/server";
import { createSterilizationCycleCommand, listSterilizationCyclesCommand } from "@/lib/application/sterilization/commands";
import { applicationErrorCode } from "@/lib/application/errors";
import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";

export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  try { return json({ cycles: await listSterilizationCyclesCommand(session) }); } catch (cause) { return mapError(cause); }
}
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return error("csrf-origin-invalid", 403);
  const session = await getSession();
  if (!session) return error("unauthorized", 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const cycle = await createSterilizationCycleCommand(session, {
      instrumentIds: Array.isArray(body?.instrumentIds) ? body.instrumentIds.filter((id): id is string => typeof id === "string") : [],
      method: typeof body?.method === "string" ? body.method : "",
      machineName: typeof body?.machineName === "string" ? body.machineName : null,
      notes: typeof body?.notes === "string" ? body.notes : null,
    });
    return json({ cycle }, { status: 201 });
  } catch (cause) { return mapError(cause); }
}
function mapError(cause: unknown) {
  const code = applicationErrorCode(cause, "sterilization-request-failed");
  const status = code.includes("denied") ? 403 :
    code.includes("not-found") ? 404 :
      code.includes("invalid") || code.includes("required") ? 400 :
        code.includes("busy") || code.includes("conflict") ? 409 : 503;
  return error(code, status);
}
function error(code: string, status: number) { return NextResponse.json({ error: code }, { status, headers: { "cache-control": "no-store" } }); }
function json(body: unknown, init?: ResponseInit) { return NextResponse.json(body, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } }); }
