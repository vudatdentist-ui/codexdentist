import { noStoreJson as json, apiError as error } from "@/app/api/imaging/responses";
import { createSterilizationInstrumentCommand } from "@/lib/application/sterilization/commands";
import { commandErrorCode as applicationErrorCode } from "@/app/api/imaging/responses";
import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return error("csrf-origin-invalid", 403);
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const instrument = await createSterilizationInstrumentCommand(session, {
      code: typeof body?.code === "string" ? body.code : "",
      name: typeof body?.name === "string" ? body.name : "",
      category: typeof body?.category === "string" ? body.category : "",
    });
    return json({ instrument }, { status: 201 });
  } catch (cause) { return mapError(cause); }
}

function mapError(cause: unknown) { const code = applicationErrorCode(cause, "sterilization-request-failed"); return json({ error: code }, { status: code.includes("denied") ? 403 : code.includes("invalid") || code.includes("required") ? 400 : code.includes("unique") || code.includes("conflict") ? 409 : 503 }); }
