import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

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
          in: session.clinicIds,
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
  const policies = await prisma.sourceCommissionPolicy.findMany({
    where: {
      organizationId: input.organizationId,
      active: true,
    },
  });

  if (policies.length === 0) {
    return { created: 0 };
  }

  const policyBySource = new Map(policies.map((policy) => [policy.source, policy]));
  const receipts = await prisma.receipt.findMany({
    where: {
      organizationId: input.organizationId,
      clinicId: {
        in: input.clinicIds,
      },
      patient: {
        leadSource: {
          in: [...policyBySource.keys()],
        },
      },
    },
    include: {
      patient: {
        select: {
          leadSource: true,
        },
      },
      sourceCommissionAccruals: {
        select: {
          policyId: true,
        },
      },
    },
    orderBy: {
      receivedAt: "asc",
    },
    take: 1000,
  });

  let created = 0;

  await prisma.$transaction(async (tx) => {
    for (const receipt of receipts) {
      const source = receipt.patient.leadSource;
      const policy = policyBySource.get(source);

      if (!policy || receipt.sourceCommissionAccruals.some((item) => item.policyId === policy.id)) {
        continue;
      }

      const baseAmount = Number(receipt.allocatedAmount || receipt.amount);
      const ratePercent = Number(policy.ratePercent);
      const fixedAmount = Number(policy.fixedAmount);
      const commissionAmount = Math.max(Math.round((baseAmount * ratePercent) / 100 + fixedAmount), 0);

      if (commissionAmount <= 0) {
        continue;
      }

      await tx.sourceCommissionAccrual.create({
        data: {
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
  });

  return { created };
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
