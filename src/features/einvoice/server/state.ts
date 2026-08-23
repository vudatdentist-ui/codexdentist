import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { runSerializableTransaction } from "@/lib/transaction";

export type EInvoiceState =
  | "NOT_REQUIRED"
  | "PENDING"
  | "ISSUED"
  | "FAILED"
  | "CANCELLED"
  | "REPLACED";

export type EInvoiceOperation = "ISSUE" | "SYNC" | "CANCEL" | "REPLACE" | "MANUAL_RECONCILE";

export type EInvoiceStateSnapshot = {
  invoiceId: string;
  state: EInvoiceState;
  operation: EInvoiceOperation | null;
  providerKey: string | null;
  externalInvoiceId: string | null;
  lookupCode: string | null;
  replacementReference: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  amountSnapshot: number | null;
  invoiceStatusSnapshot: string | null;
  updatedAt: string | null;
  updatedAtMs: number | null;
  eventId: string | null;
  version: number;
};

export type EInvoiceEventInput = {
  state: EInvoiceState;
  operation: EInvoiceOperation;
  providerKey?: string | null;
  externalInvoiceId?: string | null;
  lookupCode?: string | null;
  replacementReference?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  amountSnapshot?: number | null;
  invoiceStatusSnapshot?: string | null;
  source?: "provider" | "manual" | "system";
};

export class EInvoiceTransitionError extends Error {
  constructor(message = "E-invoice state changed before this operation could be applied.") {
    super(message);
    this.name = "EInvoiceTransitionError";
  }
}

type AuditClient = Prisma.TransactionClient | typeof prisma;
type AuditEvent = {
  id: string;
  entityId: string | null;
  action: string;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

const actionByState: Record<EInvoiceState, string> = {
  NOT_REQUIRED: "einvoice.not_required",
  PENDING: "einvoice.pending",
  ISSUED: "einvoice.issued",
  FAILED: "einvoice.failed",
  CANCELLED: "einvoice.cancelled",
  REPLACED: "einvoice.replaced",
};

export async function loadEInvoiceStates(
  session: AppSession,
  invoiceIds: string[],
): Promise<Map<string, EInvoiceStateSnapshot>> {
  if (invoiceIds.length === 0) {
    return new Map();
  }

  const events = await prisma.auditLog.findMany({
    where: {
      organizationId: session.organizationId,
      entityType: "Invoice",
      entityId: { in: invoiceIds },
      action: { startsWith: "einvoice." },
    },
    select: {
      id: true,
      entityId: true,
      action: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return reduceStates(events);
}

export function emptyEInvoiceState(invoiceId: string): EInvoiceStateSnapshot {
  return {
    invoiceId,
    state: "NOT_REQUIRED",
    operation: null,
    providerKey: null,
    externalInvoiceId: null,
    lookupCode: null,
    replacementReference: null,
    errorCode: null,
    errorMessage: null,
    amountSnapshot: null,
    invoiceStatusSnapshot: null,
    updatedAt: null,
    updatedAtMs: null,
    eventId: null,
    version: 0,
  };
}

export async function transitionEInvoiceState({
  organizationId,
  actorId,
  invoiceId,
  input,
  allow,
}: {
  organizationId: string;
  actorId: string | null;
  invoiceId: string;
  input: EInvoiceEventInput;
  allow: (current: EInvoiceStateSnapshot) => boolean;
}): Promise<EInvoiceStateSnapshot> {
  return runSerializableTransaction(async (tx) => {
    const current = await loadOneState(tx, organizationId, invoiceId);
    if (!allow(current)) {
      throw new EInvoiceTransitionError();
    }

    const version = current.version + 1;
    const event = await appendEInvoiceEvent({
      client: tx,
      organizationId,
      actorId,
      invoiceId,
      input,
      version,
    });

    return snapshotFromEvent(
      {
        id: event.id,
        entityId: invoiceId,
        action: actionByState[input.state],
        metadata: event.metadata,
        createdAt: event.createdAt,
      },
      version,
    );
  });
}

async function loadOneState(
  client: AuditClient,
  organizationId: string,
  invoiceId: string,
): Promise<EInvoiceStateSnapshot> {
  const events = await client.auditLog.findMany({
    where: {
      organizationId,
      entityType: "Invoice",
      entityId: invoiceId,
      action: { startsWith: "einvoice." },
    },
    select: {
      id: true,
      entityId: true,
      action: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return reduceStates(events).get(invoiceId) ?? emptyEInvoiceState(invoiceId);
}

async function appendEInvoiceEvent({
  client,
  organizationId,
  actorId,
  invoiceId,
  input,
  version,
}: {
  client: AuditClient;
  organizationId: string;
  actorId: string | null;
  invoiceId: string;
  input: EInvoiceEventInput;
  version: number;
}) {
  const metadata = {
    version,
    state: input.state,
    operation: input.operation,
    providerKey: boundedText(input.providerKey, 80),
    externalInvoiceId: boundedText(input.externalInvoiceId, 180),
    lookupCode: boundedText(input.lookupCode, 180),
    replacementReference: boundedText(input.replacementReference, 180),
    errorCode: boundedText(input.errorCode, 80),
    errorMessage: boundedText(input.errorMessage, 500),
    amountSnapshot: finiteNumber(input.amountSnapshot),
    invoiceStatusSnapshot: boundedText(input.invoiceStatusSnapshot, 40),
    source: input.source ?? "system",
  } satisfies Record<string, Prisma.InputJsonValue | null>;

  const event = await client.auditLog.create({
    data: {
      organizationId,
      actorId,
      action: actionByState[input.state],
      entityType: "Invoice",
      entityId: invoiceId,
      metadata: metadata as Prisma.InputJsonValue,
    },
    select: { id: true, metadata: true, createdAt: true },
  });

  return event;
}

function reduceStates(events: AuditEvent[]) {
  const states = new Map<string, EInvoiceStateSnapshot>();

  for (const event of events) {
    if (!event.entityId) continue;
    const state = stateFromAction(event.action);
    if (!state) continue;

    const current = states.get(event.entityId) ?? emptyEInvoiceState(event.entityId);
    const metadata = metadataRecord(event.metadata);
    const explicitVersion = positiveInteger(metadata.version);
    const version = explicitVersion ?? current.version + 1;

    if (version < current.version) {
      continue;
    }

    states.set(event.entityId, snapshotFromEvent(event, version));
  }

  return states;
}

function snapshotFromEvent(event: AuditEvent, version: number): EInvoiceStateSnapshot {
  const state = stateFromAction(event.action);
  if (!event.entityId || !state) {
    throw new Error("Invalid E-invoice audit event.");
  }
  const metadata = metadataRecord(event.metadata);

  return {
    invoiceId: event.entityId,
    state,
    operation: operationValue(metadata.operation),
    providerKey: stringValue(metadata.providerKey),
    externalInvoiceId: stringValue(metadata.externalInvoiceId),
    lookupCode: stringValue(metadata.lookupCode),
    replacementReference: stringValue(metadata.replacementReference),
    errorCode: stringValue(metadata.errorCode),
    errorMessage: stringValue(metadata.errorMessage),
    amountSnapshot: numberValue(metadata.amountSnapshot),
    invoiceStatusSnapshot: stringValue(metadata.invoiceStatusSnapshot),
    updatedAt: event.createdAt.toISOString(),
    updatedAtMs: event.createdAt.getTime(),
    eventId: event.id,
    version,
  };
}

function stateFromAction(action: string): EInvoiceState | null {
  const entry = Object.entries(actionByState).find(([, value]) => value === action);
  return (entry?.[0] as EInvoiceState | undefined) ?? null;
}

function metadataRecord(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function boundedText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumber(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function operationValue(value: unknown): EInvoiceOperation | null {
  return value === "ISSUE" ||
    value === "SYNC" ||
    value === "CANCEL" ||
    value === "REPLACE" ||
    value === "MANUAL_RECONCILE"
    ? value
    : null;
}
