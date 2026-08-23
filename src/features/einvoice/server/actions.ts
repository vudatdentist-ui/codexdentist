"use server";

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
  appendEInvoiceEvent,
  emptyEInvoiceState,
  loadEInvoiceStates,
  type EInvoiceStateSnapshot,
} from "./state";

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

  await appendEInvoiceEvent({
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
  });

  const result = await adapter.issue(toProviderInvoice(session, invoice));

  await appendEInvoiceEvent({
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
  if (current.state !== "PENDING" && current.state !== "FAILED") {
    redirect(financeNotice("einvoice-sync-state-invalid"));
  }

  const adapter = resolveEInvoiceAdapter();
  const result = await adapter.sync(toProviderInvoice(session, invoice), {
    externalInvoiceId: current.externalInvoiceId,
    lookupCode: current.lookupCode,
  });

  await appendEInvoiceEvent({
    organizationId: session.organizationId,
    actorId: databaseActorId(session.userId),
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
  });

  finish(result.state === "FAILED" ? "einvoice-provider-failed" : "einvoice-synced", invoice.patientId);
}

export async function confirmExternalEInvoiceAction(formData: FormData) {
  const session = await requireViewSession("billing");
  guardInvoiceIssue(session);
  const invoice = await scopedInvoice(session, requiredString(formData.get("invoiceId")));
  const externalInvoiceId = requiredString(formData.get("externalInvoiceId"));
  const lookupCode = requiredString(formData.get("lookupCode")) || null;
  const providerKey = requiredString(formData.get("providerKey")) || "external-manual";

  if (!invoice || invoice.status === "VOID" || !externalInvoiceId) {
    redirect(financeNotice("einvoice-manual-missing"));
  }

  const current = await currentState(session, invoice.id);
  if (
    current.state === "ISSUED" ||
    current.state === "REPLACED" ||
    current.state === "CANCELLED"
  ) {
    redirect(financeNotice("einvoice-manual-state-invalid"));
  }

  await appendEInvoiceEvent({
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

  const current = await currentState(session, invoice.id);
  if (!canSafelyMarkNotRequired(current)) {
    redirect(financeNotice("einvoice-issued-cannot-ignore"));
  }

  await appendEInvoiceEvent({
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
  if (current.state !== "ISSUED" && current.state !== "REPLACED") {
    redirect(financeNotice("einvoice-cancel-state-invalid"));
  }

  await appendEInvoiceEvent({
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
  });

  finish("einvoice-cancelled", invoice.patientId);
}

export async function confirmExternalEInvoiceReplacementAction(formData: FormData) {
  const session = await requireViewSession("billing");
  guardInvoiceIssue(session);
  const invoice = await scopedInvoice(session, requiredString(formData.get("invoiceId")));
  const replacementReference = requiredString(formData.get("replacementReference"));
  const externalInvoiceId = requiredString(formData.get("externalInvoiceId"));
  const lookupCode = requiredString(formData.get("lookupCode")) || null;

  if (!invoice || invoice.status === "VOID" || !replacementReference || !externalInvoiceId) {
    redirect(financeNotice("einvoice-replacement-missing"));
  }

  const current = await currentState(session, invoice.id);
  if (current.state !== "ISSUED" && current.state !== "REPLACED") {
    redirect(financeNotice("einvoice-replacement-state-invalid"));
  }

  await appendEInvoiceEvent({
    organizationId: session.organizationId,
    actorId: databaseActorId(session.userId),
    invoiceId: invoice.id,
    input: {
      state: "REPLACED",
      operation: "REPLACE",
      providerKey: current.providerKey ?? "external-manual",
      externalInvoiceId,
      lookupCode,
      replacementReference,
      amountSnapshot: Number(invoice.amount),
      invoiceStatusSnapshot: invoice.status,
      source: "manual",
    },
  });

  finish("einvoice-replaced", invoice.patientId);
}

function guardInvoiceIssue(session: AppSession) {
  if (!canPerformAction(session, "billing.invoice.issue")) {
    redirect(financeNotice("einvoice-denied"));
  }
}

function canSafelyRequestIssue(state: EInvoiceStateSnapshot) {
  return (
    state.state === "NOT_REQUIRED" ||
    (state.state === "FAILED" && state.errorCode === "PROVIDER_NOT_CONFIGURED")
  );
}

function canSafelyMarkNotRequired(state: EInvoiceStateSnapshot) {
  return (
    state.state === "NOT_REQUIRED" ||
    (state.state === "FAILED" && state.errorCode === "PROVIDER_NOT_CONFIGURED")
  );
}

async function currentState(session: AppSession, invoiceId: string): Promise<EInvoiceStateSnapshot> {
  const states = await loadEInvoiceStates(session, [invoiceId]);
  return states.get(invoiceId) ?? emptyEInvoiceState(invoiceId);
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
