import { NextResponse } from "next/server";
import { applicationErrorCode } from "@/lib/application/errors";
import { transitionSterilizationCycleCommand } from "@/lib/application/sterilization/commands";
import { getSession } from "@/lib/auth";

export async function POST(request: Request, context: { params: Promise<{ cycleId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { cycleId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    return NextResponse.json({ cycle: await transitionSterilizationCycleCommand(session, { id: cycleId, status: typeof body?.status === "string" ? body.status : "" }) });
  } catch (cause) {
    const code = applicationErrorCode(cause, "sterilization-status-failed");
    return NextResponse.json({ error: code }, { status: code.includes("denied") ? 403 : code.includes("not-found") ? 404 : code.includes("invalid") || code.includes("required") ? 400 : 503 });
  }
}
