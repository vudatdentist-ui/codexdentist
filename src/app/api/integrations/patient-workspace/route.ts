import { getSession } from "@/lib/auth";
import { getPatientIntegrationWorkspace } from "@/lib/application/integrations/patient-integration-workspace";
import { optionalError, optionalJson } from "../optional-providers/http";
export async function GET(request: Request) {
  const session = await getSession(); if (!session) return optionalJson({ error: "unauthorized" }, 401);
  try { return optionalJson(await getPatientIntegrationWorkspace(session, new URL(request.url).searchParams.get("patientId") ?? "")); }
  catch (cause) { return optionalError(cause); }
}
