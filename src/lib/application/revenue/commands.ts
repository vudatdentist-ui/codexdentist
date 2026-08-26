import type { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { ApplicationCommandError } from "@/lib/application/errors";
import { nextDocumentNo } from "@/lib/document-sequence";
import { databaseActorId } from "@/lib/form-validation";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { runSerializableTransaction } from "@/lib/transaction";

export type ReceiptMethod = "cash" | "card" | "bank_transfer" | "credit_balance";

type BillingDbClient = Prisma.TransactionClient | typeof prisma;

export async function createInvoiceCommand(session: AppSession, input: {
  patientId: string;
  amount: number;
  dueDate: Date;
}) {
  requireAction(session, "billing.invoice.create");
  const patient = await prisma.patient.findFirst({
    where: {
      id: input.patientId,
      organizationId: session.organizationId,
      clinicId: { in: session.clinicIds },
    },
    select: { id: true, clinicId: true },
  });
  if (!patient) throw new ApplicationCommandError("billing-patient-not-found");

  return runSerializableTransaction(async (tx) => {
    const invoiceNo = await nextInvoiceNo(session.organizationId, tx);
    const invoice = await tx.invoice.create({
      data: {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: input.patientId,
        invoiceNo,
        status: "OPEN",
        amount: input.amount,
        paidAmount: 0,
        dueDate: input.dueDate,
      },
      select: { id: true, invoiceNo: true },
    });
    await tx.invoiceItem.create({
      data: {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: input.patientId,
        invoiceId: invoice.id,
        treatmentServiceId: null,
        description: "Manual patient invoice",
        quantity: 1,
        unitPrice: input.amount,
        amount: input.amount,
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
          patientId: input.patientId,
          amount: input.amount,
          source: "manual",
        } as Prisma.InputJsonValue,
      },
    });
    return invoice;
  });
}

export async function recordInvoicePaymentCommand(session: AppSession, input: {
  invoiceNo: string;
  amount: number;
  method: string;
}) {
  requireAction(session, "billing.payment.record");
  return runSerializableTransaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: {
        invoiceNo: input.invoiceNo,
        clinicId: { in: session.clinicIds },
        patient: { organizationId: session.organizationId },
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
      throw new ApplicationCommandError("billing-invoice-not-found");
    }

    const invoiceBalance = Math.max(Number(invoice.amount) - Number(invoice.paidAmount), 0);
    const allocatedAmount = Math.min(input.amount, invoiceBalance);
    const unallocatedAmount = Math.max(input.amount - allocatedAmount, 0);
    const nextPaid = Math.min(Number(invoice.paidAmount) + allocatedAmount, Number(invoice.amount));
    const nextStatus = nextPaid >= Number(invoice.amount) ? "PAID" : "PARTIAL";
    const receiptNo = await nextReceiptNo(session.organizationId, tx);
    const receipt = await tx.receipt.create({
      data: {
        organizationId: session.organizationId,
        clinicId: invoice.clinicId,
        patientId: invoice.patientId,
        receiptNo,
        amount: input.amount,
        allocatedAmount,
        unallocatedAmount,
        method: input.method,
        reference: input.invoiceNo,
        note: "Invoice payment",
      },
      select: { id: true, receiptNo: true },
    });

    if (allocatedAmount > 0) {
      await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: allocatedAmount,
          method: input.method,
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
        where: { patientId: invoice.patientId },
        update: { clinicId: invoice.clinicId, amount: { increment: unallocatedAmount } },
        create: {
          organizationId: session.organizationId,
          clinicId: invoice.clinicId,
          patientId: invoice.patientId,
          amount: unallocatedAmount,
        },
      });
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { paidAmount: nextPaid, status: nextStatus },
    });
    await tx.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "invoice.receipt_recorded",
        entityType: "Receipt",
        entityId: receipt.id,
        metadata: {
          invoiceNo: input.invoiceNo,
          receiptNo: receipt.receiptNo,
          amount: input.amount,
          allocatedAmount,
          unallocatedAmount,
          method: input.method,
          paidAmount: nextPaid,
        } as Prisma.InputJsonValue,
      },
    });
    return { receiptId: receipt.id, patientId: invoice.patientId };
  });
}

export async function recordPatientReceiptCommand(session: AppSession, input: {
  patientId: string;
  amount: number;
  method: Exclude<ReceiptMethod, "credit_balance">;
  reference: string | null;
  note: string | null;
}) {
  requireAction(session, "billing.receipt.record");
  return runSerializableTransaction(async (tx) => {
    const patient = await tx.patient.findFirst({
      where: {
        id: input.patientId,
        organizationId: session.organizationId,
        clinicId: { in: session.clinicIds },
      },
      select: { id: true, clinicId: true },
    });
    if (!patient) throw new ApplicationCommandError("billing-patient-not-found");

    const receiptNo = await nextReceiptNo(session.organizationId, tx);
    const receipt = await tx.receipt.create({
      data: {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        receiptNo,
        amount: input.amount,
        allocatedAmount: 0,
        unallocatedAmount: input.amount,
        method: input.method,
        reference: input.reference,
        note: input.note || "Patient receipt to balance",
      },
      select: { id: true, receiptNo: true },
    });
    await tx.patientCreditBalance.upsert({
      where: { patientId: patient.id },
      update: { clinicId: patient.clinicId, amount: { increment: input.amount } },
      create: {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        amount: input.amount,
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
          amount: input.amount,
          method: input.method,
          reference: input.reference,
        } as Prisma.InputJsonValue,
      },
    });
    return receipt;
  });
}

export async function issueServiceInvoiceCommand(session: AppSession, treatmentServiceId: string) {
  requireAction(session, "billing.invoice.issue");
  return runSerializableTransaction(async (tx) => {
    const service = await findScopedTreatmentService(tx, session, treatmentServiceId);
    if (!service) throw new ApplicationCommandError("billing-service-not-found");
    const snapshot = treatmentServiceBillingSnapshot(service);
    const invoiceAmount = Math.min(snapshot.uninvoicedAllocatedAmount, snapshot.remainingInvoiceAmount);
    if (invoiceAmount <= 0) throw new ApplicationCommandError("billing-no-invoiceable-amount");

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
      select: { id: true, invoiceNo: true },
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
      select: { id: true },
    });
    const unlinkedAllocationIds = service.receiptAllocations
      .filter((allocation) => !allocation.invoiceId)
      .map((allocation) => allocation.id);
    if (unlinkedAllocationIds.length > 0) {
      await tx.receiptAllocation.updateMany({
        where: { id: { in: unlinkedAllocationIds } },
        data: { invoiceId: invoice.id, invoiceItemId: invoiceItem.id },
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
    return { invoiceId: invoice.id, patientId: service.patientId };
  });
}

export async function voidInvoiceCommand(session: AppSession, invoiceNo: string) {
  requireAction(session, "billing.invoice.void");
  return runSerializableTransaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: {
        invoiceNo,
        organizationId: session.organizationId,
        clinicId: { in: session.clinicIds },
        patient: { organizationId: session.organizationId },
      },
      select: { id: true, clinicId: true, patientId: true },
    });
    if (!invoice) throw new ApplicationCommandError("billing-invoice-not-found");

    const allocations = await tx.receiptAllocation.findMany({
      where: { invoiceId: invoice.id },
      select: { id: true, receiptId: true, treatmentServiceId: true, amount: true },
    });
    const serviceAllocationIds = allocations.filter((a) => a.treatmentServiceId).map((a) => a.id);
    const directAllocations = allocations.filter((a) => !a.treatmentServiceId);
    const directReleasedAmount = sumMoney(directAllocations);

    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "VOID" } });
    if (serviceAllocationIds.length > 0) {
      await tx.receiptAllocation.updateMany({
        where: { id: { in: serviceAllocationIds } },
        data: { invoiceId: null, invoiceItemId: null },
      });
    }
    for (const allocation of directAllocations) {
      const amount = Number(allocation.amount);
      await tx.receipt.update({
        where: { id: allocation.receiptId },
        data: {
          allocatedAmount: { decrement: amount },
          unallocatedAmount: { increment: amount },
        },
      });
    }
    if (directAllocations.length > 0) {
      await tx.receiptAllocation.deleteMany({ where: { id: { in: directAllocations.map((a) => a.id) } } });
    }
    if (directReleasedAmount > 0) {
      await tx.patientCreditBalance.upsert({
        where: { patientId: invoice.patientId },
        update: { clinicId: invoice.clinicId, amount: { increment: directReleasedAmount } },
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
    return { patientId: invoice.patientId };
  });
}

export async function adjustInvoiceAmountCommand(session: AppSession, input: {
  invoiceNo: string;
  amount: number;
  reason: string | null;
}) {
  requireAction(session, "billing.invoice.void");
  return runSerializableTransaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: {
        invoiceNo: input.invoiceNo,
        clinicId: { in: session.clinicIds },
        patient: { organizationId: session.organizationId },
      },
      include: { items: { orderBy: { createdAt: "asc" }, take: 1 } },
    });
    if (!invoice || invoice.status === "VOID") throw new ApplicationCommandError("billing-invoice-not-found");
    const paidAmount = Math.min(Number(invoice.paidAmount), input.amount);
    const nextStatus = paidAmount >= input.amount ? "PAID" : paidAmount > 0 ? "PARTIAL" : "OPEN";
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { amount: input.amount, paidAmount, status: nextStatus },
    });
    if (invoice.items[0]) {
      await tx.invoiceItem.update({
        where: { id: invoice.items[0].id },
        data: { unitPrice: input.amount, amount: input.amount },
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
          invoiceNo: input.invoiceNo,
          previousAmount: Number(invoice.amount),
          amount: input.amount,
          reason: input.reason,
        } as Prisma.InputJsonValue,
      },
    });
    return { patientId: invoice.patientId };
  });
}

export async function recordInvoiceRefundCommand(session: AppSession, input: {
  invoiceNo: string;
  amount: number;
  method: string;
  reference: string | null;
}) {
  requireAction(session, "billing.payment.refund");
  return runSerializableTransaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: {
        invoiceNo: input.invoiceNo,
        clinicId: { in: session.clinicIds },
        patient: { organizationId: session.organizationId },
      },
      select: { id: true, amount: true, paidAmount: true, status: true, patientId: true },
    });
    if (!invoice || invoice.status === "VOID") throw new ApplicationCommandError("billing-invoice-not-found");
    const refundAmount = Math.min(input.amount, Number(invoice.paidAmount));
    if (refundAmount <= 0) throw new ApplicationCommandError("billing-bad-payment");
    const paidAmount = Math.max(Number(invoice.paidAmount) - refundAmount, 0);
    const nextStatus = paidAmount >= Number(invoice.amount) ? "PAID" : paidAmount > 0 ? "PARTIAL" : "OPEN";
    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: -refundAmount,
        method: `refund:${input.method}`,
        reference: input.reference,
      },
    });
    await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount, status: nextStatus } });
    await tx.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "invoice.refund_recorded",
        entityType: "Invoice",
        entityId: invoice.id,
        metadata: {
          invoiceNo: input.invoiceNo,
          amount: refundAmount,
          method: input.method,
          reference: input.reference,
        } as Prisma.InputJsonValue,
      },
    });
    return { patientId: invoice.patientId, refundAmount };
  });
}

export async function createPaymentPlanReminderCommand(session: AppSession, input: {
  patientId: string;
  amount: number;
  scheduledAt: Date;
  note: string | null;
}) {
  requireAction(session, "billing.invoice.create");
  const patient = await prisma.patient.findFirst({
    where: {
      id: input.patientId,
      organizationId: session.organizationId,
      clinicId: { in: session.clinicIds },
    },
    select: { id: true, clinicId: true, fullName: true, phone: true, email: true },
  });
  if (!patient) throw new ApplicationCommandError("billing-patient-not-found");

  const message = renderNotificationTemplate("PAYMENT_REMINDER", {
    patientName: patient.fullName,
    amount: formatMoneyForNotification(input.amount),
    dueAt: formatDateForNotification(input.scheduledAt),
  });
  return prisma.$transaction(async (tx) => {
    const notification = await tx.notification.create({
      data: {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        channel: "IN_APP",
        status: "SCHEDULED",
        templateKey: "PAYMENT_REMINDER",
        recipient: patient.phone ?? patient.email ?? patient.fullName,
        subject: message.subject,
        body: input.note ?? message.body,
        scheduledAt: input.scheduledAt,
        metadata: { amount: input.amount, note: input.note } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "billing.payment_plan_reminder_created",
        entityType: "Notification",
        entityId: notification.id,
        metadata: {
          patientId: patient.id,
          amount: input.amount,
          scheduledAt: input.scheduledAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    return notification;
  });
}

export async function createPaymentPlanCommand(session: AppSession, input: {
  patientId: string;
  totalAmount: number;
  installmentCount: number;
  intervalDays: number;
  firstDueAt: Date;
  note: string | null;
}) {
  requireAction(session, "billing.invoice.create");
  return runSerializableTransaction(async (tx) => {
    const patient = await tx.patient.findFirst({
      where: {
        id: input.patientId,
        organizationId: session.organizationId,
        clinicId: { in: session.clinicIds },
      },
      select: { id: true, clinicId: true, fullName: true, phone: true, email: true },
    });
    if (!patient) throw new ApplicationCommandError("billing-patient-not-found");

    const planNo = await nextPaymentPlanNo(session.organizationId, tx);
    const count = Math.round(input.installmentCount);
    const baseAmount = Math.floor(input.totalAmount / count);
    const remainder = input.totalAmount - baseAmount * count;
    const plan = await tx.paymentPlan.create({
      data: {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        createdById: databaseActorId(session.userId),
        planNo,
        status: "ACTIVE",
        totalAmount: input.totalAmount,
        note: input.note,
      },
      select: { id: true },
    });

    for (let index = 0; index < count; index += 1) {
      const dueAt = new Date(input.firstDueAt.getTime() + index * input.intervalDays * 24 * 60 * 60 * 1000);
      const amount = index === count - 1 ? baseAmount + remainder : baseAmount;
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
          body: input.note ?? message.body,
          scheduledAt: dueAt,
          metadata: { amount, planNo, sequence: index + 1 } as Prisma.InputJsonValue,
        },
        select: { id: true },
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
          totalAmount: input.totalAmount,
          installmentCount: count,
          intervalDays: input.intervalDays,
        } as Prisma.InputJsonValue,
      },
    });
    return plan;
  });
}

export async function recordServiceCollectionCommand(session: AppSession, input: {
  treatmentServiceId: string;
  amount: number | null;
  method: ReceiptMethod;
  reference: string | null;
  issueInvoice: boolean;
}) {
  const permission = input.issueInvoice ? "billing.invoice.issue" : "billing.balance.allocate";
  requireAction(session, permission);
  return runSerializableTransaction(async (tx) => {
    const service = await findScopedTreatmentService(tx, session, input.treatmentServiceId);
    if (!service) throw new ApplicationCommandError("billing-service-not-found");

    const snapshot = treatmentServiceBillingSnapshot(service);
    const isCreditBalance = input.method === "credit_balance";
    const creditBalance = isCreditBalance
      ? await tx.patientCreditBalance.findUnique({ where: { patientId: service.patientId } })
      : null;
    const availableCredit = Number(creditBalance?.amount ?? 0);
    const requestedAmount = isCreditBalance && (!input.amount || input.amount <= 0)
      ? availableCredit
      : Number(input.amount ?? 0);
    const availableAmount = isCreditBalance ? availableCredit : requestedAmount;
    const allocationAmount = Math.min(requestedAmount, availableAmount, snapshot.remainingCollectionAmount);
    const actualReceiptAmount = isCreditBalance ? allocationAmount : requestedAmount;
    const overflowAmount = isCreditBalance ? 0 : Math.max(actualReceiptAmount - allocationAmount, 0);

    if (isCreditBalance && allocationAmount <= 0) throw new ApplicationCommandError("billing-no-credit-balance");
    if (!isCreditBalance && actualReceiptAmount <= 0) throw new ApplicationCommandError("billing-bad-payment");

    const invoiceAmount = input.issueInvoice ? Math.min(allocationAmount, snapshot.remainingInvoiceAmount) : 0;
    if (input.issueInvoice && invoiceAmount <= 0) {
      throw new ApplicationCommandError("billing-no-invoiceable-amount");
    }

    const invoiceNo = invoiceAmount > 0 ? await nextInvoiceNo(session.organizationId, tx) : null;
    const invoice = invoiceNo && invoiceAmount > 0
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
          select: { id: true, invoiceNo: true },
        })
      : null;
    const invoiceItem = invoice && invoiceAmount > 0
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
          select: { id: true },
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
        method: input.method,
        reference: input.reference,
        note: input.issueInvoice ? "Service collection with invoice" : "Service collection without invoice",
      },
      select: { id: true, receiptNo: true },
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
          method: input.method,
          reference: receipt.receiptNo,
        },
      });
    }
    if (isCreditBalance && allocationAmount > 0) {
      await tx.patientCreditBalance.update({
        where: { patientId: service.patientId },
        data: { amount: { decrement: allocationAmount } },
      });
    }
    if (overflowAmount > 0) {
      await tx.patientCreditBalance.upsert({
        where: { patientId: service.patientId },
        update: { clinicId: service.clinicId, amount: { increment: overflowAmount } },
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
        action: invoice ? "service.receipt_recorded_and_invoice_issued" : "service.receipt_recorded",
        entityType: "Receipt",
        entityId: receipt.id,
        metadata: {
          receiptNo: receipt.receiptNo,
          invoiceNo: invoice?.invoiceNo,
          treatmentServiceId: service.id,
          serviceCode: service.serviceCode,
          method: input.method,
          amount: requestedAmount,
          allocatedAmount: allocationAmount,
          unallocatedAmount: overflowAmount,
        } as Prisma.InputJsonValue,
      },
    });
    return { patientId: service.patientId, createdInvoice: Boolean(invoice) };
  });
}

function requireAction(session: AppSession, action: Parameters<typeof canPerformAction>[1]) {
  if (!canPerformAction(session, action)) throw new ApplicationCommandError("billing-denied");
}

async function findScopedTreatmentService(client: BillingDbClient, session: AppSession, treatmentServiceId: string) {
  return client.treatmentService.findFirst({
    where: {
      id: treatmentServiceId,
      organizationId: session.organizationId,
      clinicId: { in: session.clinicIds },
    },
    include: {
      patient: { select: { id: true, fullName: true } },
      receiptAllocations: { select: { id: true, amount: true, invoiceId: true } },
      invoiceItems: { include: { invoice: { select: { status: true } } } },
    },
  });
}

function treatmentServiceBillingSnapshot(service: {
  finalPrice: unknown;
  receiptAllocations: Array<{ amount: unknown; invoiceId: string | null }>;
  invoiceItems: Array<{ amount: unknown; invoice: { status: string } }>;
}) {
  const finalPrice = Number(service.finalPrice);
  const collectedAmount = sumMoney(service.receiptAllocations);
  const invoicedAmount = sumMoney(service.invoiceItems.filter((item) => item.invoice.status !== "VOID"));
  const uninvoicedAllocatedAmount = sumMoney(service.receiptAllocations.filter((allocation) => !allocation.invoiceId));
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
  const target = service.teeth.length > 0 ? service.teeth.join(", ") : service.targetSummary;
  return [service.serviceCode, service.serviceName, target].filter(Boolean).join(" - ");
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

async function nextInvoiceNo(organizationId: string, client: BillingDbClient = prisma) {
  return nextDocumentNo({
    client,
    organizationId,
    type: "INV",
    seedCurrentValue: () => client.invoice.count({ where: { organizationId } }).then((count) => 2400 + count),
  });
}

async function nextReceiptNo(organizationId: string, client: BillingDbClient = prisma) {
  return nextDocumentNo({
    client,
    organizationId,
    type: "RCT",
    seedCurrentValue: () => client.receipt.count({ where: { organizationId } }).then((count) => 1000 + count),
  });
}

async function nextPaymentPlanNo(organizationId: string, client: BillingDbClient = prisma) {
  return nextDocumentNo({
    client,
    organizationId,
    type: "PP",
    seedCurrentValue: () => client.paymentPlan.count({ where: { organizationId } }).then((count) => 2600 + count),
  });
}
