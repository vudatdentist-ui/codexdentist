import { NextResponse } from "next/server";
import { reconcileStagedPatientFiles } from "@/infrastructure/patient-files/reconcile-runtime";
import { verifyJobRequest } from "@/lib/job-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyJobRequest(request)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return json(await reconcileStagedPatientFiles());
  } catch (error) {
    console.error("patient_file_gc.failed", error);
    return json(
      { error: "Patient file reconciliation failed" },
      { status: 500 },
    );
  }
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}
