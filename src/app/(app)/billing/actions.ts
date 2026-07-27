"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import { nextDocumentNo } from "@/lib/document-sequence";
import {
  databaseActorId,
  optionalString,
  parseEndOfDateInVietnam,
  parseMoney,
  requiredString,
} from "@/lib/form-validation";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { runSerializableTransaction } from "@/lib/transaction";

const receiptMethods = new Set([
  "cash",
  "card",
  "bank_transfer",
  "credit_balance",
]);

export async function createInvoiceAction(formData: FormData) {
  const session = await requireViewSession("billing");

  if (!canPerformAction(session, "billing.invoice.create")) {
    redirect("/billing?notice=billing-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const amount = parseMoney(formData.get("amount"));
  const dueDate = parseEndOfDateInVietnam(
    formData.get("dueDate"),
    () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  );

  if (!patientId || amount === null) {
    redirect("/billing?notice=billing-missing");
  }

  if (dueDate === "invalid") {
    redirect("/billing?notice=billing-bad-date");
  }

  let notice: string | null = null;

  try {
    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        organizationId: session.organizationId,
        clinicId: {
          in: session.clinicIds,
        },
      },
      select: {
        id: true,
        clinicId: true,
      },
    });

    if (!patient) {
      notice = "billing-patient-not-found";
    } else {
      await runSerializableTransaction(async (tx) => {
        const invoiceNo = await nextInvoiceNo(session.organizationId, tx);
        const invoice = await tx.invoice.create({
          data: {
            organizationId: session.organizationId,
            clinicId: patient.clinicId,
            patientId,
            invoiceNo,
            status: "OPEN",
            amount,
            paidAmount: 0,
            dueDate,
          },
          select: {
            id: true,
            invoiceNo: true,
          },
        });

        await tx.invoiceItem.create({
          data: {
            organizationId: session.organizationId,
            clinicId: patient.clinicId,
            patientId,
            invoiceId: invoice.id,
            treatmentServiceId: null,
            description: "Manual patient invoice",
            quantity: 1,
            unitPrice: amount,
            amount,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "invoice.created",
            entityType: "Invoice",
            entityId: invoice.id,
            metadata: {
              invoiceNo: invoice.invoiceNo,
              patientId,
              amount,
              source: "manual",
            } as Prisma.InputJsonValue,
          },
        });
      });
    }
  } catch {
    notice = "billing-database";
  }

  if (notice) {
    redirect(`/billing?notice=${notice}`);
  }

  revalidatePath("/billing");
  redirect("/billing?notice=billing-created");
}

export async function recordPaymentAction(formData: FormData) {
  const session = await requireViewSession("billing");

  if (!canPerformAction(session, "billing.payment.record")) {
    redirect("/billing?notice=billing-denied");
  }

  const invoiceNo = requiredString(formData.get("invoiceNo"));
  const amount = parseMoney(formData.get("amount"));
  const method = requiredString(formData.get("method")) || "cash";

  if (!invoiceNo || amount === null || amount <= 0) {
    redirect("/billing?notice=billing-bad-payment");
  }

  let notice: string | null = null;

  try {
    await runSerializableTransaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          invoiceNo,
          clinicId: {
            in: session.clinicIds,
          },
          patient: {
            organizationId: session.organizationId,
          },
        },
        select: {
          id: true,
          amount: true,
          clinicId: true,
          patientId: true,
          paidAmount: true,
          status: true,
        },
      });

      if (!invoice || invoice.status === "VOID") {
        throw new BillingActionError("billing-invoice-not-found");
      }

      const invoiceBalance = Math.max(
        Number(invoice.amount) - Number(invoice.paidAmount),
        0,
      );
      const allocatedAmount = Math.min(amount, invoiceBalance);
      const unallocatedAmount = Math.max(amount - allocatedAmount, 0);
      const nextPaid = Math.min(
        Number(invoice.paidAmount) + allocatedAmount,
        Number(invoice.amount),
      );
      const nextStatus =
        nextPaid >= Number(invoice.amount) ? "PAID" : "PARTIAL";

      const receiptNo = await nextReceiptNo(session.organizationId, tx);
      const receipt = await tx.receipt.create({
        data: {
          organizationId: session.organizationId,
          clinicId: invoice.clinicId,
          patientId: invoice.patientId,
          receiptNo,
          amount,
          allocatedAmount,
          unallocatedAmount,
          method,
          reference: invoiceNo,
          note: "Invoice payment",
        },
        select: {
          id: true,
          receiptNo: true,
        },
      });

      if (allocatedAmount > 0) {
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            amount: allocatedAmount,
            method,
            reference: receipt.receiptNo,
          },
        });
        await tx.receiptAllocation.create({
          data: {
            organizationId: session.organizationId,
            clinicId: invoice.clinicId,
            patientId: invoice.patientId,
            receiptId: receipt.id,
            invoiceId: invoice.id,
            amount: allocatedAmount,
            note: "Invoice payment",
          },
        });
      }

      if (unallocatedAmount > 0) {
        await tx.patientCreditBalance.upsert({
          where: {
            patientId: invoice.patientId,
          },
          update: {
            clinicId: invoice.clinicId,
            amount: {
              increment: unallocatedAmount,
            },
          },
          create: {
            organizationId: session.organizationId,
            clinicId: invoice.clinicId,
            patientId: invoice.patientId,
            amount: unallocatedAmount,
          },
        });
      }

      await tx.invoice.update({
        where: {
          id: invoice.id,
        },
        data: {
          paidAmount: nextPaid,
          status: nextStatus,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "invoice.receipt_recorded",
          entityType: "Receipt",
          entityId: receipt.id,
          metadata: {
            invoiceNo,
            receiptNo: receipt.receiptNo,
            amount,
            allocatedAmount,
            unallocatedAmount,
            method,
            paidAmount: nextPaid,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    notice =
      error instanceof BillingActionError ? error.notice : "billing-database";
  }

  if (notice) {
    redirect(`/billing?notice=${notice}`);
  }

  revalidatePath("/billing");
  redirect("/billing?notice=billing-payment-recorded");
}

export async function recordServiceReceiptAction(formData: FormData) {
  await recordServiceCollection(formData, false);
}

export async function recordServiceReceiptAndInvoiceAction(formData: FormData) {
  await recordServiceCollection(formData, true);
}

export async function recordPatientReceiptAction(formData: FormData) {
  const session = await requireViewSession("billing");

  if (!canPerformAction(session, "billing.receipt.record")) {
    redirect("/billing?notice=billing-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const amount = parseMoney(formData.get("amount"));
  const rawMethod = requiredString(formData.get("method")) || "cash";
  const method =
    rawMethod === "cash" ||
    rawMethod === "card" ||
    rawMethod === "bank_transfer"
      ? rawMethod
      : "cash";
  const reference = optionalString(formData.get("reference"));
  const note = optionalString(formData.get("note"));

  if (!patientId || amount === null || amount <= 0) {
    redirect(billingNoticeUrl("billing-bad-payment", patientId));
  }

  let notice: string | null = null;

  try {
    await runSerializableTransaction(async (tx) => {
      const patient = await tx.patient.findFirst({
        where: {
          id: patientId,
          organizationId: session.organizationId,
          clinicId: {
            in: session.clinicIds,
          },
        },
        select: {
          id: true,
          clinicId: true,
        },
      });

      if (!patient) {
        throw new BillingActionError("billing-patient-not-found");
      }

      const receiptNo = await nextReceiptNo(session.organizationId, tx);
      const receipt = await tx.receipt.create({
        data: {
          organizationId: session.organizationId,
          clinicId: patient.clinicId,
          patientId: patient.id,
          receiptNo,
          amount,
          allocatedAmount: 0,
          unallocatedAmount: amount,
          method,
          reference,
          note: note || "Patient receipt to balance",
        },
        select: {
          id: true,
          receiptNo: true,
        },
      });

      await tx.patientCreditBalance.upsert({
        where: {
          patientId: patient.id,
        },
        update: {
          clinicId: patient.clinicId,
          amount: {
            increment: amount,
          },
        },
        create: {
          organizationId: session.organizationId,
          clinicId: patient.clinicId,
          patientId: patient.id,
          amount,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "patient.receipt_recorded_to_balance",
          entityType: "Receipt",
          entityId: receipt.id,
          metadata: {
            patientId: patient.id,
            receiptNo: receipt.receiptNo,
            amount,
            method,
            reference,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    notice =
      error instanceof BillingActionError ? error.notice : "billing-database";
  }

  if (notice) {
    redirect(billingNoticeUrl(notice, patientId));
  }

  revalidateBillingViews();
  redirect(billingNoticeUrl("billing-payment-recorded", patientId));
}

export async function issueServiceInvoiceAction(formData: FormData) {
  const session = await requireViewSession("billing");

  if (!canPerformAction(session, "billing.invoice.issue")) {
    redirect("/billing?notice=billing-denied");
  }

  const treatmentServiceId = requiredString(formData.get("treatmentServiceId"));

  if (!treatmentServiceId) {
    redirect("/billing?notice=billing-service-not-found");
  }

  let notice: string | null = null;
  let redirectPatientId: string | null = null;

  try {
    await runSerializableTransaction(async (tx) => {
      const service = await findScopedTreatmentService(
        tx,
        session,
        treatmentServiceId,
      );

      if (!service) {
        throw new BillingActionError("billing-service-not-found");
      }
      redirectPatientId = service.patientId;

      const snapshot = treatmentServiceBillingSnapshot(service);
      const invoiceAmount = Math.min(
        snapshot.uninvoicedAllocatedAmount,
        snapshot.remainingInvoiceAmount,
      );

      if (invoiceAmount <= 0) {
        throw new BillingActionError("billing-no-invoiceable-amount");
      }

      const invoiceNo = await nextInvoiceNo(session.organizationId, tx);
      const invoice = await tx.invoice.create({
        data: {
          organizationId: session.organizationId,
          clinicId: service.clinicId,
          patientId: service.patientId,
          invoiceNo,
          status: "PAID",
          amount: invoiceAmount,
          paidAmount: invoiceAmount,
          dueDate: new Date(),
        },
        select: {
          id: true,
          invoiceNo: true,
        },
      });
      const invoiceItem = await tx.invoiceItem.create({
        data: {
          organizationId: session.organizationId,
          clinicId: service.clinicId,
          patientId: service.patientId,
          invoiceId: invoice.id,
          treatmentServiceId: service.id,
          description: serviceInvoiceDescription(service),
          quantity: 1,
          unitPrice: invoiceAmount,
          amount: invoiceAmount,
        },
        select: {
          id: true,
        },
      });
      const unlinkedAllocationIds = service.receiptAllocations
        .filter((allocation) => !allocation.invoiceId)
        .map((allocation) => allocation.id);

      if (unlinkedAllocationIds.length > 0) {
        await tx.receiptAllocation.updateMany({
          where: {
            id: {
              in: unlinkedAllocationIds,
            },
          },
          data: {
            invoiceId: invoice.id,
            invoiceItemId: invoiceItem.id,
          },
        });
      }

      await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: invoiceAmount,
          method: "service_receipt",
          reference: service.serviceCode,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "service.invoice_issued",
          entityType: "Invoice",
          entityId: invoice.id,
          metadata: {
            invoiceNo: invoice.invoiceNo,
            treatmentServiceId: service.id,
            serviceCode: service.serviceCode,
            amount: invoiceAmount,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    notice =
      error instanceof BillingActionError ? error.notice : "billing-database";
  }

  if (notice) {
    redirect(billingNoticeUrl(notice, redirectPatientId));
  }

  revalidateBillingViews();
  redirect(
    billingNoticeUrl("billing-service-invoice-issued", redirectPatientId),
  );
}

export async function voidInvoiceAction(formData: FormData) {
  const session = await requireViewSession("billing");

  if (!canPerformAction(session, "billing.invoice.void")) {
    redirect("/billing?notice=billing-denied");
  }

  const invoiceNo = requiredString(formData.get("invoiceNo"));

  if (!invoiceNo) {
    redirect("/billing?notice=billing-invoice-not-found");
  }

  let notice: string | null = null;

  try {
    await runSerializableTransaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          invoiceNo,
          organizationId: session.organizationId,
          clinicId: {
            in: session.clinicIds,
          },
          patient: {
            organizationId: session.organizationId,
          },
        },
        select: {
          id: true,
          clinicId: true,
          patientId: true,
        },
      });

      if (!invoice) {
        throw new BillingActionError("billing-invoice-not-found");
      }

      const allocations = await tx.receiptAllocation.findMany({
          where: {
            invoiceId: invoice.id,
          },
          select: {
            id: true,
            receiptId: true,
            treatmentServiceId: true,
            amount: true,
          },
        });
        const serviceAllocationIds = allocations
          .filter((allocation) => allocation.treatmentServiceId)
          .map((allocation) => allocation.id);
        const directAllocations = allocations.filter(
          (allocation) => !allocation.treatmentServiceId,
        );
        const directReleasedAmount = sumMoney(directAllocations);

        await tx.invoice.update({
          where: {
            id: invoice.id,
          },
          data: {
            status: "VOID",
          },
        });

        if (serviceAllocationIds.length > 0) {
          await tx.receiptAllocation.updateMany({
            where: {
              id: {
                in: serviceAllocationIds,
              },
            },
            data: {
              invoiceId: null,
              invoiceItemId: null,
            },
          });
        }

        for (const allocation of directAllocations) {
          const amount = Number(allocation.amount);

          await tx.receipt.update({
            where: {
              id: allocation.receiptId,
            },
            data: {
              allocatedAmount: {
                decrement: amount,
              },
              unallocatedAmount: {
                increment: amount,
              },
            },
          });
        }

        if (directAllocations.length > 0) {
          await tx.receiptAllocation.deleteMany({
            where: {
              id: {
                in: directAllocations.map((allocation) => allocation.id),
              },
            },
          });
        }

        if (directReleasedAmount > 0) {
          await tx.patientCreditBalance.upsert({
            where: {
              patientId: invoice.patientId,
            },
            update: {
              clinicId: invoice.clinicId,
              amount: {
                increment: directReleasedAmount,
              },
            },
            create: {
              organizationId: session.organizationId,
              clinicId: invoice.clinicId,
              patientId: invoice.patientId,
              amount: directReleasedAmount,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "invoice.voided",
            entityType: "Invoice",
            entityId: invoice.id,
            metadata: {
              invoiceNo,
              serviceAllocationsReleased: serviceAllocationIds.length,
              directReceiptAmountReleased: directReleasedAmount,
            } as Prisma.InputJsonValue,
          },
        });
    });
  } catch (error) {
    notice =
      error instanceof BillingActionError ? error.notice : "billing-database";
  }

  if (notice) {
    redirect(`/billing?notice=${notice}`);
  }

  revalidatePath("/billing");
  redirect("/billing?notice=billing-voided");
}

export async function adjustInvoiceAmountAction(formData: FormData) {
  const session = await requireViewSession("billing");

  if (!canPerformAction(session, "billing.invoice.void")) {
    redirect("/billing?notice=billing-denied");
  }

  const invoiceNo = requiredString(formData.get("invoiceNo"));
  const amount = parseMoney(formData.get("amount"));
  const reason = optionalString(formData.get("reason"));

  if (!invoiceNo || amount === null || amount <= 0) {
    redirect("/billing?notice=billing-missing");
  }

  let notice: string | null = null;

  try {
    await runSerializableTransaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          invoiceNo,
          clinicId: {
            in: session.clinicIds,
          },
          patient: {
            organizationId: session.organizationId,
          },
        },
        include: {
          items: {
            orderBy: {
              createdAt: "asc",
            },
            take: 1,
          },
        },
      });

      if (!invoice || invoice.status === "VOID") {
        throw new BillingActionError("billing-invoice-not-found");
      }

      const paidAmount = Math.min(Number(invoice.paidAmount), amount);
      const nextStatus =
        paidAmount >= amount ? "PAID" : paidAmount > 0 ? "PARTIAL" : "OPEN";

      await tx.invoice.update({
          where: {
            id: invoice.id,
          },
          data: {
            amount,
            paidAmount,
            status: nextStatus,
          },
        });

        if (invoice.items[0]) {
          await tx.invoiceItem.update({
            where: {
              id: invoice.items[0].id,
            },
            data: {
              unitPrice: amount,
              amount,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "invoice.amount_adjusted",
            entityType: "Invoice",
            entityId: invoice.id,
            metadata: {
              invoiceNo,
              previousAmount: Number(invoice.amount),
              amount,
              reason,
            } as Prisma.InputJsonValue,
          },
        });
    });
  } catch (error) {
    notice =
      error instanceof BillingActionError ? error.notice : "billing-database";
  }

  if (notice) {
    redirect(`/billing?notice=${notice}`);
  }

  revalidateBillingViews();
  redirect("/billing?notice=billing-adjusted");
}

export async function recordInvoiceRefundAction(formData: FormData) {
  const session = await requireViewSession("billing");

  if (!canPerformAction(session, "billing.payment.refund")) {
    redirect("/billing?notice=billing-denied");
  }

  const invoiceNo = requiredString(formData.get("invoiceNo"));
  const amount = parseMoney(formData.get("amount"));
  const method = requiredString(formData.get("method")) || "cash";
  const reference = optionalString(formData.get("reference"));

  if (!invoiceNo || amount === null || amount <= 0) {
    redirect("/billing?notice=billing-bad-payment");
  }

  let notice: string | null = null;

  try {
    await runSerializableTransaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          invoiceNo,
          clinicId: {
            in: session.clinicIds,
          },
          patient: {
            organizationId: session.organizationId,
          },
        },
        select: {
          id: true,
          amount: true,
          paidAmount: true,
          status: true,
        },
      });

      if (!invoice || invoice.status === "VOID") {
        throw new BillingActionError("billing-invoice-not-found");
      }

      const refundAmount = Math.min(amount, Number(invoice.paidAmount));
      const paidAmount = Math.max(Number(invoice.paidAmount) - refundAmount, 0);
      const nextStatus =
        paidAmount >= Number(invoice.amount)
          ? "PAID"
          : paidAmount > 0
            ? "PARTIAL"
            : "OPEN";

      if (refundAmount <= 0) {
        throw new BillingActionError("billing-bad-payment");
      }

      await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: -refundAmount,
          method: `refund:${method}`,
          reference,
        },
      });
      await tx.invoice.update({
        where: {
          id: invoice.id,
        },
        data: {
          paidAmount,
          status: nextStatus,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "invoice.refund_recorded",
          entityType: "Invoice",
          entityId: invoice.id,
          metadata: {
            invoiceNo,
            amount: refundAmount,
            method,
            reference,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    notice =
      error instanceof BillingActionError ? error.notice : "billing-database";
  }

  if (notice) {
    redirect(`/billing?notice=${notice}`);
  }

  revalidateBillingViews();
  redirect("/billing?notice=billing-refund-recorded");
}

export async function createPaymentPlanReminderAction(formData: FormData) {
  const session = await requireViewSession("billing");

  if (!canPerformAction(session, "billing.invoice.create")) {
    redirect("/billing?notice=billing-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const amount = parseMoney(formData.get("amount"));
  const scheduledAt = parseEndOfDateInVietnam(
    formData.get("scheduledAt"),
    () => new Date(),
  );
  const note = optionalString(formData.get("note"));

  if (
    !patientId ||
    amount === null ||
    amount <= 0 ||
    scheduledAt === "invalid"
  ) {
    redirect("/billing?notice=billing-plan-missing");
  }

  let notice: string | null = null;

  try {
    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        organizationId: session.organizationId,
        clinicId: {
          in: session.clinicIds,
        },
      },
      select: {
        id: true,
        clinicId: true,
        fullName: true,
        phone: true,
        email: true,
      },
    });

    if (!patient) {
      notice = "billing-patient-not-found";
    } else {
      const message = renderNotificationTemplate("PAYMENT_REMINDER", {
        patientName: patient.fullName,
        amount: formatMoneyForNotification(amount),
        dueAt: formatDateForNotification(scheduledAt),
      });
      const notification = await prisma.notification.create({
        data: {
          organizationId: session.organizationId,
          clinicId: patient.clinicId,
          patientId: patient.id,
          channel: "IN_APP",
          status: "SCHEDULED",
          templateKey: "PAYMENT_REMINDER",
          recipient: patient.phone ?? patient.email ?? patient.fullName,
          subject: message.subject,
          body: note ?? message.body,
          scheduledAt,
          metadata: {
            amount,
            note,
          } as Prisma.InputJsonValue,
        },
        select: {
          id: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "billing.payment_plan_reminder_created",
          entityType: "Notification",
          entityId: notification.id,
          metadata: {
            patientId: patient.id,
            amount,
            scheduledAt: scheduledAt.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    }
  } catch {
    notice = "billing-database";
  }

  if (notice) {
    redirect(`/billing?notice=${notice}`);
  }

  revalidateBillingViews();
  revalidatePath("/dashboard");
  redirect("/billing?notice=billing-plan-created");
}

export async function createPaymentPlanAction(formData: FormData) {
  const session = await requireViewSession("billing");

  if (!canPerformAction(session, "billing.invoice.create")) {
    redirect("/billing?notice=billing-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const totalAmount = parseMoney(formData.get("amount"));
  const installmentCount = Math.max(
    Number(formData.get("installmentCount") ?? 0),
    0,
  );
  const intervalDays = Math.max(Number(formData.get("intervalDays") ?? 30), 1);
  const firstDueAt = parseEndOfDateInVietnam(
    formData.get("firstDueAt"),
    () => new Date(),
  );
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

  let notice: string | null = null;

  try {
    await runSerializableTransaction(async (tx) => {
      const patient = await tx.patient.findFirst({
        where: {
          id: patientId,
          organizationId: session.organizationId,
          clinicId: {
            in: session.clinicIds,
          },
        },
        select: {
          id: true,
          clinicId: true,
          fullName: true,
          phone: true,
          email: true,
        },
      });

      if (!patient) {
        throw new BillingActionError("billing-patient-not-found");
      }

      const planNo = await nextPaymentPlanNo(session.organizationId, tx);
      const count = Math.round(installmentCount);
      const baseAmount = Math.floor(totalAmount / count);
      const remainder = totalAmount - baseAmount * count;
      const plan = await tx.paymentPlan.create({
        data: {
          organizationId: session.organizationId,
          clinicId: patient.clinicId,
          patientId: patient.id,
          createdById: databaseActorId(session.userId),
          planNo,
          status: "ACTIVE",
          totalAmount,
          note,
        },
        select: {
          id: true,
        },
      });

      for (let index = 0; index < count; index += 1) {
        const dueAt = new Date(
          firstDueAt.getTime() + index * intervalDays * 24 * 60 * 60 * 1000,
        );
        const amount =
          index === count - 1 ? baseAmount + remainder : baseAmount;
        const message = renderNotificationTemplate("PAYMENT_REMINDER", {
          patientName: patient.fullName,
          amount: formatMoneyForNotification(amount),
          dueAt: formatDateForNotification(dueAt),
        });
        const notification = await tx.notification.create({
          data: {
            organizationId: session.organizationId,
            clinicId: patient.clinicId,
            patientId: patient.id,
            channel: "IN_APP",
            status: "SCHEDULED",
            templateKey: "PAYMENT_REMINDER",
            recipient: patient.phone ?? patient.email ?? patient.fullName,
            subject: `${message.subject} ${index + 1}/${count}`,
            body: note ?? message.body,
            scheduledAt: dueAt,
            metadata: {
              amount,
              planNo,
              sequence: index + 1,
            } as Prisma.InputJsonValue,
          },
          select: {
            id: true,
          },
        });

        await tx.paymentPlanInstallment.create({
          data: {
            paymentPlanId: plan.id,
            sequence: index + 1,
            amount,
            dueAt,
            status: "SCHEDULED",
            notificationId: notification.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "billing.payment_plan_created",
          entityType: "PaymentPlan",
          entityId: plan.id,
          metadata: {
            patientId: patient.id,
            planNo,
            totalAmount,
            installmentCount: count,
            intervalDays,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    notice =
      error instanceof BillingActionError ? error.notice : "billing-database";
  }

  if (notice) {
    redirect(`/billing?notice=${notice}`);
  }

  revalidateBillingViews();
  revalidatePath("/dashboard");
  redirect("/billing?notice=billing-plan-created");
}

async function recordServiceCollection(
  formData: FormData,
  issueInvoice: boolean,
) {
  const session = await requireViewSession("billing");

  if (
    !canPerformAction(
      session,
      issueInvoice ? "billing.invoice.issue" : "billing.balance.allocate",
    )
  ) {
    redirect("/billing?notice=billing-denied");
  }

  const treatmentServiceId = requiredString(formData.get("treatmentServiceId"));
  const parsedAmount = parseMoney(formData.get("amount"));
  const rawMethod = requiredString(formData.get("method")) || "cash";
  const method = receiptMethods.has(rawMethod) ? rawMethod : "cash";
  const reference = optionalString(formData.get("reference"));

  if (!treatmentServiceId) {
    redirect("/billing?notice=billing-service-not-found");
  }

  if (
    method !== "credit_balance" &&
    (parsedAmount === null || parsedAmount <= 0)
  ) {
    redirect("/billing?notice=billing-bad-payment");
  }

  let notice: string | null = null;
  let createdInvoice = false;
  let redirectPatientId: string | null = null;

  try {
    await runSerializableTransaction(async (tx) => {
      const service = await findScopedTreatmentService(
        tx,
        session,
        treatmentServiceId,
      );

      if (!service) {
        throw new BillingActionError("billing-service-not-found");
      }
      redirectPatientId = service.patientId;

      const snapshot = treatmentServiceBillingSnapshot(service);
      const isCreditBalance = method === "credit_balance";
      const creditBalance = isCreditBalance
        ? await tx.patientCreditBalance.findUnique({
            where: {
              patientId: service.patientId,
            },
          })
        : null;
      const availableCredit = Number(creditBalance?.amount ?? 0);
      const requestedAmount =
        isCreditBalance && (!parsedAmount || parsedAmount <= 0)
          ? availableCredit
          : Number(parsedAmount ?? 0);
      const availableAmount = isCreditBalance
        ? availableCredit
        : requestedAmount;
      const allocationAmount = Math.min(
        requestedAmount,
        availableAmount,
        snapshot.remainingCollectionAmount,
      );
      const actualReceiptAmount = isCreditBalance
        ? allocationAmount
        : requestedAmount;
      const overflowAmount = isCreditBalance
        ? 0
        : Math.max(actualReceiptAmount - allocationAmount, 0);

      if (isCreditBalance && allocationAmount <= 0) {
        throw new BillingActionError("billing-no-credit-balance");
      }

      if (!isCreditBalance && actualReceiptAmount <= 0) {
        throw new BillingActionError("billing-bad-payment");
      }

      const invoiceAmount = issueInvoice
        ? Math.min(allocationAmount, snapshot.remainingInvoiceAmount)
        : 0;

      if (issueInvoice && invoiceAmount <= 0) {
        throw new BillingActionError("billing-no-invoiceable-amount");
      }

      const invoiceNo =
        invoiceAmount > 0
          ? await nextInvoiceNo(session.organizationId, tx)
          : null;
      const invoice =
        invoiceNo && invoiceAmount > 0
          ? await tx.invoice.create({
              data: {
                organizationId: session.organizationId,
                clinicId: service.clinicId,
                patientId: service.patientId,
                invoiceNo,
                status: "PAID",
                amount: invoiceAmount,
                paidAmount: invoiceAmount,
                dueDate: new Date(),
              },
              select: {
                id: true,
                invoiceNo: true,
              },
            })
          : null;
      const invoiceItem =
        invoice && invoiceAmount > 0
          ? await tx.invoiceItem.create({
              data: {
                organizationId: session.organizationId,
                clinicId: service.clinicId,
                patientId: service.patientId,
                invoiceId: invoice.id,
                treatmentServiceId: service.id,
                description: serviceInvoiceDescription(service),
                quantity: 1,
                unitPrice: invoiceAmount,
                amount: invoiceAmount,
              },
              select: {
                id: true,
              },
            })
          : null;
      const receiptNo = await nextReceiptNo(session.organizationId, tx);
      const receipt = await tx.receipt.create({
        data: {
          organizationId: session.organizationId,
          clinicId: service.clinicId,
          patientId: service.patientId,
          receiptNo,
          amount: actualReceiptAmount,
          allocatedAmount: allocationAmount,
          unallocatedAmount: overflowAmount,
          method,
          reference,
          note: issueInvoice
            ? "Service collection with invoice"
            : "Service collection without invoice",
        },
        select: {
          id: true,
          receiptNo: true,
        },
      });

      if (allocationAmount > 0) {
        await tx.receiptAllocation.create({
          data: {
            organizationId: session.organizationId,
            clinicId: service.clinicId,
            patientId: service.patientId,
            receiptId: receipt.id,
            invoiceId: invoice?.id ?? null,
            invoiceItemId: invoiceItem?.id ?? null,
            treatmentServiceId: service.id,
            amount: allocationAmount,
            note: invoice ? "Collected and invoiced" : "Collected for service",
          },
        });
      }

      if (invoice && invoiceAmount > 0) {
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            amount: invoiceAmount,
            method,
            reference: receipt.receiptNo,
          },
        });
        createdInvoice = true;
      }

      if (isCreditBalance && allocationAmount > 0) {
        await tx.patientCreditBalance.update({
          where: {
            patientId: service.patientId,
          },
          data: {
            amount: {
              decrement: allocationAmount,
            },
          },
        });
      }

      if (overflowAmount > 0) {
        await tx.patientCreditBalance.upsert({
          where: {
            patientId: service.patientId,
          },
          update: {
            clinicId: service.clinicId,
            amount: {
              increment: overflowAmount,
            },
          },
          create: {
            organizationId: session.organizationId,
            clinicId: service.clinicId,
            patientId: service.patientId,
            amount: overflowAmount,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: invoice
            ? "service.receipt_recorded_and_invoice_issued"
            : "service.receipt_recorded",
          entityType: "Receipt",
          entityId: receipt.id,
          metadata: {
            receiptNo: receipt.receiptNo,
            invoiceNo: invoice?.invoiceNo,
            treatmentServiceId: service.id,
            serviceCode: service.serviceCode,
            method,
            amount: requestedAmount,
            allocatedAmount: allocationAmount,
            unallocatedAmount: overflowAmount,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    notice =
      error instanceof BillingActionError ? error.notice : "billing-database";
  }

  if (notice) {
    redirect(billingNoticeUrl(notice, redirectPatientId));
  }

  revalidateBillingViews();
  redirect(
    billingNoticeUrl(
      createdInvoice
        ? "billing-service-receipt-invoiced"
        : "billing-service-receipt-recorded",
      redirectPatientId,
    ),
  );
}

type BillingDbClient = Prisma.TransactionClient | typeof prisma;

async function findScopedTreatmentService(
  client: BillingDbClient,
  session: AppSession,
  treatmentServiceId: string,
) {
  return client.treatmentService.findFirst({
    where: {
      id: treatmentServiceId,
      organizationId: session.organizationId,
      clinicId: {
        in: session.clinicIds,
      },
    },
    include: {
      patient: {
        select: {
          id: true,
          fullName: true,
        },
      },
      receiptAllocations: {
        select: {
          id: true,
          amount: true,
          invoiceId: true,
        },
      },
      invoiceItems: {
        include: {
          invoice: {
            select: {
              status: true,
            },
          },
        },
      },
    },
  });
}

function treatmentServiceBillingSnapshot(service: {
  finalPrice: unknown;
  receiptAllocations: Array<{
    amount: unknown;
    invoiceId: string | null;
  }>;
  invoiceItems: Array<{
    amount: unknown;
    invoice: {
      status: string;
    };
  }>;
}) {
  const finalPrice = Number(service.finalPrice);
  const collectedAmount = sumMoney(service.receiptAllocations);
  const invoicedAmount = sumMoney(
    service.invoiceItems.filter((item) => item.invoice.status !== "VOID"),
  );
  const uninvoicedAllocatedAmount = sumMoney(
    service.receiptAllocations.filter((allocation) => !allocation.invoiceId),
  );

  return {
    collectedAmount,
    finalPrice,
    invoicedAmount,
    remainingCollectionAmount: Math.max(finalPrice - collectedAmount, 0),
    remainingInvoiceAmount: Math.max(finalPrice - invoicedAmount, 0),
    uninvoicedAllocatedAmount,
  };
}

function serviceInvoiceDescription(service: {
  serviceCode: string;
  serviceName: string;
  targetSummary: string | null;
  teeth: string[];
}) {
  const target =
    service.teeth.length > 0 ? service.teeth.join(", ") : service.targetSummary;

  return [service.serviceCode, service.serviceName, target]
    .filter(Boolean)
    .join(" - ");
}

function sumMoney(items: Array<{ amount: unknown }>) {
  return items.reduce((total, item) => total + Number(item.amount), 0);
}

function formatMoneyForNotification(amount: number) {
  return `${new Intl.NumberFormat("vi-VN").format(amount)} ₫`;
}

function formatDateForNotification(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function isNextRedirect(error: unknown) {
  return (
    error !== null &&
    typeof error === "object" &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

function revalidateBillingViews() {
  revalidatePath("/billing");
  revalidatePath("/journey");
}

function billingNoticeUrl(notice: string, patientId?: string | null) {
  const params = new URLSearchParams({ notice });

  if (patientId) {
    params.set("patientId", patientId);
  }

  return `/billing?${params.toString()}`;
}

async function nextInvoiceNo(
  organizationId: string,
  client: BillingDbClient = prisma,
) {
  return nextDocumentNo({
    client,
    organizationId,
    type: "INV",
    seedCurrentValue: () =>
      client.invoice
        .count({
          where: {
            organizationId,
          },
        })
        .then((count) => 2400 + count),
  });
}

async function nextReceiptNo(
  organizationId: string,
  client: BillingDbClient = prisma,
) {
  return nextDocumentNo({
    client,
    organizationId,
    type: "RCT",
    seedCurrentValue: () =>
      client.receipt
        .count({
          where: {
            organizationId,
          },
        })
        .then((count) => 1000 + count),
  });
}

async function nextPaymentPlanNo(
  organizationId: string,
  client: BillingDbClient = prisma,
) {
  return nextDocumentNo({
    client,
    organizationId,
    type: "PP",
    seedCurrentValue: () =>
      client.paymentPlan
        .count({
          where: {
            organizationId,
          },
        })
        .then((count) => 2600 + count),
  });
}

class BillingActionError extends Error {
  constructor(readonly notice: string) {
    super(notice);
  }
}
