import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";
import { exportMedplumPatient, getMedplumPatientStatus } from "@/lib/application/interoperability/medplum";

type Context = { params: Promise<{ patientId: string }> };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function dispatch(request: Request, context: Context, write: boolean) {
  const session = await getSession();
  if (!session) return json({ error: "login" }, 401);
  if (write && (!hasSameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site")) return json({ error: "medplum-origin-denied" }, 403);
  try {
    const { patientId } = await context.params;
    return json(await (write ? exportMedplumPatient(session, patientId) : getMedplumPatientStatus(session, patientId)));
  } catch (cause) {
    const error = cause as { code?: unknown; status?: number };
    const code = typeof error?.code === "string" && /^(medplum-|optional-|integration-)[a-z-]{1,90}$/.test(error.code) ? error.code : "medplum-unavailable";
    return json({ error: code }, [400, 403, 404, 409, 503].includes(error?.status ?? 0) ? error.status : 503);
  }
}
export const GET = (request: Request, context: Context) => dispatch(request, context, false);
export const POST = (request: Request, context: Context) => dispatch(request, context, true);
