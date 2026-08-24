import "server-only";

import type { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import {
  calculateServiceProgressCompensation,
  defaultServiceCompensationRule,
  type ServiceCompensationRuleInput,
} from "@/lib/compensation";
import { databaseActorId } from "@/lib/form-validation";
import type { AppSession } from "@/lib/session";
import { runSerializableTransaction } from "@/lib/transaction";

export type RecordTreatmentProgressInput = {
  treatmentServiceId: string;
  toProgressPercent: number;
  performedById?: string | null;
  consultantId?: string | null;
  clinicalSupportId?: string | null;
  assistantPrimaryId?: string | null;
  assistantSecondaryId?: string | null;
  note?: string | null;
};

export type RecordTreatmentProgressResult = {
  patientId: string;
  clinicId: string;
  treatmentServiceId: string;
  progressEventId: string;
  fromProgressPercent: number;
  toProgressPercent: number;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
};

export type TreatmentProgressErrorCode =
  | "forbidden"
  | "missing"
  | "regression"
  | "invalid-progress";

export class TreatmentProgressError extends Error {
  constructor(
    public readonly code: TreatmentProgressErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TreatmentProgressError";
  }
}

export async function recordTreatmentProgress(
  session: AppSession,
  input: RecordTreatmentProgressInput,
): Promise<RecordTreatmentProgressResult> {
  if (!canPerformAction(session, "treatment.service.progress")) {
    throw new TreatmentProgressError(
      "forbidden",
      "Current role cannot record treatment progress.",
    );
  }

  const treatmentServiceId = input.treatmentServiceId.trim();
  const toProgressPercent = normalizeProgress(input.toProgressPercent);
  const performedById = input.performedById?.trim() || session.userId;

  if (!treatmentServiceId || !performedById) {
    throw new TreatmentProgressError(
      "missing",
      "Treatment service and operator are required.",
    );
  }

  if (toProgressPercent === null) {
    throw new TreatmentProgressError(
      "invalid-progress",
      "Treatment progress must be between 0 and 100.",
    );
  }

  return runSerializableTransaction(async (tx) => {
    const service = await tx.treatmentService.findFirst({
      where: {
        id: treatmentServiceId,
        organizationId: session.organizationId,
        clinicId: {
          in: session.clinicIds,
        },
      },
      include: {
        serviceCatalogItem: {
          include: {
            materials: {
              include: {
                inventoryItem: {
                  select: {
                    id: true,
                    name: true,
                    unit: true,
                    onHandQuantity: true,
                    minimumStock: true,
                    lots: {
                      where: {
                        quantityOnHand: {
                          gt: 0,
                        },
                      },
                      orderBy: [
                        {
                          expiresAt: "asc",
                        },
                        {
                          receivedAt: "asc",
                        },
                      ],
                    },
                  },
                },
              },
            },
            steps: {
              orderBy: {
                sequence: "asc",
              },
            },
          },
        },
        compensationRule: {
          include: {
            pools: {
              include: {
                shares: true,
              },
            },
          },
        },
      },
    });

    if (!service) {
      throw new TreatmentProgressError(
        "missing",
        "Treatment service is not available in the current scope.",
      );
    }

    const consultantId = input.consultantId?.trim() || service.createdById;
    const clinicalSupportId = input.clinicalSupportId?.trim() || null;
    const assistantPrimaryId = input.assistantPrimaryId?.trim() || null;
    const assistantSecondaryId = input.assistantSecondaryId?.trim() || null;
    const participantIds = [
      consultantId,
      performedById,
      clinicalSupportId,
      assistantPrimaryId,
      assistantSecondaryId,
    ].filter(Boolean) as string[];
    const uniqueParticipantIds = Array.from(new Set(participantIds));
    const validParticipantCount = await tx.user.count({
      where: {
        id: {
          in: uniqueParticipantIds,
        },
        organizationId: session.organizationId,
        active: true,
        roleAssignments: {
          some: {
            active: true,
            role: {
              not: "PATIENT",
            },
            OR: [
              {
                clinicId: null,
              },
              {
                clinicId: service.clinicId,
              },
            ],
          },
        },
      },
    });

    if (validParticipantCount !== uniqueParticipantIds.length) {
      throw new TreatmentProgressError(
        "missing",
        "One or more treatment participants are outside the active clinic scope.",
      );
    }

    const fromProgressPercent = Number(service.currentProgressPercent);

    if (toProgressPercent < fromProgressPercent) {
      throw new TreatmentProgressError(
        "regression",
        "Treatment progress cannot move backwards.",
      );
    }

    const progressDeltaPercent = Math.max(
      toProgressPercent - fromProgressPercent,
      0,
    );
    const nextStatus: RecordTreatmentProgressResult["status"] =
      toProgressPercent >= 100
        ? "COMPLETED"
        : toProgressPercent > 0
          ? "IN_PROGRESS"
          : "PLANNED";
    const nextStepSequence =
      service.serviceCatalogItem?.steps
        .filter((step) => step.defaultProgress !== null)
        .find(
          (step) =>
            Math.round(Number(step.defaultProgress)) ===
            Math.round(toProgressPercent),
        )?.sequence ?? null;
    const rule = service.compensationRule
      ? ruleInputFromDatabase(service.compensationRule)
      : defaultServiceCompensationRule;
    const compensation =
      progressDeltaPercent > 0
        ? calculateServiceProgressCompensation({
            serviceAmount: Number(service.finalPrice),
            progressDeltaPercent,
            participants: {
              consultantId: consultantId ?? undefined,
              operatorId: performedById,
              clinicalSupportId: clinicalSupportId ?? undefined,
              assistantPrimaryId: assistantPrimaryId ?? undefined,
              assistantSecondaryId: assistantSecondaryId ?? undefined,
            },
            rule,
          })
        : null;
    const occurredAt = new Date();
    const progressEvent = await tx.treatmentServiceProgressEvent.create({
      data: {
        organizationId: session.organizationId,
        clinicId: service.clinicId,
        treatmentServiceId: service.id,
        consultantId,
        performedById,
        clinicalSupportId,
        assistantPrimaryId,
        assistantSecondaryId,
        fromProgressPercent,
        toProgressPercent,
        progressDeltaPercent,
        note: input.note?.trim() || null,
        occurredAt,
      },
      select: {
        id: true,
      },
    });

    if (compensation && compensation.totalCompensationAmount > 0) {
      await tx.compensationAccrual.create({
        data: {
          organizationId: session.organizationId,
          clinicId: service.clinicId,
          treatmentServiceId: service.id,
          progressEventId: progressEvent.id,
          ruleId: service.compensationRuleId,
          ruleCode: service.compensationRuleCode,
          ruleName: service.compensationRuleName,
          ruleVersion: service.compensationRuleVersion,
          ruleSnapshot: rule as unknown as Prisma.InputJsonValue,
          status: "EARNED",
          serviceAmount: service.finalPrice,
          earnedProgressPercent: progressDeltaPercent,
          doctorPoolAmount: compensation.doctorPoolAmount,
          assistantPoolAmount: compensation.assistantPoolAmount,
          totalAmount: compensation.totalCompensationAmount,
          lines: {
            create: compensation.lines.map((line) => ({
              organizationId: session.organizationId,
              clinicId: service.clinicId,
              userId: line.participantId,
              pool: line.pool,
              role: line.role,
              sharePercent: line.sharePercent,
              amount: line.amount,
              resolvedFromFallback: line.resolvedFromFallback,
              sourceRole: line.sourceRole,
            })),
          },
        },
      });
    }

    if (progressDeltaPercent > 0) {
      await consumeServiceMaterials({
        tx,
        session,
        service,
        progressEventId: progressEvent.id,
        progressDeltaPercent,
        performedById,
      });
    }

    await tx.treatmentService.update({
      where: {
        id: service.id,
      },
      data: {
        currentProgressPercent: toProgressPercent,
        currentStepSequence: nextStepSequence,
        status: nextStatus,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "treatment_service.progress_recorded",
        entityType: "TreatmentServiceProgressEvent",
        entityId: progressEvent.id,
        metadata: {
          patientId: service.patientId,
          treatmentServiceId: service.id,
          fromProgressPercent,
          toProgressPercent,
          progressDeltaPercent,
          consultantId,
          performedById,
          clinicalSupportId,
          assistantPrimaryId,
          assistantSecondaryId,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      patientId: service.patientId,
      clinicId: service.clinicId,
      treatmentServiceId: service.id,
      progressEventId: progressEvent.id,
      fromProgressPercent,
      toProgressPercent,
      status: nextStatus,
    };
  });
}

async function consumeServiceMaterials({
  tx,
  session,
  service,
  progressEventId,
  progressDeltaPercent,
  performedById,
}: {
  tx: Prisma.TransactionClient;
  session: AppSession;
  service: {
    clinicId: string;
    id: string;
    serviceCode: string;
    serviceName: string;
    serviceCatalogItem: {
      materials: Array<{
        inventoryItemId: string | null;
        name: string;
        quantity: unknown;
        unit: string | null;
        inventoryItem: {
          id: string;
          name: string;
          unit: string;
          onHandQuantity: unknown;
          minimumStock: unknown;
          lots: Array<{
            id: string;
            quantityOnHand: unknown;
          }>;
        } | null;
      }>;
    } | null;
  };
  progressEventId: string;
  progressDeltaPercent: number;
  performedById: string;
}) {
  const materials = service.serviceCatalogItem?.materials ?? [];

  for (const material of materials) {
    if (!material.inventoryItemId || material.quantity == null) {
      continue;
    }

    const quantity = (Number(material.quantity) * progressDeltaPercent) / 100;

    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    let remainingQuantity = quantity;

    for (const lot of material.inventoryItem?.lots ?? []) {
      if (remainingQuantity <= 0) {
        break;
      }

      const lotQuantity = Number(lot.quantityOnHand);
      const consumedFromLot = Math.min(lotQuantity, remainingQuantity);

      if (consumedFromLot <= 0) {
        continue;
      }

      await tx.inventoryMovement.create({
        data: {
          organizationId: session.organizationId,
          clinicId: service.clinicId,
          itemId: material.inventoryItemId,
          lotId: lot.id,
          performedById: databaseActorId(performedById),
          type: "CONSUMPTION",
          quantity: consumedFromLot,
          referenceType: "TreatmentServiceProgressEvent",
          referenceId: progressEventId,
          note: `${service.serviceCode} · ${service.serviceName}`,
        },
      });

      await tx.inventoryLot.update({
        where: {
          id: lot.id,
        },
        data: {
          quantityOnHand: {
            decrement: consumedFromLot,
          },
        },
      });

      remainingQuantity -= consumedFromLot;
    }

    if (remainingQuantity > 0) {
      await tx.inventoryMovement.create({
        data: {
          organizationId: session.organizationId,
          clinicId: service.clinicId,
          itemId: material.inventoryItemId,
          performedById: databaseActorId(performedById),
          type: "CONSUMPTION",
          quantity: remainingQuantity,
          referenceType: "TreatmentServiceProgressEvent",
          referenceId: progressEventId,
          note: `${service.serviceCode} · ${service.serviceName}`,
        },
      });
    }

    await tx.inventoryItem.update({
      where: {
        id: material.inventoryItemId,
      },
      data: {
        onHandQuantity: {
          decrement: quantity,
        },
      },
    });

    const nextOnHand = Number(material.inventoryItem?.onHandQuantity ?? 0) - quantity;
    const minimumStock = Number(material.inventoryItem?.minimumStock ?? 0);

    if (nextOnHand <= minimumStock) {
      await tx.workItem.create({
        data: {
          organizationId: session.organizationId,
          clinicId: service.clinicId,
          sourceKind: "inventory",
          sourceId: material.inventoryItemId,
          priority: nextOnHand <= 0 ? "high" : "medium",
          status: "OPEN",
          title: `Low stock: ${material.inventoryItem?.name ?? material.name}`,
          detail: `${nextOnHand}/${minimumStock} ${material.inventoryItem?.unit ?? material.unit ?? ""}`.trim(),
        },
      });
    }
  }
}

function ruleInputFromDatabase(rule: {
  pools: Array<{
    pool: string;
    percentOfService: unknown;
    shares: Array<{
      role: string;
      sharePercent: unknown;
      fallbackRole: string | null;
    }>;
  }>;
}): ServiceCompensationRuleInput {
  const doctorPool = rule.pools.find((pool) => pool.pool === "DOCTOR");
  const assistantPool = rule.pools.find((pool) => pool.pool === "ASSISTANT");

  return {
    doctorPoolPercent: Number(doctorPool?.percentOfService ?? 0),
    assistantPoolPercent: Number(assistantPool?.percentOfService ?? 0),
    doctorShares: {
      consultantPercent: sharePercent(doctorPool, "CONSULTANT"),
      operatorPercent: sharePercent(doctorPool, "OPERATOR"),
      clinicalSupportPercent: sharePercent(doctorPool, "CLINICAL_SUPPORT"),
    },
    assistantShares: {
      primaryPercent: sharePercent(assistantPool, "ASSISTANT_PRIMARY"),
      secondaryPercent: sharePercent(assistantPool, "ASSISTANT_SECONDARY"),
    },
    fallbackMissingClinicalSupportToOperator: Boolean(
      doctorPool?.shares.find((share) => share.role === "CLINICAL_SUPPORT")
        ?.fallbackRole,
    ),
    fallbackMissingAssistantPrimaryToOperator:
      assistantPool?.shares.find((share) => share.role === "ASSISTANT_PRIMARY")
        ?.fallbackRole === "OPERATOR",
    fallbackMissingAssistantSecondaryToPrimary: Boolean(
      assistantPool?.shares.find((share) => share.role === "ASSISTANT_SECONDARY")
        ?.fallbackRole,
    ),
  };
}

function sharePercent(
  pool:
    | {
        shares: Array<{
          role: string;
          sharePercent: unknown;
        }>;
      }
    | undefined,
  role: string,
) {
  return Number(
    pool?.shares.find((share) => share.role === role)?.sharePercent ?? 0,
  );
}

function normalizeProgress(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }

  return Math.round(value);
}
