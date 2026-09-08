import { NextResponse } from "next/server";
import { createSterilizationCycleCommand, listSterilizationCyclesCommand } from "@/lib/application/sterilization/commands";
import { applicationErrorCode } from "@/lib/application/errors";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json({ cycles: await listSterilizationCyclesCommand(session) }); } catch (cause) { return mapError(cause); }
}
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const cycle = await createSterilizationCycleCommand(session, {
      instrumentIds: Array.isArray(body?.instrumentIds) ? body.instrumentIds.filter((id): id is string => typeof id === "string") : [],
      method: typeof body?.method === "string" ? body.method : "",
      machineName: typeof body?.machineName === "string" ? body.machineName : null,
      notes: typeof body?.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ cycle }, { status: 201 });
  } catch (cause) { return mapError(cause); }
}
function mapError(cause: unknown) { const code = applicationErrorCode(cause, "sterilization-request-failed"); return NextResponse.json({ error: code }, { status: code.includes("denied") ? 403 : code.includes("invalid") || code.includes("required") ? 400 : 503 }); }
