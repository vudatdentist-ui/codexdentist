import "server-only";
import { optionalProviderFetch } from "@/integrations/optional-http";

/** Required encrypted settings: baseUrl (root HTTPS/trusted internal HTTP origin), apiToken (user API
 * token), accountId and inboxId (positive decimal IDs). The shared HTTP boundary
 * enforces the environment-specific exact-origin allowlist. Chatwoot >=4.19 supports
 * Bearer auth. Only Channel::Api inboxes with greetings disabled are accepted.
 * Official contracts reviewed 2026-11-06:
 * https://developers.chatwoot.com/api-reference/account/get-account-details
 * https://developers.chatwoot.com/api-reference/inboxes/get-an-inbox
 * https://developers.chatwoot.com/api-reference/contacts/create-contact
 * https://developers.chatwoot.com/api-reference/contacts/contact-filter
 * https://developers.chatwoot.com/api-reference/contacts/contact-conversations
 * https://developers.chatwoot.com/api-reference/conversations/create-new-conversation
 *
 * Zero-license-fee self-host target (reviewed 2026-11-06):
 * chatwoot/chatwoot:v4.19.1-ce, or build that release's community source.
 * Core is MIT Expat; enterprise/ is separately licensed and is not required.
 * https://github.com/chatwoot/chatwoot/blob/v4.19.1/LICENSE
 * Core Account#api_and_webhooks_enabled? returns true; account/inbox/contact/
 * conversation controllers live outside enterprise/ and require no paid SSO or
 * management API. Codexdentist keeps its own native audit logs.
 * https://github.com/chatwoot/chatwoot/blob/v4.19.1/app/models/account.rb
 * https://hub.docker.com/r/chatwoot/chatwoot/tags
 * Sidecar: Rails + Sidekiq, dedicated Postgres/pgvector store, local Redis-compatible
 * queue, persistent /app/storage, existing HTTPS proxy; bootstrap with
 * `bundle exec rails db:chatwoot_prepare`. Use a local admin/user API token and
 * dedicated API inbox with greetings/bots/automations disabled. No cloud account,
 * SMTP, paid messaging channel or Chatwoot Enterprise license is needed here.
 */
export class ChatwootError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
}
export function chatwootSettings(secrets: Record<string, string>) {
  let url: URL;
  try { url = new URL(secrets.baseUrl); } catch { throw new ChatwootError("chatwoot-settings-invalid", 409); }
  if (!["https:", "http:"].includes(url.protocol) || url.pathname !== "/" || url.username || url.password || url.search || url.hash ||
      !/^[1-9][0-9]{0,14}$/.test(secrets.accountId ?? "") || !/^[1-9][0-9]{0,14}$/.test(secrets.inboxId ?? "") ||
      !secrets.apiToken || /[\r\n]/.test(secrets.apiToken)) throw new ChatwootError("chatwoot-settings-invalid", 409);
  return { origin: url.origin, accountId: secrets.accountId, inboxId: secrets.inboxId };
}
type Obj = Record<string, unknown>;
function obj(value: unknown): Obj { return value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {}; }
function id(value: unknown): string {
  const result = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
  if (!/^[1-9][0-9]{0,14}$/.test(result)) throw new ChatwootError("chatwoot-response-invalid");
  return result;
}
async function request(secrets: Record<string, string>, path: string, body?: Obj) {
  const settings = chatwootSettings(secrets);
  try {
    const response = await optionalProviderFetch(`${settings.origin}/api/v1/accounts/${settings.accountId}${path}`, {
      method: body ? "POST" : "GET", cache: "no-store",
      headers: { Authorization: `Bearer ${secrets.apiToken}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new ChatwootError("chatwoot-provider-unavailable");
    return obj(await response.json());
  } catch (error) {
    if (error instanceof ChatwootError) throw error;
    throw new ChatwootError("chatwoot-provider-unavailable");
  }
}
export async function verifyChatwootConnection(secrets: Record<string, string>): Promise<{ identity: string }> {
  const settings = chatwootSettings(secrets);
  const account = await request(secrets, "");
  if (id(account.id) !== settings.accountId) throw new ChatwootError("chatwoot-account-mismatch", 409);
  await assertChatwootInbox(secrets);
  return { identity: `${settings.origin}/accounts/${settings.accountId}` };
}
export async function assertChatwootInbox(secrets: Record<string, string>) {
  const settings = chatwootSettings(secrets);
  const inbox = await request(secrets, `/inboxes/${settings.inboxId}`);
  if (id(inbox.id) !== settings.inboxId || inbox.channel_type !== "Channel::Api" || inbox.greeting_enabled !== false)
    throw new ChatwootError("chatwoot-inbox-unsafe", 409);
}
export type ChatwootContact = { id: string; sourceId: string };
function contact(secrets: Record<string, string>, raw: unknown, identifier: string): ChatwootContact {
  const data = obj(raw), settings = chatwootSettings(secrets);
  if (data.identifier !== identifier || !Array.isArray(data.contact_inboxes)) throw new ChatwootError("chatwoot-contact-mismatch", 409);
  const inboxes = data.contact_inboxes.map(obj).filter(row => String(obj(row.inbox).id) === settings.inboxId);
  if (inboxes.length !== 1 || typeof inboxes[0].source_id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(inboxes[0].source_id))
    throw new ChatwootError("chatwoot-contact-mismatch", 409);
  return { id: id(data.id), sourceId: inboxes[0].source_id };
}
export async function readChatwootContact(secrets: Record<string, string>, contactId: string, identifier: string) {
  const data = await request(secrets, `/contacts/${id(contactId)}`);
  return contact(secrets, data.payload ?? data, identifier);
}
export async function findChatwootContact(secrets: Record<string, string>, identifier: string) {
  const data = await request(secrets, "/contacts/filter", { payload: [
    { attribute_key: "identifier", filter_operator: "equal_to", values: [identifier], query_operator: null },
  ] });
  if (!Array.isArray(data.payload)) throw new ChatwootError("chatwoot-response-invalid");
  const exact = data.payload.filter(value => obj(value).identifier === identifier);
  if (exact.length > 1 || Number(obj(data.meta).count ?? exact.length) > exact.length) throw new ChatwootError("chatwoot-contact-ambiguous", 409);
  return exact.length ? contact(secrets, exact[0], identifier) : null;
}
export async function createChatwootContact(secrets: Record<string, string>, identifier: string) {
  const data = await request(secrets, "/contacts", { inbox_id: Number(chatwootSettings(secrets).inboxId), identifier });
  // Current application endpoint wraps the created contact in payload.contact.
  const payload = obj(data.payload);
  return contact(secrets, payload.contact ?? data.payload ?? data, identifier);
}
export type ChatwootConversationRecord = { id: string; status: string; operation: string | null };
export async function listChatwootConversations(secrets: Record<string, string>, linked: ChatwootContact): Promise<ChatwootConversationRecord[]> {
  const data = await request(secrets, `/contacts/${id(linked.id)}/conversations`);
  if (!Array.isArray(data.payload)) throw new ChatwootError("chatwoot-response-invalid");
  const settings = chatwootSettings(secrets);
  return data.payload.map(obj).filter(row => String(row.inbox_id) === settings.inboxId).map(row => {
    if ((row.account_id !== undefined && String(row.account_id) !== settings.accountId) ||
        (obj(obj(row.meta).sender).id !== undefined && String(obj(obj(row.meta).sender).id) !== linked.id))
      throw new ChatwootError("chatwoot-conversation-mismatch", 409);
    return { id: id(row.id), status: ["open", "pending", "resolved", "snoozed"].includes(String(row.status)) ? String(row.status) : "unknown",
      operation: typeof obj(row.additional_attributes).codexdentist_operation === "string" ? obj(row.additional_attributes).codexdentist_operation as string : null };
  });
}
export async function createChatwootConversation(secrets: Record<string, string>, linked: ChatwootContact, operation: string) {
  const settings = chatwootSettings(secrets);
  const data = await request(secrets, "/conversations", { inbox_id: Number(settings.inboxId), contact_id: Number(id(linked.id)),
    source_id: linked.sourceId, status: "open", additional_attributes: { codexdentist_operation: operation } });
  if (String(data.account_id) !== settings.accountId || String(data.inbox_id) !== settings.inboxId)
    throw new ChatwootError("chatwoot-conversation-mismatch", 409);
  return id(data.id);
}
