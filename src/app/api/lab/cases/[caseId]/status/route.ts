import { noStoreJson as json } from "@/app/api/imaging/responses";
import { commandErrorCode as applicationErrorCode } from "@/app/api/imaging/responses";
import { transitionLabCaseCommand } from "@/lib/application/lab/commands";
import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  if (!hasSameOrigin(request)) return json({ error: "csrf-origin-invalid" }, { status: 403 });
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  const { caseId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const status = typeof body?.status === "string" ? body.status : "";
  try {
    return json({ case: await transitionLabCaseCommand(session, { id: caseId, status }) });
  } catch (cause) {
    const code = applicationErrorCode(cause, "lab-status-failed");
    const httpStatus = code.includes("denied") ? 403 : code === "lab-case-not-found" ? 404 : code.includes("invalid") ? 400 : code.includes("conflict") ? 409 : 503;
    return json({ error: code }, { status: httpStatus });
  }
}
