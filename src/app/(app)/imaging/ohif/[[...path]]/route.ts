import { getSession } from "@/lib/auth";
import { getOhifResource } from "@/lib/application/imaging/ohif";
import { imagingPrivateHeaders, imagingProxyError } from "@/lib/application/imaging/dicomweb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401, headers: imagingPrivateHeaders() });
  const { path = [] } = await context.params;
  try { return await getOhifResource(session, path, request); }
  catch (cause) { return imagingProxyError(cause); }
}

export async function HEAD() { return new Response(null, { status: 405, headers: imagingPrivateHeaders() }); }
