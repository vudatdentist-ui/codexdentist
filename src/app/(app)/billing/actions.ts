"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { applicationErrorCode } from "@/lib/application/errors";
import {
  adjustInvoiceAmountCommand,
  createInvoiceCommand,
  createPaymentPlanCommand,
  createPaymentPlanReminderCommand,
  issueServiceInvoiceCommand,
  recordInvoicePaymentCommand,
  recordInvoiceRefundCommand,
  recordPatientReceiptCommand,
  recordServiceCollectionCommand,
  voidInvoiceCommand,
  type ReceiptMethod,
} from "@/lib/application/revenue/commands";
import {
  optionalString,
  parseEndOfDateInVietnam,
  parseMoney,
  requiredString,
} from "@/lib/form-validation";

const receiptMethods = new Set<ReceiptMethod>([
  "cash",
  "card",
  "bank_transfer",
  "credit_balance",
]);

export async function createInvoiceAction(formData: FormData) {
  const session = await requireViewSession("billing");
  const patientId = requiredString(formData.get("patientId"));
  const amount = parseMoney(formData.get("amount"));
  const dueDate = parseEndOfDateInVietnam(
    formData.get("dueDate"),
    () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  );

  if (!patientId || amount === null) redirect("/billing?notice=billing-missing");
  if (dueDate === "invalid") redirect("/billing?notice=billing-bad-date");

  try {
    await createInvoiceCommand(session, { patientId, amount, dueDate });
  } catch (error) {
    redirect(`/billing?notice=${applicationErrorCode(error, "billing-database")}`);
  }

  revalidatePath("/billing");
  redirect("/billing?notice=billing-created");
}

export async function recordPaymentAction(formData: FormData) {
  const session = await requireViewSession("billing");
  const invoiceNo = requiredString(formData.get("invoiceNo"));
  const amount = parseMoney(formData.get("amount"));
  const method = requiredString(formData.get("method")) || "cash";

  if (!invoiceNo || amount === null || amount <= 0) {
    redirect("/billing?notice=billing-bad-payment");
  }

  try {
    await recordInvoicePaymentCommand(session, { invoiceNo, amount, method });
  } catch (error) {
    redirect(`/billing?notice=${applicationErrorCode(error, "billing-database")}`);
  }

  revalidatePath("/billing");
  redirect("/billing?notice=billing-payment-recorded");
}

export async function recordServiceReceiptAction(formData: FormData) {
  await recordServiceCollectionAction(formData, false);
}

export async function recordServiceReceiptAndInvoiceAction(formData: FormData) {
  await recordServiceCollectionAction(formData, true);
}

export async function recordPatientReceiptAction(formData: FormData) {
  const session = await requireViewSession("billing");
  const patientId = requiredString(formData.get("patientId"));
  const amount = parseMoney(formData.get("amount"));
  const rawMethod = requiredString(formData.get("method")) || "cash";
  const method = rawMethod === "card" || rawMethod === "bank_transfer" ? rawMethod : "cash";
  const reference = optionalString(formData.get("reference"));
  const note = optionalString(formData.get("note"));

  if (!patientId || amount === null || amount <= 0) {
    redirect(billingNoticeUrl("billing-bad-payment", patientId));
  }

  try {
    await recordPatientReceiptCommand(session, {
      patientId,
      amount,
      method,
      reference,
      note,
    });
  } catch (error) {
    redirect(billingNoticeUrl(applicationErrorCode(error, "billing-database"), patientId));
  }

  revalidateBillingViews();
  redirect(billingNoticeUrl("billing-payment-recorded", patientId));
}

export async function issueServiceInvoiceAction(formData: FormData) {
  const session = await requireViewSession("billing");
  const treatmentServiceId = requiredString(formData.get("treatmentServiceId"));
  if (!treatmentServiceId) redirect("/billing?notice=billing-service-not-found");

  let patientId: string | null = null;
  try {
    const result = await issueServiceInvoiceCommand(session, treatmentServiceId);
    patientId = result.patientId;
  } catch (error) {
    redirect(billingNoticeUrl(applicationErrorCode(error, "billing-database"), patientId));
  }

  revalidateBillingViews();
  redirect(billingNoticeUrl("billing-service-invoice-issued", patientId));
}

export async function voidInvoiceAction(formData: FormData) {
  const session = await requireViewSession("billing");
  const invoiceNo = requiredString(formData.get("invoiceNo"));
  if (!invoiceNo) redirect("/billing?notice=billing-invoice-not-found");

  try {
    await voidInvoiceCommand(session, invoiceNo);
  } catch (error) {
    redirect(`/billing?notice=${applicationErrorCode(error, "billing-database")}`);
  }

  revalidatePath("/billing");
  redirect("/billing?notice=billing-voided");
}

export async function adjustInvoiceAmountAction(formData: FormData) {
  const session = await requireViewSession("billing");
  const invoiceNo = requiredString(formData.get("invoiceNo"));
  const amount = parseMoney(formData.get("amount"));
  const reason = optionalString(formData.get("reason"));
  if (!invoiceNo || amount === null || amount <= 0) {
    redirect("/billing?notice=billing-missing");
  }

  try {
    await adjustInvoiceAmountCommand(session, { invoiceNo, amount, reason });
  } catch (error) {
    redirect(`/billing?notice=${applicationErrorCode(error, "billing-database")}`);
  }

  revalidateBillingViews();
  redirect("/billing?notice=billing-adjusted");
}

export async function recordInvoiceRefundAction(formData: FormData) {
  const session = await requireViewSession("billing");
  const invoiceNo = requiredString(formData.get("invoiceNo"));
  const amount = parseMoney(formData.get("amount"));
  const method = requiredString(formData.get("method")) || "cash";
  const reference = optionalString(formData.get("reference"));
  if (!invoiceNo || amount === null || amount <= 0) {
    redirect("/billing?notice=billing-bad-payment");
  }

  try {
    await recordInvoiceRefundCommand(session, { invoiceNo, amount, method, reference });
  } catch (error) {
    redirect(`/billing?notice=${applicationErrorCode(error, "billing-database")}`);
  }

  revalidateBillingViews();
  redirect("/billing?notice=billing-refund-recorded");
}

export async function createPaymentPlanReminderAction(formData: FormData) {
  const session = await requireViewSession("billing");
  const patientId = requiredString(formData.get("patientId"));
  const amount = parseMoney(formData.get("amount"));
  const scheduledAt = parseEndOfDateInVietnam(formData.get("scheduledAt"), () => new Date());
  const note = optionalString(formData.get("note"));

  if (!patientId || amount === null || amount <= 0 || scheduledAt === "invalid") {
    redirect("/billing?notice=billing-plan-missing");
  }

  try {
    await createPaymentPlanReminderCommand(session, { patientId, amount, scheduledAt, note });
  } catch (error) {
    redirect(`/billing?notice=${applicationErrorCode(error, "billing-database")}`);
  }

  revalidateBillingViews();
  revalidatePath("/dashboard");
  redirect("/billing?notice=billing-plan-created");
}

export async function createPaymentPlanAction(formData: FormData) {
  const session = await requireViewSession("billing");
  const patientId = requiredString(formData.get("patientId"));
  const totalAmount = parseMoney(formData.get("amount"));
  const installmentCount = Math.max(Number(formData.get("installmentCount") ?? 0), 0);
  const intervalDays = Math.max(Number(formData.get("intervalDays") ?? 30), 1);
  const firstDueAt = parseEndOfDateInVietnam(formData.get("firstDueAt"), () => new Date());
  const note = optionalString(formData.get("note"));

  if (
    !patientId ||
    totalAmount === null ||
    totalAmount <= 0 ||
    !Number.isFinite(installmentCount) ||
    installmentCount < 1 ||
    installmentCount > 24 ||
    firstDueAt === "invalid"
  ) {
    redirect("/billing?notice=billing-plan-missing");
  }

  try {
    await createPaymentPlanCommand(session, {
      patientId,
      totalAmount,
      installmentCount,
      intervalDays,
      firstDueAt,
      note,
    });
  } catch (error) {
    redirect(`/billing?notice=${applicationErrorCode(error, "billing-database")}`);
  }

  revalidateBillingViews();
  revalidatePath("/dashboard");
  redirect("/billing?notice=billing-plan-created");
}

async function recordServiceCollectionAction(formData: FormData, issueInvoice: boolean) {
  const session = await requireViewSession("billing");
  const treatmentServiceId = requiredString(formData.get("treatmentServiceId"));
  const amount = parseMoney(formData.get("amount"));
  const rawMethod = requiredString(formData.get("method")) || "cash";
  const method = receiptMethods.has(rawMethod as ReceiptMethod) ? (rawMethod as ReceiptMethod) : "cash";
  const reference = optionalString(formData.get("reference"));

  if (!treatmentServiceId) redirect("/billing?notice=billing-service-not-found");
  if (method !== "credit_balance" && (amount === null || amount <= 0)) {
    redirect("/billing?notice=billing-bad-payment");
  }

  let patientId: string | null = null;
  let createdInvoice = false;
  try {
    const result = await recordServiceCollectionCommand(session, {
      treatmentServiceId,
      amount,
      method,
      reference,
      issueInvoice,
    });
    patientId = result.patientId;
    createdInvoice = result.createdInvoice;
  } catch (error) {
    redirect(billingNoticeUrl(applicationErrorCode(error, "billing-database"), patientId));
  }

  revalidateBillingViews();
  redirect(
    billingNoticeUrl(
      createdInvoice ? "billing-service-receipt-invoiced" : "billing-service-receipt-recorded",
      patientId,
    ),
  );
}

function revalidateBillingViews() {
  revalidatePath("/billing");
  revalidatePath("/journey");
}

function billingNoticeUrl(notice: string, patientId?: string | null) {
  const params = new URLSearchParams({ notice });
  if (patientId) params.set("patientId", patientId);
  return `/billing?${params.toString()}`;
}
