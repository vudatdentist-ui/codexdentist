import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AppSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import { hasAnyRole } from "@/lib/permissions";
import { createExternalReference } from "@/infrastructure/integrations/substrate";
import type { ExternalReferenceRecord } from "@/infrastructure/integrations/phase3-store";
import { loadOptionalProviderConnection } from "@/lib/application/integrations/optional-provider-settings";
import { ChatwootError, assertChatwootInbox, chatwootSettings, createChatwootContact, createChatwootConversation,
  findChatwootContact, readChatwootContact, listChatwootConversations, type ChatwootContact } from "@/integrations/chatwoot/client";
import { safeChatwootLink, type ChatwootPatientWorkspace } from "@/features/integrations/chatwoot-workspace";

type DB = Prisma.TransactionClient | typeof prisma;
type Binding = { origin: string; accountId: string; inboxId: string };
type Metadata = Binding & { status: "CONTACT_READY" | "CONTACT_CREATING" | "CONTACT_SAVED" | "CONVERSATION_CREATING" | "SAVED";
  contactId?: string; sourceId?: string; conversationId?: string };
function metadata(ref: ExternalReferenceRecord) { return ref.metadata as Metadata; }
function fail(code: string, status = 409): never { throw new ChatwootError(code, status); }
function allowed(session: AppSession, clinicId = session.activeClinicId) {
  return hasAnyRole({ ...session, activeClinicId: clinicId }, ["OWNER", "FRONT_DESK"]);
}
async function patient(session: AppSession, patientId: string, db: DB = prisma) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(patientId)) fail("chatwoot-input-invalid", 400);
  const result = await db.patient.findFirst({ where: { id: patientId, organizationId: session.organizationId,
    clinicId: { in: accessibleClinicIds(session) } }, select: { id: true, clinicId: true } });
  if (!result) fail("chatwoot-patient-not-found", 404);
  if (!allowed(session, result.clinicId)) fail("chatwoot-forbidden", 403);
  return result;
}
async function references(db: DB, session: AppSession, patientId: string) {
  return db.$queryRawUnsafe<ExternalReferenceRecord[]>(`SELECT * FROM "ExternalReference"
    WHERE "organizationId"=$1 AND "provider"='chatwoot' AND "entityType"='CHATWOOT_PATIENT' AND "internalId"=$2`,
  session.organizationId, patientId);
}
function assertBinding(ref: ExternalReferenceRecord, clinicId: string, connectionId: string, binding: Binding) {
  const data = metadata(ref);
  if (ref.clinicId !== clinicId || ref.connectionId !== connectionId || !data ||
      data.origin !== binding.origin || data.accountId !== binding.accountId || data.inboxId !== binding.inboxId ||
      !/^cdcw_[a-f0-9-]{36}$/.test(ref.externalId)) fail("chatwoot-binding-conflict");
}
async function existing(db: DB, session: AppSession, patientId: string, clinicId: string, connectionId: string, binding: Binding) {
  const rows = await references(db, session, patientId);
  if (rows.length > 1) fail("chatwoot-binding-conflict");
  if (rows[0]) assertBinding(rows[0], clinicId, connectionId, binding);
  return rows[0] ?? null;
}
function blank(patientId: string, state: ChatwootPatientWorkspace["state"], canManage = false): ChatwootPatientWorkspace {
  return { patientId, state, canManage, opaqueIdentifier: null, contactId: null, conversations: [] };
}
export async function getChatwootPatient(session: AppSession, patientId: string): Promise<ChatwootPatientWorkspace> {
  const scoped = await patient(session, patientId);
  if (session.isDemo) return blank(patientId, "DISABLED");
  let loaded: Awaited<ReturnType<typeof loadOptionalProviderConnection>>;
  try { loaded = await loadOptionalProviderConnection(session, "chatwoot", scoped.clinicId); }
  catch (error) {
    const status = (error as { status?: number })?.status;
    return blank(patientId, status === 403 ? "PERMISSION" : status === 409 || status === 404 ? "DISABLED" : "UNKNOWN");
  }
  const { secrets, connection } = loaded, binding = chatwootSettings(secrets);
  const ref = await existing(prisma, session, patientId, scoped.clinicId, connection.id, binding);
  if (!ref) return blank(patientId, "EMPTY", true);
  const data = metadata(ref);
  const view = { ...blank(patientId, data.status === "SAVED" ? "SAVED" : data.status === "CONTACT_READY" ? "EMPTY" : "UNKNOWN", true),
    opaqueIdentifier: ref.externalId, contactId: data.contactId ?? null };
  if (!data.contactId) return view;
  try {
    const linked = await readChatwootContact(secrets, data.contactId, ref.externalId);
    if (linked.sourceId !== data.sourceId) fail("chatwoot-binding-conflict");
    const conversations = await listChatwootConversations(secrets, linked);
    return { ...view, state: data.status === "SAVED" && conversations.some(row => row.id === data.conversationId) ? "SAVED" : "UNKNOWN",
      conversations: conversations.map(row => ({ id: row.id, status: row.status,
      url: safeChatwootLink(`${binding.origin}/app/accounts/${binding.accountId}/conversations/${row.id}`) })) };
  } catch { return { ...view, state: "UNKNOWN" }; }
}

// Patient locking serializes reservation and finalization. Provider I/O is always
// after commit. CREATING is deliberately durable: expiry never authorizes a second
// POST. Recovery only performs exact opaque-ID/operation lookups, even after crash.
export async function manageChatwootPatient(session: AppSession, input: {
  patientId: string; action: "ensure" | "recover" | "link" | "prepare"; contactId?: string; conversationId?: string;
}): Promise<ChatwootPatientWorkspace> {
  if (!["ensure", "recover", "link", "prepare"].includes(input.action)) fail("chatwoot-input-invalid", 400);
  const scoped = await patient(session, input.patientId);
  if (session.isDemo) fail("chatwoot-demo-disabled", 403);
  const { secrets, connection } = await loadOptionalProviderConnection(session, "chatwoot", scoped.clinicId);
  const binding = chatwootSettings(secrets);
  const configurationVersion = (connection.metadata as { configurationVersion?: unknown } | null)?.configurationVersion;
  if (typeof configurationVersion !== "string" || !configurationVersion) fail("chatwoot-connection-changed");
  await assertChatwootInbox(secrets);
  const locked = async <T>(operation: (tx: Prisma.TransactionClient, ref: ExternalReferenceRecord | null) => Promise<T>) =>
    // This workflow owns no ledger balances. READ COMMITTED is intentional:
    // after waiting for the Patient lock, its next statement must see the other
    // request's committed reservation. A Serializable snapshot taken before that
    // lock can miss it and collide with ExternalReference_internal_key instead.
    // Every reference write is serialized by this same canonical Patient lock.
    prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT "id" FROM "Patient" WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`, scoped.id, session.organizationId);
      const current = await patient(session, scoped.id, tx);
      if (current.clinicId !== scoped.clinicId) fail("chatwoot-binding-conflict");
      const active = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "IntegrationConnection"
        WHERE "id"=$1 AND "organizationId"=$2 AND "provider"='chatwoot' AND "status"='ACTIVE'
        AND "metadata"->>'configurationVersion'=$3 AND "metadata"->>'verifiedVersion'=$3
        AND "lastVerifiedAt" IS NOT NULL AND "secretRef"='vault:v1'
        AND ("clinicId"=$4 OR "clinicId" IS NULL) FOR SHARE`,
      connection.id, session.organizationId, configurationVersion, scoped.clinicId);
      if (!active.length) fail("chatwoot-connection-changed");
      return operation(tx, await existing(tx, session, scoped.id, scoped.clinicId, connection.id, binding));
    }, { isolationLevel: "ReadCommitted" });
  const audit = async (tx: Prisma.TransactionClient, action: string) => tx.auditLog.create({ data: {
    organizationId: session.organizationId, actorId: session.userId, action, entityType: "Patient", entityId: scoped.id,
    metadata: { provider: "chatwoot", connectionId: connection.id },
  } });
  const save = async (expected: Metadata["status"], patch: Partial<Metadata>, event: string) => locked(async (tx, ref) => {
    if (!ref) fail("chatwoot-binding-conflict");
    const data = metadata(ref);
    if (data.status !== expected) return ref;
    const next = { ...data, ...patch };
    await tx.$executeRawUnsafe(`UPDATE "ExternalReference" SET "metadata"=$2::jsonb,
      "updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE "id"=$1`, ref.id, JSON.stringify(next));
    await audit(tx, event);
    return { ...ref, metadata: next };
  });
  const reserved = await locked(async (tx, ref) => {
    if (ref) return ref;
    if (!["ensure", "prepare"].includes(input.action)) fail("chatwoot-no-saved-request");
    const created = await createExternalReference(tx, { organizationId: session.organizationId, clinicId: scoped.clinicId,
      connectionId: connection.id, provider: "chatwoot", entityType: "CHATWOOT_PATIENT", internalId: scoped.id,
      externalId: `cdcw_${randomUUID()}`, metadata: { ...binding, status: "CONTACT_READY" } });
    await audit(tx, "patient.chatwoot_requested");
    return created;
  });
  if (input.action === "prepare") return getChatwootPatient(session, scoped.id);
  let ref = reserved, data = metadata(ref);
  if (data.status === "CONTACT_CREATING" || data.status === "CONTACT_READY") {
    let expected = data.status;
    let linked: ChatwootContact | null;
    if (input.action === "link") {
      if (!input.contactId) fail("chatwoot-input-invalid", 400);
      linked = await readChatwootContact(secrets, input.contactId, ref.externalId);
    } else {
      linked = await findChatwootContact(secrets, ref.externalId);
      if (!linked && data.status === "CONTACT_READY" && input.action === "ensure") {
        const claim = await locked(async (tx, current) => {
          if (!current || metadata(current).status !== "CONTACT_READY") return false;
          await tx.$executeRawUnsafe(`UPDATE "ExternalReference" SET "metadata"=$2::jsonb,
            "updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE "id"=$1`, current.id, JSON.stringify({ ...metadata(current), status: "CONTACT_CREATING" }));
          return true;
        });
        if (claim) { expected = "CONTACT_CREATING"; linked = await createChatwootContact(secrets, ref.externalId); }
      }
    }
    if (!linked) return getChatwootPatient(session, scoped.id);
    ref = await save(expected, { status: "CONTACT_SAVED", contactId: linked.id, sourceId: linked.sourceId }, "patient.chatwoot_contact_linked");
    data = metadata(ref);
  }
  if (data.status === "CONTACT_CREATING") return getChatwootPatient(session, scoped.id);
  if (!data.contactId) fail("chatwoot-binding-conflict");
  if (input.contactId && input.contactId !== data.contactId) fail("chatwoot-contact-mismatch");
  const linked = await readChatwootContact(secrets, data.contactId, ref.externalId);
  if (linked.sourceId !== data.sourceId) fail("chatwoot-binding-conflict");
  const conversations = await listChatwootConversations(secrets, linked);
  if (data.status === "SAVED") return getChatwootPatient(session, scoped.id);
  const matches = conversations.filter(row => row.operation === ref.externalId || (input.action === "link" && row.id === input.conversationId));
  if (matches.length > 1) fail("chatwoot-conversation-ambiguous");
  if (matches[0]) {
    await save(data.status, { status: "SAVED", conversationId: matches[0].id }, "patient.chatwoot_conversation_linked");
    return getChatwootPatient(session, scoped.id);
  }
  if (input.conversationId) fail("chatwoot-conversation-mismatch");
  if (data.status === "CONVERSATION_CREATING" || input.action !== "ensure") return getChatwootPatient(session, scoped.id);
  const claim = await locked(async (tx, current) => {
    if (!current || metadata(current).status !== "CONTACT_SAVED") return false;
    await tx.$executeRawUnsafe(`UPDATE "ExternalReference" SET "metadata"=$2::jsonb,
      "updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE "id"=$1`, current.id, JSON.stringify({ ...metadata(current), status: "CONVERSATION_CREATING" }));
    await audit(tx, "patient.chatwoot_conversation_requested");
    return true;
  });
  if (claim) {
    const conversationId = await createChatwootConversation(secrets, linked, ref.externalId);
    await save("CONVERSATION_CREATING", { status: "SAVED", conversationId }, "patient.chatwoot_conversation_linked");
  }
  return getChatwootPatient(session, scoped.id);
}
