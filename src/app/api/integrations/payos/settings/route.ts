import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";
import { getPayOSSettings, savePayOSSettings, verifyPayOSSettings } from "@/lib/application/integrations/payos-settings";
import { confirmPayOSWebhook } from "@/integrations/payos/client";
import { payOSConnectionSecrets } from "../connection-secrets";
import { payOSJson, payOSError, payOSRequestBody } from "../http";

export async function GET() {
  const session = await getSession();
  if (!session) return payOSJson({ error: "unauthorized" }, 401);
  try { return payOSJson(await getPayOSSettings(session)); } catch (cause) { return payOSError(cause); }
}
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return payOSJson({ error: "csrf-origin-invalid" }, 403);
  const session = await getSession();
  if (!session) return payOSJson({ error: "unauthorized" }, 401);
  try {
    const body = await payOSRequestBody(request);
    const result = body.action === "verify"
      ? await verifyPayOSSettings(session, body, async (connection, url) => confirmPayOSWebhook(await payOSConnectionSecrets(connection), url))
      : await savePayOSSettings(session, body);
    return payOSJson(result);
  } catch (cause) { return payOSError(cause); }
}
