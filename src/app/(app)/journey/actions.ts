"use server";

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import {
  calculateServiceProgressCompensation,
  defaultServiceCompensationRule,
  type ServiceCompensationRuleInput,
} from "@/lib/compensation";
import { databaseActorId, optionalString, parseMoney, requiredString, splitList } from "@/lib/form-validation";
import {
  isUploadedPatientFile,
  patientFileValidationError,
  storePatientUpload,
} from "@/lib/patient-file-storage";
import { patientAccessWhere } from "@/lib/patient-access";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { runSerializableTransaction } from "@/lib/transaction";

const MAX_JOURNEY_COMMENT_FILES = 10;

function journeyRedirect(notice: string, patientId?: string | null) {
  const params = new URLSearchParams({ notice });

  if (patientId) {
    params.set("patientId", patientId);
  }

  return `/journey?${params.toString()}`;
}

export async function updateJourneyStateAction(formData: FormData) {
  const session = await requireViewSession("journey");

  if (!canPerformAction(session, "treatment.plan.create")) {
    redirect("/journey?notice=journey-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const stateRedirect = (notice: string) => journeyRedirect(notice, patientId);
  const treatmentGoal = optionalString(formData.get("treatmentGoal"));
  const treatmentPlan = optionalString(formData.get("treatmentPlan"));
  const odontogramTeeth = splitList(formData.get("odontogramTeeth"), /[\n,]/);

  if (!patientId) {
    redirect(stateRedirect("journey-state-missing"));
  }

  try {
    const patient = await prisma.patient.findFirst({
      where: {
        ...patientAccessWhere(session),
        id: patientId,
      },
      select: {
        id: true,
        clinicId: true,
      },
    });

    if (!patient) {
      redirect(stateRedirect("journey-state-missing"));
    }

    const state = await prisma.patientJourneyState.upsert({
      where: {
        patientId: patient.id,
      },
      update: {
        clinicId: patient.clinicId,
        treatmentGoal,
        treatmentPlan,
        odontogramTeeth,
        odontogramSnapshot: {
          selectedTargets: odontogramTeeth,
        } as Prisma.InputJsonValue,
        updatedById: databaseActorId(session.userId),
      },
      create: {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        treatmentGoal,
        treatmentPlan,
        odontogramTeeth,
        odontogramSnapshot: {
          selectedTargets: odontogramTeeth,
        } as Prisma.InputJsonValue,
        updatedById: databaseActorId(session.userId),
      },
      select: {
        id: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "journey.state_updated",
        entityType: "PatientJourneyState",
        entityId: state.id,
        metadata: {
          patientId: patient.id,
          odontogramTeeth,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    console.error("journey.state_update_failed", error);
    redirect(stateRedirect("journey-database"));
  }

  revalidatePath("/journey");
  redirect(stateRedirect("journey-state-saved"));
}

export async function createJourneyCommentAction(formData: FormData) {
  const session = await requireViewSession("journey");

  if (!canPerformAction(session, "patient.update")) {
    redirect("/journey?notice=journey-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const commentRedirect = (notice: string) => journeyRedirect(notice, patientId);
  const body = requiredString(formData.get("body"));
  const uploadedFiles = formData
    .getAll("file")
    .filter(isUploadedPatientFile);
  const hasUpload = uploadedFiles.length > 0;

  if (!patientId || (!body && !hasUpload)) {
    redirect(commentRedirect("journey-comment-missing"));
  }

  if (uploadedFiles.length > MAX_JOURNEY_COMMENT_FILES) {
    redirect(commentRedirect("files-too-many"));
  }

  const uploadValidationError = uploadedFiles
    .map(patientFileValidationError)
    .find(Boolean);

  if (uploadValidationError) {
    redirect(commentRedirect(uploadValidationError));
  }

  try {
    const patient = await prisma.patient.findFirst({
      where: {
        ...patientAccessWhere(session),
        id: patientId,
      },
      select: {
        id: true,
        clinicId: true,
      },
    });

    if (!patient) {
      redirect(commentRedirect("journey-comment-missing"));
    }

    const commentId = randomUUID();
    const storedAttachments = await Promise.all(
      uploadedFiles.map(async (uploadedFile, index) => {
        const patientFileId = randomUUID();
        const storedUpload = await storePatientUpload({
          file: uploadedFile,
          organizationId: session.organizationId,
          patientId: patient.id,
          patientFileId,
        });

        return {
          index,
          patientFileId,
          storedUpload,
          attachmentUrl: `/patient-files/${patientFileId}`,
        };
      }),
    );
    const firstStoredAttachment = storedAttachments[0] ?? null;
    const commentBody =
      body ||
      uploadedFiles
        .map((file) => file.name)
        .filter(Boolean)
        .join(", ") ||
      "File đính kèm";

    await prisma.$transaction(async (tx) => {
      const createdFiles = await Promise.all(
        storedAttachments.map((attachment) =>
          tx.patientFile.create({
            data: {
              id: attachment.patientFileId,
              organizationId: session.organizationId,
              clinicId: patient.clinicId,
              patientId: patient.id,
              uploadedById: databaseActorId(session.userId),
              category: "TIMELINE_COMMENT",
              title: commentBody.slice(0, 80),
              url: attachment.attachmentUrl,
              fileName: attachment.storedUpload.fileName,
              mimeType: attachment.storedUpload.mimeType,
              sizeBytes: attachment.storedUpload.sizeBytes,
              notes: commentBody,
              sourceType:
                attachment.storedUpload.storageProvider === "r2"
                  ? "R2_UPLOAD"
                  : "LOCAL_UPLOAD",
              sourceId: attachment.storedUpload.relativePath,
              storageProvider: attachment.storedUpload.storageProvider,
              storageKey: attachment.storedUpload.storageKey,
              checksumSha256: attachment.storedUpload.checksumSha256,
              previewUrl: attachment.storedUpload.preview
                ? `${attachment.attachmentUrl}?variant=preview`
                : null,
              previewMimeType: attachment.storedUpload.preview?.mimeType ?? null,
              previewSizeBytes: attachment.storedUpload.preview?.sizeBytes ?? null,
              previewStorageKey: attachment.storedUpload.preview?.storageKey ?? null,
              thumbnailUrl: attachment.storedUpload.thumbnail
                ? `${attachment.attachmentUrl}?variant=thumbnail`
                : null,
              thumbnailMimeType: attachment.storedUpload.thumbnail?.mimeType ?? null,
              thumbnailSizeBytes: attachment.storedUpload.thumbnail?.sizeBytes ?? null,
              thumbnailStorageKey: attachment.storedUpload.thumbnail?.storageKey ?? null,
              virusScanStatus: "NOT_SCANNED",
            },
            select: {
              id: true,
            },
          }),
        ),
      );

      await tx.journeyComment.create({
        data: {
          id: commentId,
          organizationId: session.organizationId,
          clinicId: patient.clinicId,
          patientId: patient.id,
          authorId: databaseActorId(session.userId),
          body: commentBody,
          attachmentUrl: firstStoredAttachment?.attachmentUrl ?? null,
          attachmentName: firstStoredAttachment?.storedUpload.fileName ?? null,
          attachmentMime: firstStoredAttachment?.storedUpload.mimeType ?? null,
          patientFileId: createdFiles[0]?.id ?? null,
          attachments: {
            create: storedAttachments.map((attachment, index) => ({
              patientFileId: createdFiles[index]?.id ?? attachment.patientFileId,
              url: attachment.attachmentUrl,
              name: attachment.storedUpload.fileName,
              mimeType: attachment.storedUpload.mimeType,
              fileKind: attachment.storedUpload.fileKind,
              sizeBytes: attachment.storedUpload.sizeBytes,
              previewUrl: attachment.storedUpload.preview
                ? `${attachment.attachmentUrl}?variant=preview`
                : null,
              thumbnailUrl: attachment.storedUpload.thumbnail
                ? `${attachment.attachmentUrl}?variant=thumbnail`
                : null,
              sortOrder: attachment.index,
            })),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "journey.comment_created",
          entityType: "JourneyComment",
          entityId: commentId,
          metadata: {
            patientId: patient.id,
            patientFileIds: createdFiles.map((file) => file.id),
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    console.error("journey.comment_create_failed", error);
    redirect(commentRedirect("journey-database"));
  }

  revalidatePath("/journey");
  redirect(commentRedirect("journey-comment-created"));
}

export async function createJourneyTreatmentServicesAction(formData: FormData) {
  const session = await requireViewSession("journey");

  if (!canPerformAction(session, "treatment.plan.create") || session.userId.startsWith("demo-")) {
    redirect("/journey?notice=journey-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const serviceRedirect = (notice: string) => journeyRedirect(notice, patientId);
  const serviceCatalogItemId = requiredString(formData.get("serviceCatalogItemId"));
  const diagnosis = requiredString(formData.get("diagnosis"));
  const targets = splitTargets(formData.get("targets"));

  if (!patientId || !serviceCatalogItemId || targets.length === 0) {
    redirect(serviceRedirect("journey-service-missing"));
  }

  try {
    const [patient, catalogItem] = await Promise.all([
      prisma.patient.findFirst({
        where: {
          ...patientAccessWhere(session),
          id: patientId,
        },
        select: {
          id: true,
          clinicId: true,
        },
      }),
      prisma.serviceCatalogItem.findFirst({
        where: {
          id: serviceCatalogItemId,
          organizationId: session.organizationId,
          status: "ACTIVE",
        },
        include: {
          defaultCompensationRule: true,
        },
      }),
    ]);

    if (!patient || !catalogItem) {
      redirect(serviceRedirect("journey-service-missing"));
    }

    await prisma.$transaction(async (tx) => {
      const existingCount = await tx.treatmentService.count({
        where: {
          patientId,
          serviceCatalogItemId,
        },
      });

      for (const [index, target] of targets.entries()) {
        const sequence = existingCount + index + 1;
        const serviceCode = `${patientCodeFromId(patient.id)}-${catalogItem.code}${padCodeNumber(sequence, 2)}`;

        await tx.treatmentService.create({
          data: {
            organizationId: session.organizationId,
            clinicId: patient.clinicId,
            patientId,
            serviceCatalogItemId: catalogItem.id,
            compensationRuleId: catalogItem.defaultCompensationRuleId,
            compensationRuleCode: catalogItem.defaultCompensationRule?.code ?? null,
            compensationRuleName: catalogItem.defaultCompensationRule?.name ?? null,
            compensationRuleVersion:
              catalogItem.defaultCompensationRule?.version ?? null,
            createdById: session.userId,
            serviceCode,
            serviceName: catalogItem.name,
            targetSummary: diagnosis,
            teeth: targetToTeeth(target),
            status: "PLANNED",
            finalPrice: catalogItem.defaultPrice,
            currentProgressPercent: 0,
          },
        });
      }

      await tx.patientJourneyState.updateMany({
        where: {
          patientId: patient.id,
          organizationId: session.organizationId,
        },
        data: {
          odontogramTeeth: [],
          odontogramSnapshot: {
            selectedTargets: [],
          } as Prisma.InputJsonValue,
          updatedById: databaseActorId(session.userId),
        },
      });
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "journey.treatment_services_created",
        entityType: "TreatmentService",
        entityId: patientId,
        metadata: {
          serviceCatalogItemId,
          targets,
          diagnosis,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect(serviceRedirect("journey-database"));
  }

  revalidatePath("/journey");
  revalidatePath("/billing");
  revalidatePath("/staff");
  redirect(serviceRedirect("journey-service-created"));
}

export async function updateJourneyTreatmentServiceDiscountAction(formData: FormData) {
  const session = await requireViewSession("journey");

  if (!canPerformAction(session, "treatment.plan.create")) {
    redirect("/journey?notice=journey-denied");
  }

  const patientId = optionalString(formData.get("patientId"));
  const treatmentServiceId = requiredString(formData.get("treatmentServiceId"));
  const discount = Math.max(parseMoney(formData.get("discount")) ?? 0, 0);
  const serviceRedirect = (notice: string) => journeyRedirect(notice, patientId);

  if (!treatmentServiceId) {
    redirect(serviceRedirect("journey-service-missing"));
  }

  try {
    const service = await prisma.treatmentService.findFirst({
      where: {
        id: treatmentServiceId,
        organizationId: session.organizationId,
        clinicId: {
          in: session.clinicIds,
        },
      },
      include: {
        serviceCatalogItem: {
          select: {
            defaultPrice: true,
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
        receiptAllocations: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!service) {
      redirect(serviceRedirect("journey-service-missing"));
    }

    const activeInvoiceTotal = service.invoiceItems
      .filter((item) => item.invoice.status !== "VOID")
      .reduce((total, item) => total + Number(item.amount), 0);

    if (activeInvoiceTotal > 0 || service.receiptAllocations.length > 0) {
      redirect(serviceRedirect("journey-service-price-locked"));
    }

    const listPrice = Number(service.serviceCatalogItem?.defaultPrice ?? service.finalPrice);
    const finalPrice = Math.max(listPrice - Math.min(discount, listPrice), 0);

    await prisma.$transaction([
      prisma.treatmentService.update({
        where: {
          id: service.id,
        },
        data: {
          finalPrice,
        },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "journey.treatment_service_discount_updated",
          entityType: "TreatmentService",
          entityId: service.id,
          metadata: {
            patientId: service.patientId,
            listPrice,
            discount: Math.min(discount, listPrice),
            finalPrice,
          } as Prisma.InputJsonValue,
        },
      }),
    ]);
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect(serviceRedirect("journey-database"));
  }

  revalidatePath("/journey");
  revalidatePath("/billing");
  revalidatePath("/staff");
  redirect(serviceRedirect("journey-discount-updated"));
}

export async function deleteJourneyTreatmentServiceAction(formData: FormData) {
  const session = await requireViewSession("journey");

  if (!canPerformAction(session, "treatment.service.delete")) {
    redirect("/journey?notice=journey-denied");
  }

  let redirectPatientId = optionalString(formData.get("patientId"));
  const treatmentServiceId = requiredString(formData.get("treatmentServiceId"));
  const serviceRedirect = (notice: string) => journeyRedirect(notice, redirectPatientId);

  if (!treatmentServiceId) {
    redirect(serviceRedirect("journey-service-missing"));
  }

  try {
    const service = await prisma.treatmentService.findFirst({
      where: {
        id: treatmentServiceId,
        organizationId: session.organizationId,
        clinicId: {
          in: session.clinicIds,
        },
      },
      select: {
        id: true,
        patientId: true,
        serviceCode: true,
        serviceName: true,
        status: true,
        currentProgressPercent: true,
        invoiceItems: {
          select: {
            id: true,
          },
        },
        receiptAllocations: {
          select: {
            id: true,
          },
        },
        progressEvents: {
          select: {
            id: true,
          },
          take: 1,
        },
        compensationAccruals: {
          select: {
            id: true,
          },
          take: 1,
        },
      },
    });

    if (!service) {
      redirect(serviceRedirect("journey-service-missing"));
    }

    redirectPatientId = service.patientId;

    const hasClinicalOrFinancialHistory =
      service.status !== "PLANNED" ||
      Number(service.currentProgressPercent) > 0 ||
      service.invoiceItems.length > 0 ||
      service.receiptAllocations.length > 0 ||
      service.progressEvents.length > 0 ||
      service.compensationAccruals.length > 0;

    if (hasClinicalOrFinancialHistory) {
      redirect(serviceRedirect("journey-service-delete-locked"));
    }

    await prisma.$transaction([
      prisma.treatmentService.delete({
        where: {
          id: service.id,
        },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "journey.treatment_service_deleted",
          entityType: "TreatmentService",
          entityId: service.id,
          metadata: {
            patientId: service.patientId,
            serviceCode: service.serviceCode,
            serviceName: service.serviceName,
          } as Prisma.InputJsonValue,
        },
      }),
    ]);
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect(serviceRedirect("journey-database"));
  }

  revalidatePath("/journey");
  revalidatePath("/billing");
  revalidatePath("/staff");
  redirect(serviceRedirect("journey-service-deleted"));
}

export async function recordJourneyServiceProgressAction(formData: FormData) {
  const session = await requireViewSession("journey");

  if (!canPerformAction(session, "treatment.service.progress")) {
    redirect("/journey?notice=journey-denied");
  }

  const treatmentServiceId = requiredString(formData.get("treatmentServiceId"));
  const patientId = optionalString(formData.get("patientId"));
  const progressRedirect = (notice: string) => journeyRedirect(notice, patientId);
  const consultantFieldPresent = formData.has("consultantId");
  const requestedConsultantId = optionalString(formData.get("consultantId"));
  const performedById =
    requiredString(formData.get("performedById")) || session.userId;
  const clinicalSupportId = optionalString(formData.get("clinicalSupportId"));
  const assistantPrimaryId = optionalString(formData.get("assistantPrimaryId"));
  const assistantSecondaryId = optionalString(formData.get("assistantSecondaryId"));
  const note = optionalString(formData.get("note"));
  const toProgressPercent = parseProgress(formData.get("toProgressPercent"));

  if (!treatmentServiceId || !performedById || toProgressPercent === null) {
    redirect(progressRedirect("journey-progress-missing"));
  }

  try {
    await runSerializableTransaction(async (tx) => {
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
        redirect(progressRedirect("journey-progress-missing"));
      }

      const consultantId = consultantFieldPresent
        ? requestedConsultantId
        : service.createdById;
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
        redirect(progressRedirect("journey-progress-missing"));
      }

      const fromProgressPercent = Number(service.currentProgressPercent);
      if (toProgressPercent < fromProgressPercent) {
        redirect(progressRedirect("journey-progress-regression"));
      }

      const progressDeltaPercent = Math.max(toProgressPercent - fromProgressPercent, 0);
      const nextStatus =
        toProgressPercent >= 100
          ? "COMPLETED"
          : toProgressPercent > 0
            ? "IN_PROGRESS"
            : "PLANNED";
      const nextStepSequence =
        service.serviceCatalogItem?.steps
          .filter((step) => step.defaultProgress !== null)
          .find((step) => Math.round(Number(step.defaultProgress)) === Math.round(toProgressPercent))
          ?.sequence ?? null;
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
          note,
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
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect(progressRedirect("journey-database"));
  }

  revalidatePath("/journey");
  revalidatePath("/staff");
  revalidatePath("/employee-app");
  revalidatePath("/inventory");
  redirect(progressRedirect("journey-progress-recorded"));
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
      steps?: Array<{
        sequence: number;
        defaultProgress: unknown;
      }>;
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
  return Number(pool?.shares.find((share) => share.role === role)?.sharePercent ?? 0);
}

function splitTargets(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/\n/)
    .map((target) => target.trim())
    .filter(Boolean);
}

function targetToTeeth(target: string) {
  const toothMatches = target.match(/R\d{2}/g);

  return toothMatches && toothMatches.length > 0 ? toothMatches : [target];
}

function parseProgress(value: FormDataEntryValue | null) {
  const progress = Number(String(value ?? ""));

  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    return null;
  }

  return Math.round(progress);
}

function stableNumberFromText(value: string, max: number) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % max;
  }

  return hash + 1;
}

function patientCodeFromId(patientId: string) {
  const numericId = patientId.match(/\d+/g)?.join("");
  const sequence = numericId
    ? Number(numericId.slice(-6))
    : stableNumberFromText(patientId, 999999);

  return `PT${padCodeNumber(sequence || 0, 6)}`;
}

function padCodeNumber(value: number, length: number) {
  return String(Math.max(Math.round(value), 0)).padStart(length, "0");
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}
