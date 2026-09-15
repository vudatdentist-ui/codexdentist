import { NextResponse } from "next/server";
import { applicationErrorCode } from "@/lib/application/errors";
import { transitionSterilizationCycleCommand } from "@/lib/application/sterilization/commands";
import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";

export async function POST(request: Request, context: { params: Promise<{ cycleId: string }> }) {
  if (!hasSameOrigin(request)) return json({ error: "csrf-origin-invalid" }, { status: 403 });
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  const { cycleId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    return json({ cycle: await transitionSterilizationCycleCommand(session, { id: cycleId, status: typeof body?.status === "string" ? body.status : "" }) });
  } catch (cause) {
    const code = applicationErrorCode(cause, "sterilization-status-failed");
    return json({ error: code }, { status: code.includes("denied") ? 403 : code.includes("not-found") ? 404 : code.includes("invalid") || code.includes("required") ? 400 : code.includes("busy") || code.includes("conflict") ? 409 : 503 });
  }
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}
