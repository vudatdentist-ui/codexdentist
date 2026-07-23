"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  parseMoney,
  requiredString,
  splitList,
} from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";

const treatmentStatuses = [
  "DRAFT",
  "PRESENTED",
  "ACCEPTED",
  "IN_PROGRESS",
  "COMPLETED",
  "DECLINED",
] as const;

export async function createTreatmentPlanAction(formData: FormData) {
  const session = await requireViewSession("treatment");

  if (!canPerformAction(session, "treatment.plan.create")) {
    redirect("/journey?notice=treatment-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const title = requiredString(formData.get("title"));
  const phaseName = requiredString(formData.get("phaseName"));
  const procedures = splitList(formData.get("procedures"));
  const totalAmount = parseMoney(formData.get("totalAmount"));
  const patientDue = parseMoney(formData.get("patientDue"));

  if (!patientId || !title || !phaseName || procedures.length === 0) {
    redirect("/journey?notice=treatment-missing");
  }

  if (totalAmount === null || patientDue === null || totalAmount < 0 || patientDue < 0) {
    redirect("/journey?notice=treatment-bad-money");
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
      notice = "treatment-patient-not-found";
    } else {
      const plan = await prisma.treatmentPlan.create({
        data: {
          patientId,
          title,
          status: "DRAFT",
          totalAmount,
          patientDue,
          phases: {
            create: {
              name: phaseName,
              sequence: 1,
              procedures,
              estimatedAmount: totalAmount,
            },
          },
        },
        select: {
          id: true,
        },
      });

      await writeTreatmentAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "treatment_plan.created",
        entityId: plan.id,
        metadata: {
          patientId,
          clinicId: patient.clinicId,
          totalAmount,
        },
      });
    }
  } catch {
    notice = "treatment-database";
  }

  if (notice) {
    redirect(`/journey?notice=${notice}`);
  }

  revalidatePath("/journey");
  redirect("/journey?notice=treatment-created");
}

export async function updateTreatmentStatusAction(formData: FormData) {
  const session = await requireViewSession("treatment");

  const planId = requiredString(formData.get("planId"));
  const status = requiredString(formData.get("status"));

  if (!canPerformAction(session, status === "ACCEPTED" ? "treatment.plan.accept" : "treatment.plan.create")) {
    redirect("/journey?notice=treatment-denied");
  }

  if (!planId || !isTreatmentStatus(status)) {
    redirect("/journey?notice=treatment-bad-status");
  }

  let notice: string | null = null;

  try {
    const plan = await prisma.treatmentPlan.findFirst({
      where: {
        id: planId,
        patient: {
          organizationId: session.organizationId,
          clinicId: {
            in: session.clinicIds,
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (!plan) {
      notice = "treatment-not-found";
    } else {
      await prisma.treatmentPlan.update({
        where: {
          id: planId,
        },
        data: {
          status,
        },
      });

      await writeTreatmentAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "treatment_plan.status_updated",
        entityId: planId,
        metadata: {
          status,
        },
      });
    }
  } catch {
    notice = "treatment-database";
  }

  if (notice) {
    redirect(`/journey?notice=${notice}`);
  }

  revalidatePath("/journey");
  redirect("/journey?notice=treatment-status-updated");
}

export async function addTreatmentPhaseAction(formData: FormData) {
  const session = await requireViewSession("treatment");

  if (!canPerformAction(session, "treatment.plan.create")) {
    redirect("/journey?notice=treatment-denied");
  }

  const planId = requiredString(formData.get("planId"));
  const phaseName = requiredString(formData.get("phaseName"));
  const procedures = splitList(formData.get("procedures"));
  const estimatedAmount = parseMoney(formData.get("estimatedAmount"));

  if (!planId || !phaseName || procedures.length === 0) {
    redirect("/journey?notice=treatment-phase-missing");
  }

  if (estimatedAmount === null || estimatedAmount < 0) {
    redirect("/journey?notice=treatment-bad-money");
  }

  let notice: string | null = null;

  try {
    const plan = await prisma.treatmentPlan.findFirst({
      where: {
        id: planId,
        patient: {
          organizationId: session.organizationId,
          clinicId: {
            in: session.clinicIds,
          },
        },
      },
      include: {
        phases: {
          select: {
            sequence: true,
          },
        },
      },
    });

    if (!plan) {
      notice = "treatment-not-found";
    } else {
      const nextSequence =
        Math.max(0, ...plan.phases.map((phase) => phase.sequence)) + 1;

      await prisma.treatmentPhase.create({
        data: {
          treatmentPlanId: planId,
          name: phaseName,
          sequence: nextSequence,
          procedures,
          estimatedAmount,
        },
      });

      await prisma.treatmentPlan.update({
        where: {
          id: planId,
        },
        data: {
          totalAmount: Number(plan.totalAmount) + estimatedAmount,
          patientDue: Number(plan.patientDue) + estimatedAmount,
        },
      });

      await writeTreatmentAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "treatment_phase.created",
        entityId: planId,
        metadata: {
          phaseName,
          estimatedAmount,
        },
      });
    }
  } catch {
    notice = "treatment-database";
  }

  if (notice) {
    redirect(`/journey?notice=${notice}`);
  }

  revalidatePath("/journey");
  redirect("/journey?notice=treatment-phase-added");
}

function isTreatmentStatus(
  status: string,
): status is (typeof treatmentStatuses)[number] {
  return treatmentStatuses.includes(status as (typeof treatmentStatuses)[number]);
}

async function writeTreatmentAuditLog(input: {
  organizationId: string;
  actorId: string | null;
  action: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      entityType: "TreatmentPlan",
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
