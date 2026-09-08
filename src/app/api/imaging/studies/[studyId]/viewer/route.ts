import { NextResponse } from "next/server";
import { applicationErrorCode } from "@/lib/application/errors";
import { getImagingViewerCommand } from "@/lib/application/imaging/commands";
import { getSession } from "@/lib/auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ studyId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { studyId } = await context.params;
  try {
    const result = await getImagingViewerCommand(session, studyId);
    return NextResponse.json(result);
  } catch (cause) {
    const code = applicationErrorCode(cause, "imaging-viewer-failed");
    const status = code === "imaging-view-denied"
      ? 403
      : code === "imaging-study-not-found"
        ? 404
        : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
