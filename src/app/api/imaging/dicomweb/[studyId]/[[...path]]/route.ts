import { getSession } from "@/lib/auth";
import { getImagingDicomweb, imagingPrivateHeaders, imagingProxyError } from "@/lib/application/imaging/dicomweb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ studyId: string; path?: string[] }> }) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401, headers: imagingPrivateHeaders() });
  const { studyId, path = [] } = await context.params;
  try { return await getImagingDicomweb(session, studyId, path, request); }
  catch (cause) { return imagingProxyError(cause); }
}

// Next automatically derives HEAD from GET; deny it explicitly for PHI endpoints.
export async function HEAD() { return new Response(null, { status: 405, headers: imagingPrivateHeaders() }); }
