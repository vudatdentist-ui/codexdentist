"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import { databaseActorId, requiredString } from "@/lib/form-validation";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { resolveEInvoiceAdapter, type EInvoiceProviderInvoice } from "./adapter";
import {
  EInvoiceTransitionError,
  emptyEInvoiceState,
  loadEInvoiceStates,
  transitionEInvoiceState,
  type EInvoiceStateSnapshot,
} from "./state";

const pendingSyncMinAgeMs = 30 * 60 * 1000;

export async function requestEInvoiceIssueAction(formData: FormData) {
  const session = await requireViewSession("billing");
  guardInvoiceIssue(session);
  const invoice = await scopedInvoice(session, requiredString(formData.get("invoiceId")));

  if (!invoice || invoice.status === "VOID") {
    redirect(financeNotice("einvoice-invoice-unavailable"));
  }

  const current = await currentState(session, invoice.id);
  if (current.state === "PENDING") {
    redirect(financeNotice("einvoice-request-pending"));
  }
  if (!canSafelyRequestIssue(current)) {
    redirect(financeNotice("einvoice-request-state-invalid"));
  }

  const adapter = resolveEInvoiceAdapter();
  const actorId = databaseActorId(session.userId);
  const claim = await guardedTransition({
    organizationId: session.organizationId,
    actorId,
    invoiceId: invoice.id,
    input: {
      state: "PENDING",
      operation: "ISSUE",
      providerKey: adapter.providerKey,
      amountSnapshot: Number(invoice.amount),
      invoiceStatusSnapshot: invoice.status,
      source: "provider",
    },
    allow: canSafelyRequestIssue,
    validate: (tx) => invoiceStatusMatches(tx, session, invoice.id, false),
    notice: "einvoice-state-conflict",
  });

  const result = await adapter.issue(toProviderInvoice(session, invoice)).catch(() => ({
    state: "FAILED" as const,
    providerKey: adapter.providerKey,
    errorCode: "PROVIDER_REQUEST_ERROR",
    errorMessage: "Không xác nhận được phản hồi phát hành từ nhà cung cấp HĐĐT.",
  }));

  await guardedTransition({
    organizationId: session.organizationId,
    actorId,
    invoiceId: invoice.id,
    input: {
      state: result.state,
      operation: "ISSUE",
      providerKey: result.providerKey,
      externalInvoiceId: result.externalInvoiceId,
      lookupCode: result.lookupCode,
      replacementReference: result.replacementReference,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      amountSnapshot: Number(invoice.amount),
      invoiceStatusSnapshot: invoice.status,
      source: "provider",
    },
    allow: (latest) =>
      latest.eventId === claim.eventId &&
      latest.state === "PENDING" &&
      latest.operation === "ISSUE",
    notice: "einvoice-state-conflict",
  });

  finish(result.state === "FAILED" ? "einvoice-provider-failed" : "einvoice-requested", invoice.patientId);
}

export async function syncEInvoiceAction(formData: FormData) {
  const session = await requireViewSession("billing");
  guardInvoiceIssue(session);
  const invoice = await scopedInvoice(session, requiredString(formData.get("invoiceId")));

  if (!invoice || invoice.status === "VOID") {
    redirect(financeNotice("einvoice-invoice-unavailable"));
  }

  const current = await currentState(session, invoice.id);
  if (!canSafelySync(current)) {
    redirect(financeNotice("einvoice-sync-state-invalid"));
  }

  const adapter = resolveEInvoiceAdapter();
  const actorId = databaseActorId(session.userId);
  const claim = await guardedTransition({
    organizationId: session.organizationId,
    actorId,
    invoiceId: invoice.id,
    input: {
      state: "PENDING",
      operation: "SYNC",
      providerKey: current.providerKey ?? adapter.providerKey,
      externalInvoiceId: current.externalInvoiceId,
      lookupCode: current.lookupCode,
      replacementReference: current.replacementReference,
      amountSnapshot: Number(invoice.amount),
      invoiceStatusSnapshot: invoice.status,
      source: "provider",
    },
    allow: canSafelySync,
    validate: (tx) => invoiceStatusMatches(tx, session, invoice.id, false),
    notice: "einvoice-state-conflict",
  });

  const result = await adapter.sync(toProviderInvoice(session, invoice), {
    externalInvoiceId: current.externalInvoiceId,
    lookupCode: current.lookupCode,
    replacementReference: current.replacementReference,
  }).catch(() => ({
    state: "FAILED" as const,
    providerKey: adapter.providerKey,
    externalInvoiceId: current.externalInvoiceId,
    lookupCode: current.lookupCode,
    replacementReference: current.replacementReference,
    errorCode: "PROVIDER_SYNC_ERROR",
    errorMessage: "Không xác nhận được phản hồi đồng bộ từ nhà cung cấp HĐĐT.",
  }));

  await guardedTransition({
    organizationId: session.organizationId,
    actorId,
    invoiceId: invoice.id,
    input: {
      state: result.state,
      operation: "SYNC",
      providerKey: result.providerKey,
      externalInvoiceId: result.externalInvoiceId ?? current.externalInvoiceId,
      lookupCode: result.lookupCode ?? current.lookupCode,
      replacementReference: result.replacementReference ?? current.replacementReference,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      amountSnapshot: Number(invoice.amount),
      invoiceStatusSnapshot: invoice.status,
      source: "provider",
    },
    allow: (latest) =>
      latest.eventId === claim.eventId &&
      latest.state === "PENDING" &&
      latest.operation === "SYNC",
    notice: "einvoice-state-conflict",
  });

  finish(result.state === "FAILED" ? "einvoice-provider-failed" : "einvoice-synced", invoice.patientId);
}

export async function confirmExternalEInvoiceAction(formData: FormData) {
  const session = await requireViewSession("billing");
  guardInvoiceIssue(session);
  const invoice = await scopedInvoice(session, requiredString(formData.get("invoiceId")));
  const externalInvoiceId = boundedInput(formData.get("externalInvoiceId"), 180);
  const lookupCode = boundedInput(formData.get("lookupCode"), 180) || null;
  const providerKey = boundedInput(formData.get("providerKey"), 80) || "external-manual";

  if (!invoice || invoice.status === "VOID" || !externalInvoiceId) {
    redirect(financeNotice("einvoice-manual-missing"));
  }

  await assertExternalReferenceAvailable(session, invoice.id, providerKey, externalInvoiceId);

  await guardedTransition({
    organizationId: session.organizationId,
    actorId: databaseActorId(session.userId),
    invoiceId: invoice.id,
    input: {
      state: "ISSUED",
      operation: "MANUAL_RECONCILE",
      providerKey,
      externalInvoiceId,
      lookupCode,
      amountSnapshot: Number(invoice.amount),
      invoiceStatusSnapshot: invoice.status,
      source: "manual",
    },
    allow: (current) =>
      current.state === "NOT_REQUIRED" ||
      (current.state === "FAILED" &&
        (current.operation === "ISSUE" || current.operation === "SYNC")),
    lockKeys: [externalReferenceLockKey(session.organizationId, providerKey, externalInvoiceId)],
    validate: async (tx) =>
      (await invoiceStatusMatches(tx, session, invoice.id, false)) &&
      (await externalReferenceAvailableInTransaction(
        tx,
        session.organizationId,
        invoice.id,
        providerKey,
        externalInvoiceId,
      )),
    notice: "einvoice-state-conflict",
  });

  finish("einvoice-manual-issued", invoice.patientId);
}

export async function markEInvoiceNotRequiredAction(formData: FormData) {
  const session = await requireViewSession("billing");
  guardInvoiceIssue(session);
  const invoice = await scopedInvoice(session, requiredString(formData.get("invoiceId")));

  if (!invoice || invoice.status === "VOID") {
    redirect(financeNotice("einvoice-invoice-unavailable"));
  }

  await guardedTransition({
    organizationId: session.organizationId,
    actorId: databaseActorId(session.userId),
    invoiceId: invoice.id,
    input: {
      state: "NOT_REQUIRED",
      operation: "MANUAL_RECONCILE",
      amountSnapshot: Number(invoice.amount),
      invoiceStatusSnapshot: invoice.status,
      source: "manual",
    },
    allow: canSafelyMarkNotRequired,
    validate: (tx) => invoiceStatusMatches(tx, session, invoice.id, false),
    notice: "einvoice-issued-cannot-ignore",
  });

  finish("einvoice-not-required", invoice.patientId);
}

export async function confirmExternalEInvoiceCancellationAction(formData: FormData) {
  const session = await requireViewSession("billing");
  if (!canPerformAction(session, "billing.invoice.void")) {
    redirect(financeNotice("einvoice-denied"));
  }
  const invoice = await scopedInvoice(session, requiredString(formData.get("invoiceId")));

  if (!invoice || invoice.status !== "VOID") {
    redirect(financeNotice("einvoice-cancel-requires-void"));
  }

  const current = await currentState(session, invoice.id);
  await guardedTransition({
    organizationId: session.organizationId,
    actorId: databaseActorId(session.userId),
    invoiceId: invoice.id,
    input: {
      state: "CANCELLED",
      operation: "CANCEL",
      providerKey: current.providerKey ?? "external-manual",
      externalInvoiceId: current.externalInvoiceId,
      lookupCode: current.lookupCode,
      replacementReference: current.replacementReference,
      amountSnapshot: Number(invoice.amount),
      invoiceStatusSnapshot: invoice.status,
      source: "manual",
    },
    allow: (latest) => latest.state === "ISSUED" || latest.state === "REPLACED",
    validate: (tx) => invoiceStatusMatches(tx, session, invoice.id, true),
    notice: "einvoice-cancel-state-invalid",
  });

  finish("einvoice-cancelled", invoice.patientId);
}

export async function confirmExternalEInvoiceReplacementAction(formData: FormData) {
  const session = await requireViewSession("billing");
  guardInvoiceIssue(session);
  const invoice = await scopedInvoice(session, requiredString(formData.get("invoiceId")));
  const replacementReference = boundedInput(formData.get("replacementReference"), 180);
  const externalInvoiceId = boundedInput(formData.get("externalInvoiceId"), 180);
  const lookupCode = boundedInput(formData.get("lookupCode"), 180) || null;

  if (!invoice || invoice.status === "VOID" || !replacementReference || !externalInvoiceId) {
    redirect(financeNotice("einvoice-replacement-missing"));
  }

  const current = await currentState(session, invoice.id);
  const providerKey = current.providerKey ?? "external-manual";
  await assertExternalReferenceAvailable(session, invoice.id, providerKey, externalInvoiceId);

  await guardedTransition({
    organizationId: session.organizationId,
    actorId: databaseActorId(session.userId),
    invoiceId: invoice.id,
    input: {
      state: "REPLACED",
      operation: "REPLACE",
      providerKey,
      externalInvoiceId,
      lookupCode,
      replacementReference,
      amountSnapshot: Number(invoice.amount),
      invoiceStatusSnapshot: invoice.status,
      source: "manual",
    },
    allow: (latest) =>
      (latest.state === "ISSUED" || latest.state === "REPLACED") &&
      latest.externalInvoiceId !== externalInvoiceId,
    lockKeys: [externalReferenceLockKey(session.organizationId, providerKey, externalInvoiceId)],
    validate: async (tx) =>
      (await invoiceStatusMatches(tx, session, invoice.id, false)) &&
      (await externalReferenceAvailableInTransaction(
        tx,
        session.organizationId,
        invoice.id,
        providerKey,
        externalInvoiceId,
      )),
    notice: "einvoice-replacement-state-invalid",
  });

  finish("einvoice-replaced", invoice.patientId);
}

function guardInvoiceIssue(session: AppSession) {
  if (!canPerformAction(session, "billing.invoice.issue")) {
    redirect(financeNotice("einvoice-denied"));
  }
}

function canSafelyRequestIssue(state: EInvoiceStateSnapshot) {
  return state.state === "NOT_REQUIRED";
}

function canSafelySync(state: EInvoiceStateSnapshot) {
  if (state.state === "FAILED") return true;
  return (
    state.state === "PENDING" &&
    state.updatedAtMs != null &&
    Date.now() - state.updatedAtMs >= pendingSyncMinAgeMs
  );
}

function canSafelyMarkNotRequired(state: EInvoiceStateSnapshot) {
  return (
    (state.state === "NOT_REQUIRED" && state.eventId === null) ||
    (state.state === "FAILED" && state.errorCode === "PROVIDER_NOT_CONFIGURED")
  );
}

async function guardedTransition({
  organizationId,
  actorId,
  invoiceId,
  input,
  allow,
  lockKeys,
  validate,
  notice,
}: Parameters<typeof transitionEInvoiceState>[0] & { notice: string }) {
  try {
    return await transitionEInvoiceState({
      organizationId,
      actorId,
      invoiceId,
      input,
      allow,
      lockKeys,
      validate,
    });
  } catch (error) {
    if (error instanceof EInvoiceTransitionError) {
      redirect(financeNotice(notice));
    }
    throw error;
  }
}

async function currentState(session: AppSession, invoiceId: string): Promise<EInvoiceStateSnapshot> {
  const states = await loadEInvoiceStates(session, [invoiceId]);
  return states.get(invoiceId) ?? emptyEInvoiceState(invoiceId);
}

async function assertExternalReferenceAvailable(
  session: AppSession,
  invoiceId: string,
  providerKey: string,
  externalInvoiceId: string,
) {
  const events = await prisma.auditLog.findMany({
    where: {
      organizationId: session.organizationId,
      entityType: "Invoice",
      entityId: { not: invoiceId },
      action: { in: ["einvoice.issued", "einvoice.replaced"] },
    },
    select: { metadata: true },
    take: 5000,
  });

  if (hasExternalReference(events, providerKey, externalInvoiceId)) {
    redirect(financeNotice("einvoice-external-duplicate"));
  }
}

async function externalReferenceAvailableInTransaction(
  tx: Prisma.TransactionClient,
  organizationId: string,
  invoiceId: string,
  providerKey: string,
  externalInvoiceId: string,
) {
  const events = await tx.auditLog.findMany({
    where: {
      organizationId,
      entityType: "Invoice",
      entityId: { not: invoiceId },
      action: { in: ["einvoice.issued", "einvoice.replaced"] },
    },
    select: { metadata: true },
    take: 5000,
  });

  return !hasExternalReference(events, providerKey, externalInvoiceId);
}

function hasExternalReference(
  events: Array<{ metadata: Prisma.JsonValue | null }>,
  providerKey: string,
  externalInvoiceId: string,
) {
  return events.some((event) => {
    if (!event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) {
      return false;
    }
    const metadata = event.metadata as Record<string, unknown>;
    return (
      String(metadata.providerKey ?? "") === providerKey &&
      String(metadata.externalInvoiceId ?? "") === externalInvoiceId
    );
  });
}

function externalReferenceLockKey(
  organizationId: string,
  providerKey: string,
  externalInvoiceId: string,
) {
  return `einvoice:external:${organizationId}:${providerKey}:${externalInvoiceId}`;
}

async function invoiceStatusMatches(
  tx: Prisma.TransactionClient,
  session: AppSession,
  invoiceId: string,
  requireVoid: boolean,
) {
  const invoice = await tx.invoice.findFirst({
    where: {
      id: invoiceId,
      organizationId: session.organizationId,
      clinicId: { in: allowedClinicIds(session) },
      status: requireVoid ? "VOID" : { not: "VOID" },
    },
    select: { id: true },
  });
  return Boolean(invoice);
}

async function scopedInvoice(session: AppSession, invoiceId: string) {
  if (!invoiceId) return null;

  return prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      organizationId: session.organizationId,
      clinicId: { in: allowedClinicIds(session) },
    },
    include: {
      organization: { select: { taxCode: true } },
      clinic: { select: { name: true } },
      patient: { select: { id: true, fullName: true } },
    },
  });
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) return session.clinicIds;
  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function boundedInput(value: FormDataEntryValue | null, maxLength: number) {
  return requiredString(value).slice(0, maxLength);
}

function toProviderInvoice(
  session: AppSession,
  invoice: NonNullable<Awaited<ReturnType<typeof scopedInvoice>>>,
): EInvoiceProviderInvoice {
  return {
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    organizationName: session.organizationName,
    organizationTaxCode: invoice.organization.taxCode,
    clinicName: invoice.clinic.name,
    patientName: invoice.patient.fullName,
    amount: Number(invoice.amount),
    localStatus: invoice.status,
  };
}

function finish(notice: string, patientId: string) {
  revalidatePath("/operations/finance");
  revalidatePath("/work");
  revalidatePath("/billing");
  revalidatePath(`/patients/${patientId}`);
  redirect(financeNotice(notice));
}

function financeNotice(notice: string) {
  return `/operations/finance?notice=${encodeURIComponent(notice)}`;
}
