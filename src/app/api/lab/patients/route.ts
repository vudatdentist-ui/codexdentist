import { apiError, noStoreJson } from "@/app/api/imaging/responses";
import { applicationErrorCode } from "@/lib/application/errors";
import { searchOperationPatientsCommand } from "@/lib/application/lab/commands";
import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return apiError("csrf-origin-invalid", 403);
  const session = await getSession();
  if (!session) return apiError("unauthorized", 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if ((body?.purpose !== "lab" && body?.purpose !== "imaging") || typeof body.query !== "string") {
    return apiError("patient-lookup-input-invalid", 400);
  }
  try {
    return noStoreJson({ patients: await searchOperationPatientsCommand(session, { purpose: body.purpose, query: body.query }) });
  } catch (cause) {
    const code = applicationErrorCode(cause, "patient-lookup-failed");
    return apiError(code, code.endsWith("denied") ? 403 : 503);
  }
}
