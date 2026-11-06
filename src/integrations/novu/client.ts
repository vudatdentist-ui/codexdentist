import "server-only";
import { optionalProviderFetch } from "@/integrations/optional-http";

// Contracts checked against https://api.novu.co/openapi.json and
// https://docs.novu.co/api-reference/idempotency (2026-11-06).
// Trigger acceptance is not delivery. Idempotency is plan/feature dependent,
// expires after 24h, and is never used as permission to replay uncertainty.
export class NovuError extends Error {
  constructor(public code: string, public status = 502) { super(code); }
}
export function novuConfig(secrets: Record<string, string>) {
  const { baseUrl, apiKey, environmentId, workflowId, testSubscriberId } = secrets;
  const deliveryChannel = secrets.deliveryChannel || "in_app";
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new NovuError("novu-base-url-invalid", 400); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    !["http:", "https:"].includes(url.protocol)) throw new NovuError("novu-base-url-invalid", 400);
  if (url.hostname === "novu.co" || url.hostname.endsWith(".novu.co")) throw new NovuError("novu-self-host-required", 400);
  if (!/^[\x21-\x7e]{8,2000}$/.test(apiKey ?? "") ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(environmentId ?? "") ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(workflowId ?? "") ||
    !/^cdx-test-[a-zA-Z0-9_-]{1,100}$/.test(testSubscriberId ?? "") || !["in_app", "email"].includes(deliveryChannel)) throw new NovuError("novu-credentials-invalid", 400);
  return { baseUrl: url.origin, apiKey, environmentId, workflowId, testSubscriberId, deliveryChannel };
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
async function request(secrets: Record<string, string>, path: string, init: RequestInit = {}) {
  const config = novuConfig(secrets);
  let response: Response;
  try {
    response = await optionalProviderFetch(`${config.baseUrl}${path}`, { ...init, cache: "no-store",
      headers: { "Authorization": `ApiKey ${config.apiKey}`, "Content-Type": "application/json", ...init.headers } });
  } catch { throw new NovuError("novu-request-uncertain"); }
  if (!response.ok) throw new NovuError(`novu-http-${response.status}`, response.status);
  try { return await response.json() as unknown; } catch { throw new NovuError("novu-response-invalid"); }
}
function data(value: unknown) { return record(record(value).data); }

export async function verifyNovuWorkflow(secrets: Record<string, string>) {
  const config = novuConfig(secrets);
  const workflow = data(await request(secrets, `/v2/workflows/${encodeURIComponent(config.workflowId)}`));
  const steps = Array.isArray(workflow.steps) ? workflow.steps.map(record) : [];
  // One selected step makes message reconciliation unambiguous. Multi-channel,
  // digest, delayed, custom and agent workflows require a separate acceptance.
  if (workflow.workflowId !== config.workflowId || workflow.active !== true || workflow.status !== "ACTIVE" ||
    steps.length !== 1 || steps[0].type !== config.deliveryChannel || workflow.agent) throw new NovuError("novu-workflow-not-supported", 409);
  if (typeof workflow._id !== "string" || !workflow._id) throw new NovuError("novu-response-invalid");
  const integrationsResponse = await request(secrets, "/v1/integrations/active");
  const integrationsData = Array.isArray(integrationsResponse) ? integrationsResponse : record(integrationsResponse).data;
  const emailIntegrations = Array.isArray(integrationsData) ? integrationsData.map(record)
    .filter(item => item.channel === config.deliveryChannel && item.active === true && item.deleted !== true) : [];
  // Custom SMTP is an OSS provider; no dependency on a vendor's paid/free-tier
  // email API. Operators must point it at their existing self-hosted mail server.
  const providerId = config.deliveryChannel === "email" ? "nodemailer" : "novu";
  if (emailIntegrations.length !== 1 || emailIntegrations[0].providerId !== providerId ||
    emailIntegrations[0]._environmentId !== config.environmentId) throw new NovuError(config.deliveryChannel === "email" ? "novu-self-hosted-smtp-required" : "novu-inbox-integration-required", 409);
  return { workflowDatabaseId: workflow._id };
}
export async function verifyNovuSubscriber(secrets: Record<string, string>, subscriberId: string, expectedEmail?: string, binding?: string) {
  if (!/^(?:cdx-sub-|cdx-test-)[a-zA-Z0-9_-]{1,100}$/.test(subscriberId)) throw new NovuError("novu-subscriber-invalid", 400);
  const subscriber = data(await request(secrets, `/v2/subscribers/${encodeURIComponent(subscriberId)}`));
  const config = novuConfig(secrets);
  if (subscriber.subscriberId !== subscriberId || subscriber._environmentId !== config.environmentId || subscriber.deleted === true ||
    typeof subscriber._id !== "string" || !subscriber._id || (config.deliveryChannel === "email" && typeof subscriber.email !== "string")) throw new NovuError("novu-subscriber-mismatch", 409);
  if (expectedEmail !== undefined && subscriber.email !== expectedEmail) throw new NovuError("novu-recipient-mismatch", 409);
  if (binding !== undefined && record(subscriber.data).codexdentistBinding !== binding) throw new NovuError("novu-subscriber-binding-mismatch", 409);
  return { subscriberDatabaseId: subscriber._id, email: typeof subscriber.email === "string" ? subscriber.email : "", synthetic: record(subscriber.data).codexdentistSynthetic === true };
}
export async function createNovuSubscriber(secrets: Record<string, string>, subscriberId: string, binding: string, email?: string) {
  if (!/^cdx-sub-[a-zA-Z0-9_-]{1,100}$/.test(subscriberId) || !/^[a-f0-9]{64}$/.test(binding)) throw new NovuError("novu-subscriber-invalid", 400);
  // Never upsert another recipient's attributes. A lost response or a concurrent
  // create is recovered by checking the original opaque binding, not by replacing it.
  try {
    await request(secrets, "/v2/subscribers?failIfExists=true", { method: "POST", body: JSON.stringify({
      subscriberId, ...(email !== undefined ? { email } : {}), data: { codexdentistBinding: binding } }) });
  } catch (error) {
    if (!(error instanceof NovuError) || ![409, 502].includes(error.status)) throw error;
  }
  return verifyNovuSubscriber(secrets, subscriberId, email, binding);
}
export async function verifyNovuSyntheticSubscriber(secrets: Record<string, string>) {
  const config = novuConfig(secrets);
  const subscriber = await verifyNovuSubscriber(secrets, config.testSubscriberId);
  if (!subscriber.synthetic || (subscriber.email !== "" && !/^[^@\s]+@example\.(?:test|com|org|net)$/.test(subscriber.email))) throw new NovuError("novu-test-subscriber-required", 409);
  return subscriber;
}
export async function verifyNovuConnection(secrets: Record<string, string>): Promise<{ identity: string }> {
  const config = novuConfig(secrets);
  const envelope = record(await request(secrets, "/v1/environments"));
  const environments = Array.isArray(envelope.data) ? envelope.data.map(record) : [];
  // Environment names and a successful HTTP status alone do not bind an API key.
  const environment = environments.find(item => item._id === config.environmentId &&
    Array.isArray(item.apiKeys) && item.apiKeys.some(key => record(key).key === config.apiKey));
  if (!environment || typeof environment.identifier !== "string" || typeof environment._organizationId !== "string") throw new NovuError("novu-environment-mismatch", 409);
  await verifyNovuWorkflow(secrets);
  await verifyNovuSyntheticSubscriber(secrets);
  return { identity: `${environment._organizationId}/${config.environmentId}/${environment.identifier}` };
}
export async function triggerNovu(secrets: Record<string, string>, input: { subscriberId: string; transactionId: string; synthetic: boolean }) {
  const config = novuConfig(secrets);
  const response = data(await request(secrets, "/v1/events/trigger", { method: "POST",
    headers: { "Idempotency-Key": input.transactionId }, body: JSON.stringify({ name: config.workflowId,
      to: input.subscriberId, transactionId: input.transactionId,
      payload: { kind: input.synthetic ? "operator-test" : "notification", version: 1 } }) }));
  if (response.acknowledged !== true || response.status !== "processed" || response.transactionId !== input.transactionId) {
    throw new NovuError("novu-trigger-not-confirmed");
  }
}
export async function observeNovuDelivery(secrets: Record<string, string>, input: {
  transactionId: string; subscriberDatabaseId: string; workflowDatabaseId: string;
}): Promise<"SENT" | "PENDING"> {
  const config = novuConfig(secrets);
  const envelope = record(await request(secrets, `/v1/messages?${new URLSearchParams({ transactionId: input.transactionId, limit: "2", page: "0", channel: config.deliveryChannel })}`));
  const messages = Array.isArray(envelope.data) ? envelope.data.map(record) : [];
  if (messages.length !== 1 || envelope.hasMore === true) return "PENDING";
  const message = messages[0];
  if (message.transactionId !== input.transactionId || message._environmentId !== config.environmentId ||
    message._subscriberId !== input.subscriberDatabaseId || message._templateId !== input.workflowDatabaseId ||
    message.channel !== config.deliveryChannel) throw new NovuError("novu-message-mismatch", 409);
  return message.status === "sent" ? "SENT" : "PENDING";
}
