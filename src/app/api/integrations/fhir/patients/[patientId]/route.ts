import { NextResponse } from "next/server";
import { applicationErrorCode } from "@/lib/application/errors";
import { exportFhirPatientCommand } from "@/lib/application/interoperability/commands";
import { getSession } from "@/lib/auth";

export async function GET(_request: Request, context: { params: Promise<{ patientId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ resourceType: "OperationOutcome", issue: [{ code: "login" }] }, { status: 401 });
  try {
    const resource = await exportFhirPatientCommand(session, (await context.params).patientId);
    return NextResponse.json(resource, { headers: { "content-type": "application/fhir+json; charset=utf-8" } });
  } catch (cause) {
    const code = applicationErrorCode(cause, "fhir-export-failed");
    const status = code === "fhir-export-denied" ? 403 : code === "fhir-patient-not-found" ? 404 : code === "fhir-export-disabled" ? 404 : 503;
    return NextResponse.json({ resourceType: "OperationOutcome", issue: [{ severity: "error", code }] }, { status, headers: { "content-type": "application/fhir+json; charset=utf-8" } });
  }
}
