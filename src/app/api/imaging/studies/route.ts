import { NextResponse } from "next/server";
import {
  linkOrthancStudyCommand,
  listImagingStudiesCommand,
} from "@/lib/application/imaging/commands";
import { applicationErrorCode } from "@/lib/application/errors";
import { getSession } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return error("unauthorized", 401);
  const patientId = new URL(request.url).searchParams.get("patientId")?.trim() || undefined;
  try {
    return NextResponse.json({ studies: await listImagingStudiesCommand(session, patientId) });
  } catch (cause) {
    return mapError(cause);
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return error("unauthorized", 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const patientId = typeof body?.patientId === "string" ? body.patientId.trim() : "";
  const externalStudyId = typeof body?.externalStudyId === "string" ? body.externalStudyId.trim() : "";
  if (!patientId || !externalStudyId) return error("imaging-input-invalid", 400);

  try {
    return NextResponse.json(
      { study: await linkOrthancStudyCommand(session, { patientId, externalStudyId }) },
      { status: 201 },
    );
  } catch (cause) {
    return mapError(cause);
  }
}

function mapError(cause: unknown) {
  const code = applicationErrorCode(cause, "imaging-request-failed");
  const status = new Set([
    "imaging-view-denied",
    "imaging-link-denied",
    "imaging-patient-not-found",
    "imaging-study-not-found",
    "orthanc-study-not-found",
  ]).has(code)
    ? code.endsWith("denied")
      ? 403
      : 404
    : code === "orthanc-study-id-invalid" || code === "imaging-input-invalid"
      ? 400
      : 503;
  return error(code, status);
}

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}
