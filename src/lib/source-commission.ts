import { accessibleClinicIds } from "@/lib/tenant-scope";
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { runSerializableTransaction } from "@/lib/transaction";
import { loadReceiptRefundLedger, moneyCents, receiptCommission } from "@/lib/application/revenue/refund-ledger";

type CommissionReceipt = Prisma.ReceiptGetPayload<{ include: {
  patient: { select: { leadSource: true } };
  sourceCommissionAccruals: { select: { policyId: true } };
  allocations: { select: { invoiceId: true } };
} }>;

export type SourceCommissionPolicySummary = {
  id: string;
  source: string;
  name: string;
  ownerLabel: string | null;
  ratePercent: number;
  fixedAmount: number;
  monthlyBudget: number | null;
  trigger: string;
  active: boolean;
  notes: string | null;
};

export type SourceCommissionAccrualSummary = {
  id: string;
  clinicId: string;
  clinicName: string;
  patientId: string;
  patientName: string;
  receiptNo: string;
  source: string;
  baseAmount: number;
  commissionAmount: number;
  status: string;
  earnedAt: string;
};

export async function getSourceCommissionWorkspace(session: AppSession) {
  const [policies, accruals] = await Promise.all([
    prisma.sourceCommissionPolicy.findMany({
      where: {
        organizationId: session.organizationId,
      },
      orderBy: [{ active: "desc" }, { source: "asc" }],
    }),
    prisma.sourceCommissionAccrual.findMany({
      where: {
        organizationId: session.organizationId,
        clinicId: {
          in: accessibleClinicIds(session),
        },
      },
      include: {
        clinic: {
          select: {
            name: true,
          },
        },
        patient: {
          select: {
            fullName: true,
          },
        },
        receipt: {
          select: {
            receiptNo: true,
          },
        },
      },
      orderBy: {
        earnedAt: "desc",
      },
      take: 60,
    }),
  ]);

  return {
    policies: policies.map(toPolicySummary),
    accruals: accruals.map(toAccrualSummary),
  };
}

export async function generateSourceCommissionAccruals(input: {
  organizationId: string;
  clinicIds: string[];
  actorId: string | null;
}) {
  return runSerializableTransaction(async (tx) => {
    const policies = await tx.sourceCommissionPolicy.findMany({
      where: { organizationId: input.organizationId, active: true },
    });
    if (!policies.length) return { created: 0 };
    const policyBySource = new Map(policies.map((policy) => [policy.source, policy]));
    let created = 0;
    let cursor: { receivedAt: Date; id: string } | null = null;
    while (created < 1000) {
      const after: { receivedAt: Date; id: string } | null = cursor;
      const receipts: CommissionReceipt[] = await tx.receipt.findMany({
        where: {
          organizationId: input.organizationId, clinicId: { in: input.clinicIds },
          OR: policies.map((policy) => ({ patient: { leadSource: policy.source },
            sourceCommissionAccruals: { none: { policyId: policy.id } } })),
          ...(after ? { AND: [{ OR: [{ receivedAt: { gt: after.receivedAt } },
            { receivedAt: after.receivedAt, id: { gt: after.id } }] }] } : {}),
        },
        include: { patient: { select: { leadSource: true } },
          sourceCommissionAccruals: { select: { policyId: true } },
          allocations: { select: { invoiceId: true } } },
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }], take: 1000,
      });
      if (!receipts.length) break;
      const refunds = await loadReceiptRefundLedger(tx, input.organizationId,
        receipts.map((receipt) => receipt.id),
        receipts.flatMap((receipt) => receipt.allocations.flatMap((row) => row.invoiceId ? [row.invoiceId] : [])));
      for (const receipt of receipts) {
        const source = receipt.patient.leadSource;
        const policy = policyBySource.get(source);
        if (!policy || receipt.sourceCommissionAccruals.some((item) => item.policyId === policy.id)) continue;

        const grossBase = refunds.grossBases.get(receipt.id) ?? moneyCents(receipt.allocatedAmount);
        const baseAmount = Math.max(grossBase - (refunds.byReceipt.get(receipt.id) ?? 0), 0) / 100;
        const ratePercent = Number(policy.ratePercent);
        const fixedAmount = Number(policy.fixedAmount);
        const commissionAmount = receiptCommission(baseAmount, ratePercent, fixedAmount);
        if (commissionAmount <= 0) continue;

        await tx.sourceCommissionAccrual.upsert({
          where: { receiptId_policyId: { receiptId: receipt.id, policyId: policy.id } },
          update: { updatedAt: new Date() },
          create: {
            organizationId: input.organizationId,
            clinicId: receipt.clinicId,
            patientId: receipt.patientId,
            receiptId: receipt.id,
            policyId: policy.id,
            source,
            baseAmount,
            ratePercent,
            fixedAmount,
            commissionAmount,
            status: "EARNED",
            earnedAt: receipt.receivedAt,
          },
        });
        created += 1;
        if (created === 1000) break;
      }
      const last = receipts[receipts.length - 1]!;
      cursor = { receivedAt: last.receivedAt, id: last.id };
      if (receipts.length < 1000) break;
    }

    if (created > 0) {
      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "source_commission.generated",
          entityType: "SourceCommissionAccrual",
          entityId: "batch",
          metadata: {
            created,
          } satisfies Prisma.InputJsonObject,
        },
      });
    }
    return { created };
  });
}

function toPolicySummary(policy: {
  id: string;
  source: string;
  name: string;
  ownerLabel: string | null;
  ratePercent: unknown;
  fixedAmount: unknown;
  monthlyBudget: unknown | null;
  trigger: string;
  active: boolean;
  notes: string | null;
}): SourceCommissionPolicySummary {
  return {
    id: policy.id,
    source: policy.source,
    name: policy.name,
    ownerLabel: policy.ownerLabel,
    ratePercent: Number(policy.ratePercent),
    fixedAmount: Number(policy.fixedAmount),
    monthlyBudget: policy.monthlyBudget == null ? null : Number(policy.monthlyBudget),
    trigger: policy.trigger,
    active: policy.active,
    notes: policy.notes,
  };
}

function toAccrualSummary(accrual: {
  id: string;
  clinicId: string;
  clinic: { name: string };
  patientId: string;
  patient: { fullName: string };
  receipt: { receiptNo: string };
  source: string;
  baseAmount: unknown;
  commissionAmount: unknown;
  status: string;
  earnedAt: Date;
}): SourceCommissionAccrualSummary {
  return {
    id: accrual.id,
    clinicId: accrual.clinicId,
    clinicName: accrual.clinic.name,
    patientId: accrual.patientId,
    patientName: accrual.patient.fullName,
    receiptNo: accrual.receipt.receiptNo,
    source: accrual.source,
    baseAmount: Number(accrual.baseAmount),
    commissionAmount: Number(accrual.commissionAmount),
    status: accrual.status,
    earnedAt: vietnamDate(accrual.earnedAt),
  };
}

function vietnamDate(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}
