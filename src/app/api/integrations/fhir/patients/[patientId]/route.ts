import { NextResponse } from "next/server";
import { applicationErrorCode } from "@/lib/application/errors";
import { exportFhirPatientCommand } from "@/lib/application/interoperability/commands";
import { getSession } from "@/lib/auth";

export async function GET(_request: Request, context: { params: Promise<{ patientId: string }> }) {
  const session = await getSession();
  if (!session) return fhirError("login", "Authentication is required", 401);
  try {
    const resource = await exportFhirPatientCommand(session, (await context.params).patientId);
    return fhirJson(resource);
  } catch (cause) {
    const code = applicationErrorCode(cause, "fhir-export-failed");
    const mapped = code === "fhir-export-denied"
      ? ["forbidden", 403]
      : code === "fhir-patient-not-found"
        ? ["not-found", 404]
        : code === "fhir-export-disabled"
          ? ["not-supported", 404]
          : ["processing", 503];
    return fhirError(mapped[0] as string, code, mapped[1] as number);
  }
}

function fhirJson(body: unknown) {
  return NextResponse.json(body, {
    status: 200,
    headers: {
      "content-type": "application/fhir+json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function fhirError(code: string, diagnostics: string, status: number) {
  return NextResponse.json({
    resourceType: "OperationOutcome",
    issue: [{ severity: "error", code, diagnostics }],
  }, {
    status,
    headers: {
      "content-type": "application/fhir+json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
