import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";
import { reconcilePayOSOrder } from "@/lib/application/integrations/payos-reconcile";
import { payOSConnectionSecrets } from "../../../connection-secrets";
import { payOSJson, payOSError } from "../../../http";

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!hasSameOrigin(request)) return payOSJson({ error: "csrf-origin-invalid" }, 403);
  const session = await getSession();
  if (!session) return payOSJson({ error: "unauthorized" }, 401);
  try {
    const { orderId } = await context.params;
    return payOSJson(await reconcilePayOSOrder(session, orderId, payOSConnectionSecrets));
  } catch (cause) { return payOSError(cause); }
}
