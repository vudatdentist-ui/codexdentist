import "server-only";

import {
  patients as demoPatients,
  treatmentPlans as demoPlans,
  type TreatmentPlan,
} from "@/lib/data";
import { patientAccessWhere } from "@/lib/patient-access";
import { hasAnyRole } from "@/lib/permissions";
import type { AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type {
  TreatmentPatientOption,
  TreatmentWorkspace,
} from "@/lib/treatment-types";
import type { AppSession } from "@/lib/session";

const mutableTreatmentRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
];

export async function getTreatmentWorkspace(
  session: AppSession,
  options: { patientId?: string } = {},
): Promise<TreatmentWorkspace> {
  try {
    const patientWhere = {
      ...patientAccessWhere(session),
      ...(options.patientId ? { id: options.patientId } : {}),
    };

    const [dbPatients, dbPlans] = await Promise.all([
      prisma.patient.findMany({
        where: patientWhere,
        select: {
          id: true,
          fullName: true,
          clinicId: true,
        },
        orderBy: {
          fullName: "asc",
        },
      }),
      prisma.treatmentPlan.findMany({
        where: {
          ...(options.patientId ? { patientId: options.patientId } : {}),
          patient: patientWhere,
        },
        include: {
          patient: {
            select: {
              id: true,
              fullName: true,
              clinicId: true,
            },
          },
          phases: {
            orderBy: {
              sequence: "asc",
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),
    ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableTreatmentRoles) && dbPatients.length > 0,
      message:
        dbPatients.length === 0
          ? "Chưa có dữ liệu trong phạm vi hiện tại."
          : null,
      patients: dbPatients.map(toPatientOption),
      plans: dbPlans.map(toTreatmentPlan),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "treatments");
    return demoTreatmentWorkspace(session);
  }
}

function demoTreatmentWorkspace(session: AppSession): TreatmentWorkspace {
  const allowedIds = new Set(session.clinicIds);

  return {
    source: "demo",
    canMutate: false,
    message:
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    patients: demoPatients
      .filter((patient) => allowedIds.has(patient.clinicId))
      .map((patient) => ({
        id: patient.id,
        name: patient.name,
        clinicId: patient.clinicId,
      })),
    plans: demoPlans.filter((plan) => allowedIds.has(plan.clinicId)),
  };
}

function toPatientOption(patient: {
  id: string;
  fullName: string;
  clinicId: string;
}): TreatmentPatientOption {
  return {
    id: patient.id,
    name: patient.fullName,
    clinicId: patient.clinicId,
  };
}

function toTreatmentPlan(plan: {
  id: string;
  title: string;
  status: string;
  totalAmount: unknown;
  patientDue: unknown;
  createdAt: Date;
  patient: {
    id: string;
    fullName: string;
    clinicId: string;
  };
  phases: Array<{
    name: string;
    procedures: string[];
  }>;
}): TreatmentPlan {
  const primaryPhase = plan.phases[0];
  const procedures = plan.phases.flatMap((phase) => phase.procedures);

  return {
    id: plan.id,
    patient: plan.patient.fullName,
    patientId: plan.patient.id,
    clinicId: plan.patient.clinicId,
    title: plan.title,
    phase: primaryPhase?.name ?? "Unphased",
    status: treatmentStatusLabel(plan.status),
    estimatedCost: Number(plan.totalAmount),
    patientShare: Number(plan.patientDue),
    tasks: procedures.length > 0 ? procedures : ["No procedures added"],
    createdAt: plan.createdAt.toISOString(),
  };
}

function treatmentStatusLabel(status: string): TreatmentPlan["status"] {
  const labels: Record<string, TreatmentPlan["status"]> = {
    DRAFT: "Draft",
    PRESENTED: "Presented",
    ACCEPTED: "Accepted",
    IN_PROGRESS: "In progress",
    COMPLETED: "Completed",
    DECLINED: "Declined",
  };

  return labels[status] ?? "Draft";
}
