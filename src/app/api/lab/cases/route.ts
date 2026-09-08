import { NextResponse } from "next/server";
import { applicationErrorCode } from "@/lib/application/errors";
import { createLabCaseCommand, listLabCasesCommand } from "@/lib/application/lab/commands";
import { getSession } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return error("unauthorized", 401);
  const patientId = new URL(request.url).searchParams.get("patientId")?.trim() || undefined;
  try {
    return NextResponse.json({ cases: await listLabCasesCommand(session, patientId) });
  } catch (cause) {
    return mapError(cause);
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return error("unauthorized", 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const patientId = typeof body?.patientId === "string" ? body.patientId.trim() : "";
  const title = typeof body?.title === "string" ? body.title : "";
  const workType = typeof body?.workType === "string" ? body.workType : "";
  try {
    return NextResponse.json({ case: await createLabCaseCommand(session, {
      patientId,
      treatmentServiceId: typeof body?.treatmentServiceId === "string" ? body.treatmentServiceId.trim() || null : null,
      title,
      workType,
      laboratoryName: typeof body?.laboratoryName === "string" ? body.laboratoryName : null,
      dueAt: typeof body?.dueAt === "string" ? body.dueAt : null,
      notes: typeof body?.notes === "string" ? body.notes : null,
    }) }, { status: 201 });
  } catch (cause) {
    return mapError(cause);
  }
}

function mapError(cause: unknown) {
  const code = applicationErrorCode(cause, "lab-request-failed");
  const status = code.includes("denied") ? 403 :
    code.includes("not-found") ? 404 :
      code.includes("invalid") ? 400 : 503;
  return error(code, status);
}

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}
