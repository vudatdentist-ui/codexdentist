import { NextResponse } from "next/server";
import { reconcileStagedPatientFiles } from "@/infrastructure/patient-files/reconcile-runtime";
import { verifyJobRequest } from "@/lib/job-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await reconcileStagedPatientFiles());
  } catch (error) {
    console.error("patient_file_gc.failed", error);
    return NextResponse.json(
      { error: "Patient file reconciliation failed" },
      { status: 500 },
    );
  }
}
