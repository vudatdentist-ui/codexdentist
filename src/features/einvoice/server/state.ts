import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

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

type AuditClient = Prisma.TransactionClient | typeof prisma;

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

  const states = new Map<string, EInvoiceStateSnapshot>();

  for (const event of events) {
    if (!event.entityId) continue;
    const state = stateFromAction(event.action);
    if (!state) continue;
    const metadata = metadataRecord(event.metadata);

    states.set(event.entityId, {
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
    });
  }

  return states;
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
  };
}

export async function appendEInvoiceEvent({
  client = prisma,
  organizationId,
  actorId,
  invoiceId,
  input,
}: {
  client?: AuditClient;
  organizationId: string;
  actorId: string | null;
  invoiceId: string;
  input: EInvoiceEventInput;
}) {
  return client.auditLog.create({
    data: {
      organizationId,
      actorId,
      action: actionByState[input.state],
      entityType: "Invoice",
      entityId: invoiceId,
      metadata: {
        state: input.state,
        operation: input.operation,
        providerKey: input.providerKey ?? null,
        externalInvoiceId: input.externalInvoiceId ?? null,
        lookupCode: input.lookupCode ?? null,
        replacementReference: input.replacementReference ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        amountSnapshot: input.amountSnapshot ?? null,
        invoiceStatusSnapshot: input.invoiceStatusSnapshot ?? null,
        source: input.source ?? "system",
      } as Prisma.InputJsonValue,
    },
    select: { id: true, createdAt: true },
  });
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

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
