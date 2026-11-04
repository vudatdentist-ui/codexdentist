import type { Prisma } from "@prisma/client";
import { nextDocumentNo } from "@/lib/document-sequence";

export async function recordProviderSettlementCommand(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    clinicId: string;
    patientId: string;
    amount: number;
    method: "bank_transfer";
    provider: string;
    providerReference: string;
    providerEventId: string;
    invoiceNo?: string | null;
  },
) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new ProviderSettlementError("provider-settlement-amount-invalid");
  }
  const patient = await tx.patient.findFirst({
    where: {
      id: input.patientId,
      organizationId: input.organizationId,
      clinicId: input.clinicId,
    },
    select: { id: true, clinicId: true },
  });
  if (!patient) throw new ProviderSettlementError("provider-settlement-patient-not-found");

  const invoice = input.invoiceNo
    ? await tx.invoice.findFirst({
        where: {
          invoiceNo: input.invoiceNo,
          organizationId: input.organizationId,
          clinicId: input.clinicId,
          patientId: input.patientId,
          status: { not: "VOID" },
        },
        select: {
          id: true,
          invoiceNo: true,
          amount: true,
          paidAmount: true,
          status: true,
        },
      })
    : null;
  if (input.invoiceNo && !invoice) {
    throw new ProviderSettlementError("provider-settlement-invoice-not-found");
  }

  const invoiceBalance = invoice
    ? Math.max(Number(invoice.amount) - Number(invoice.paidAmount), 0)
    : 0;
  const allocatedAmount = invoice ? Math.min(input.amount, invoiceBalance) : 0;
  const unallocatedAmount = input.amount - allocatedAmount;
  const receiptNo = await nextDocumentNo({
    client: tx,
    organizationId: input.organizationId,
    type: "RCT",
    seedCurrentValue: () =>
      tx.receipt.count({ where: { organizationId: input.organizationId } }).then((count) => 1000 + count),
  });
  const receipt = await tx.receipt.create({
    data: {
      organizationId: input.organizationId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      receiptNo,
      amount: input.amount,
      allocatedAmount,
      unallocatedAmount,
      method: input.method,
      reference: input.providerReference,
      note: `${input.provider} settlement`,
    },
    select: { id: true, receiptNo: true },
  });

  if (invoice && allocatedAmount > 0) {
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
        organizationId: input.organizationId,
        clinicId: input.clinicId,
        patientId: input.patientId,
        receiptId: receipt.id,
        invoiceId: invoice.id,
        amount: allocatedAmount,
        note: `${input.provider} payment`,
      },
    });
    const nextPaidAmount = Math.min(
      Number(invoice.paidAmount) + allocatedAmount,
      Number(invoice.amount),
    );
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: nextPaidAmount,
        status: nextPaidAmount >= Number(invoice.amount) ? "PAID" : "PARTIAL",
      },
    });
  }

  if (unallocatedAmount > 0) {
    await tx.patientCreditBalance.upsert({
      where: { patientId: input.patientId },
      update: {
        clinicId: input.clinicId,
        amount: { increment: unallocatedAmount },
      },
      create: {
        organizationId: input.organizationId,
        clinicId: input.clinicId,
        patientId: input.patientId,
        amount: unallocatedAmount,
      },
    });
  }

  await tx.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: null,
      action: "billing.provider_settlement_recorded",
      entityType: "Receipt",
      entityId: receipt.id,
      metadata: {
        provider: input.provider,
        providerReference: input.providerReference,
        providerEventId: input.providerEventId,
        receiptNo: receipt.receiptNo,
        patientId: input.patientId,
        invoiceNo: input.invoiceNo ?? null,
        amount: input.amount,
        allocatedAmount,
        unallocatedAmount,
      } as Prisma.InputJsonValue,
    },
  });

  return {
    receiptId: receipt.id,
    receiptNo: receipt.receiptNo,
    allocatedAmount,
    unallocatedAmount,
  };
}

export class ProviderSettlementError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ProviderSettlementError";
  }
}
