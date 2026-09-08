import { NextResponse } from "next/server";
import { createSterilizationInstrumentCommand } from "@/lib/application/sterilization/commands";
import { applicationErrorCode } from "@/lib/application/errors";
import { getSession } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const instrument = await createSterilizationInstrumentCommand(session, {
      code: typeof body?.code === "string" ? body.code : "",
      name: typeof body?.name === "string" ? body.name : "",
      category: typeof body?.category === "string" ? body.category : "",
    });
    return NextResponse.json({ instrument }, { status: 201 });
  } catch (cause) { return mapError(cause); }
}

function mapError(cause: unknown) { const code = applicationErrorCode(cause, "sterilization-request-failed"); return NextResponse.json({ error: code }, { status: code.includes("denied") ? 403 : code.includes("invalid") || code.includes("required") ? 400 : 503 }); }
