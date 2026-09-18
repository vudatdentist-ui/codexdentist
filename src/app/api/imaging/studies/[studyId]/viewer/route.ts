import { NextResponse } from "next/server";
import { applicationErrorCode } from "@/lib/application/errors";
import { getImagingViewerCommand } from "@/lib/application/imaging/commands";
import { getSession } from "@/lib/auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ studyId: string }> },
) {
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  const { studyId } = await context.params;
  try {
    const result = await getImagingViewerCommand(session, studyId);
    return json(result);
  } catch (cause) {
    const code = applicationErrorCode(cause, "imaging-viewer-failed");
    const status = code === "imaging-view-denied"
      ? 403
      : code === "imaging-study-not-found"
        ? 404
        : code === "orthanc-study-not-found"
          ? 404
        : code === "imaging-viewer-access-not-configured"
          ? 503
        : 503;
    return json({ error: code }, { status });
  }
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}
