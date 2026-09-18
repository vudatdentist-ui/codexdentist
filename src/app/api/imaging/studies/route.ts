import { NextResponse } from "next/server";
import {
  linkOrthancStudyCommand,
  listImagingStudiesCommand,
} from "@/lib/application/imaging/commands";
import { applicationErrorCode } from "@/lib/application/errors";
import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return error("unauthorized", 401);
  const patientId = new URL(request.url).searchParams.get("patientId")?.trim() || undefined;
  try {
    return json({ studies: await listImagingStudiesCommand(session, patientId) });
  } catch (cause) {
    return mapError(cause);
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return error("csrf-origin-invalid", 403);
  const session = await getSession();
  if (!session) return error("unauthorized", 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const patientId = typeof body?.patientId === "string" ? body.patientId.trim() : "";
  const externalStudyId = typeof body?.externalStudyId === "string" ? body.externalStudyId.trim() : "";
  if (!patientId || !externalStudyId) return error("imaging-input-invalid", 400);

  try {
    return json(
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
    "imaging-study-already-linked",
    "integration-external-reference-conflict",
    "integration-internal-reference-conflict",
    "orthanc-study-not-found",
  ]).has(code)
    ? code.endsWith("denied")
      ? 403
      : code.includes("already-linked") || code.includes("reference-conflict")
        ? 409
        : 404
    : code === "orthanc-study-id-invalid" || code === "imaging-input-invalid"
      ? 400
      : code.includes("denied") || code === "imaging-viewer-access-not-configured"
        ? 403
      : 503;
  return error(code, status);
}

function error(code: string, status: number) {
  return json({ error: code }, { status });
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}
