import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";
import { isOptionalProvider, optionalProviderDefinitions } from "@/features/integrations/optional-provider";
import { configureOptionalProvider, getOptionalProviderSettings } from "@/lib/application/integrations/optional-provider-settings";
import { verifyOrthancConnection } from "@/integrations/orthanc/connection";
import { verifyChatwootConnection } from "@/integrations/chatwoot/client";
import { verifyNovuConnection } from "@/integrations/novu/client";
import { verifyMedplumConnection } from "@/integrations/medplum/client";
import { optionalBody, optionalError, optionalJson } from "../http";
const verifiers = { orthanc: verifyOrthancConnection, chatwoot: verifyChatwootConnection, novu: verifyNovuConnection, medplum: verifyMedplumConnection };
type Context = { params: Promise<{ provider: string }> };
export async function GET(_request: Request, context: Context) {
  const session = await getSession(); if (!session) return optionalJson({ error: "unauthorized" }, 401);
  const { provider } = await context.params;
  if (!isOptionalProvider(provider)) return optionalJson({ error: "integration-provider-not-found" }, 404);
  try { return optionalJson(await getOptionalProviderSettings(session, optionalProviderDefinitions[provider])); }
  catch (cause) { return optionalError(cause); }
}
export async function POST(request: Request, context: Context) {
  if (!hasSameOrigin(request)) return optionalJson({ error: "csrf-origin-invalid" }, 403);
  const session = await getSession(); if (!session) return optionalJson({ error: "unauthorized" }, 401);
  const { provider } = await context.params;
  if (!isOptionalProvider(provider)) return optionalJson({ error: "integration-provider-not-found" }, 404);
  try { return optionalJson(await configureOptionalProvider(session, optionalProviderDefinitions[provider], await optionalBody(request), verifiers[provider])); }
  catch (cause) { return optionalError(cause); }
}
