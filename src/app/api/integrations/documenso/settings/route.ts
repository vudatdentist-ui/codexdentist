import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";
import { getDocumensoSettings, saveDocumensoSettings } from "@/lib/application/integrations/documenso-settings";
import { documensoJson, documensoError, documensoRequestBody } from "../http";

export async function GET() {
  const session = await getSession();
  if (!session) return documensoJson({ error: "unauthorized" }, 401);
  try { return documensoJson(await getDocumensoSettings(session)); } catch (cause) { return documensoError(cause); }
}
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return documensoJson({ error: "csrf-origin-invalid" }, 403);
  const session = await getSession();
  if (!session) return documensoJson({ error: "unauthorized" }, 401);
  try { return documensoJson(await saveDocumensoSettings(session, await documensoRequestBody(request))); }
  catch (cause) { return documensoError(cause); }
}
