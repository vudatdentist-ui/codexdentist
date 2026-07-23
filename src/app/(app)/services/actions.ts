"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { hasAnyRole } from "@/lib/permissions";
import {
  databaseActorId,
  optionalString,
  parseMoney,
  requiredString,
} from "@/lib/form-validation";
import type { AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const mutableServiceRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "BILLING",
];

const serviceStatuses = ["DRAFT", "ACTIVE", "RETIRED"] as const;

export async function createServiceCatalogItemAction(formData: FormData) {
  const session = await requireViewSession("services");

  if (!canWriteServices(session)) {
    redirect("/services?notice=services-denied");
  }

  const code = requiredString(formData.get("code")).toUpperCase();
  const name = requiredString(formData.get("name"));
  const nameEn = optionalString(formData.get("nameEn"));
  const categoryId = requiredString(formData.get("categoryId"));
  const defaultCompensationRuleId = optionalString(
    formData.get("defaultCompensationRuleId"),
  );
  const defaultPrice = parseMoney(formData.get("defaultPrice"));
  const defaultDurationMinutes = parseOptionalInteger(
    formData.get("defaultDurationMinutes"),
  );
  const targetMode = requiredString(formData.get("targetMode")) || "TOOTH";

  if (!code || !name || !categoryId || defaultPrice === null) {
    redirect("/services?notice=services-missing");
  }

  try {
    const category = await findScopedCategory(session, categoryId);
    const policy = defaultCompensationRuleId
      ? await findScopedPolicy(session, defaultCompensationRuleId)
      : null;

    if (!category || (defaultCompensationRuleId && !policy)) {
      redirect("/services?notice=services-missing");
    }

    const service = await prisma.serviceCatalogItem.create({
      data: {
        organizationId: session.organizationId,
        categoryId,
        code,
        name,
        nameEn,
        defaultPrice,
        defaultDurationMinutes,
        targetMode,
        defaultCompensationRuleId: policy?.id ?? null,
        status: "ACTIVE",
        prices: {
          create: {
            organizationId: session.organizationId,
            price: defaultPrice,
            currency: "VND",
            active: true,
            note: "Initial price",
          },
        },
        steps: {
          create: [
            {
              organizationId: session.organizationId,
              sequence: 1,
              name: "Tư vấn và chuẩn bị",
              description: "Xác nhận chỉ định, mục tiêu điều trị, chi phí và chuẩn bị bệnh nhân.",
              defaultProgress: 20,
              expectedMinutes: 20,
            },
            {
              organizationId: session.organizationId,
              sequence: 2,
              name: "Thực hiện điều trị",
              description: "Thực hiện phần kỹ thuật chính của dịch vụ theo chỉ định chuyên môn.",
              defaultProgress: 70,
              expectedMinutes: 45,
            },
            {
              organizationId: session.organizationId,
              sequence: 3,
              name: "Hoàn tất và dặn dò",
              description: "Kiểm tra kết quả, lưu hồ sơ, dặn chăm sóc và hẹn tái khám nếu cần.",
              defaultProgress: 100,
              expectedMinutes: 30,
            },
          ],
        },
      },
      select: {
        id: true,
      },
    });

    await writeServicesAuditLog({
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action: "service.created",
      entityType: "ServiceCatalogItem",
      entityId: service.id,
      metadata: {
        code,
        name,
        defaultPrice,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/services?notice=services-database");
  }

  revalidatePath("/services");
  revalidatePath("/journey");
  redirect("/services?notice=services-created");
}

export async function updateServiceCatalogItemAction(formData: FormData) {
  const session = await requireViewSession("services");

  if (!canWriteServices(session)) {
    redirect("/services?notice=services-denied");
  }

  const serviceId = requiredString(formData.get("serviceId"));
  const name = requiredString(formData.get("name"));
  const nameEn = optionalString(formData.get("nameEn"));
  const defaultPrice = parseMoney(formData.get("defaultPrice"));
  const defaultDurationMinutes = parseOptionalInteger(
    formData.get("defaultDurationMinutes"),
  );
  const defaultCompensationRuleId = optionalString(
    formData.get("defaultCompensationRuleId"),
  );
  const status = requiredString(formData.get("status"));

  if (
    !serviceId ||
    !name ||
    defaultPrice === null ||
    !serviceStatuses.includes(status as (typeof serviceStatuses)[number])
  ) {
    redirect("/services?notice=services-missing");
  }

  try {
    const service = await findScopedService(session, serviceId);
    const policy = defaultCompensationRuleId
      ? await findScopedPolicy(session, defaultCompensationRuleId)
      : null;

    if (!service || (defaultCompensationRuleId && !policy)) {
      redirect("/services?notice=services-not-found");
    }

    if (status === "RETIRED" && service.status !== "RETIRED" && !canDeleteServices(session)) {
      redirect("/services?notice=services-denied");
    }

    await prisma.$transaction(async (tx) => {
      await tx.serviceCatalogItem.update({
        where: {
          id: serviceId,
        },
        data: {
          name,
          nameEn,
          defaultPrice,
          defaultDurationMinutes,
          defaultCompensationRuleId: policy?.id ?? null,
          status: status as (typeof serviceStatuses)[number],
        },
      });

      const activePrice = await tx.servicePrice.findFirst({
        where: {
          organizationId: session.organizationId,
          serviceId,
          clinicId: null,
          active: true,
        },
        orderBy: {
          effectiveFrom: "desc",
        },
        select: {
          id: true,
          price: true,
        },
      });

      if (!activePrice) {
        await tx.servicePrice.create({
          data: {
            organizationId: session.organizationId,
            serviceId,
            price: defaultPrice,
            currency: "VND",
            active: true,
            note: "Default price",
          },
        });
      } else if (Number(activePrice.price) !== defaultPrice) {
        await tx.servicePrice.update({
          where: {
            id: activePrice.id,
          },
          data: {
            price: defaultPrice,
          },
        });
      }
    });

    await writeServicesAuditLog({
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action: "service.updated",
      entityType: "ServiceCatalogItem",
      entityId: serviceId,
      metadata: {
        name,
        defaultPrice,
        status,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/services?notice=services-database");
  }

  revalidatePath("/services");
  revalidatePath("/journey");
  redirect("/services?notice=services-updated");
}

export async function deleteServiceCatalogItemAction(formData: FormData) {
  const session = await requireViewSession("services");

  if (!canDeleteServices(session)) {
    redirect("/services?notice=services-denied");
  }

  const serviceId = requiredString(formData.get("serviceId"));

  if (!serviceId) {
    redirect("/services?notice=services-not-found");
  }

  try {
    const service = await prisma.serviceCatalogItem.findFirst({
      where: {
        id: serviceId,
        organizationId: session.organizationId,
      },
      select: {
        id: true,
        code: true,
        name: true,
        _count: {
          select: {
            treatmentServices: true,
          },
        },
      },
    });

    if (!service) {
      redirect("/services?notice=services-not-found");
    }

    const hasHistoricalUse = service._count.treatmentServices > 0;

    await prisma.$transaction(async (tx) => {
      if (hasHistoricalUse) {
        await tx.serviceCatalogItem.update({
          where: {
            id: service.id,
          },
          data: {
            status: "RETIRED",
          },
        });
        await tx.servicePrice.updateMany({
          where: {
            organizationId: session.organizationId,
            serviceId: service.id,
            active: true,
          },
          data: {
            active: false,
            effectiveTo: new Date(),
          },
        });
      } else {
        await tx.serviceCatalogItem.delete({
          where: {
            id: service.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: hasHistoricalUse ? "service.retired" : "service.deleted",
          entityType: "ServiceCatalogItem",
          entityId: service.id,
          metadata: {
            code: service.code,
            name: service.name,
            historicalUse: hasHistoricalUse,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/services?notice=services-database");
  }

  revalidatePath("/services");
  revalidatePath("/journey");
  redirect("/services?notice=services-deleted");
}

export async function addServiceStepAction(formData: FormData) {
  const session = await requireViewSession("services");

  if (!canWriteServices(session)) {
    redirect("/services?notice=services-denied");
  }

  const serviceId = requiredString(formData.get("serviceId"));
  const name = requiredString(formData.get("name"));
  const description = optionalString(formData.get("description"));
  const defaultProgress = parseOptionalInteger(formData.get("defaultProgress"));
  const expectedMinutes = parseOptionalInteger(formData.get("expectedMinutes"));

  if (!serviceId || !name) {
    redirect("/services?notice=services-missing");
  }

  try {
    const service = await findScopedService(session, serviceId);

    if (!service) {
      redirect("/services?notice=services-not-found");
    }

    await prisma.$transaction(async (tx) => {
      await tx.serviceStep.create({
        data: {
          organizationId: session.organizationId,
          serviceId,
          sequence: 10000,
          name,
          description,
          defaultProgress,
          expectedMinutes,
        },
      });

      await reorderServiceSteps(tx, serviceId);
    });

    await writeServicesAuditLog({
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action: "service.step_added",
      entityType: "ServiceCatalogItem",
      entityId: serviceId,
      metadata: {
        name,
        defaultProgress,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/services?notice=services-database");
  }

  revalidatePath("/services");
  revalidatePath("/journey");
  redirect("/services?notice=services-step-added");
}

export async function updateServiceStepAction(formData: FormData) {
  const session = await requireViewSession("services");

  if (!canWriteServices(session)) {
    redirect("/services?notice=services-denied");
  }

  const stepId = requiredString(formData.get("stepId"));
  const name = requiredString(formData.get("name"));
  const description = optionalString(formData.get("description"));
  const defaultProgress = parseOptionalInteger(formData.get("defaultProgress"));
  const expectedMinutes = parseOptionalInteger(formData.get("expectedMinutes"));

  if (!stepId || !name) {
    redirect("/services?notice=services-missing");
  }

  try {
    const step = await prisma.serviceStep.findFirst({
      where: {
        id: stepId,
        organizationId: session.organizationId,
      },
      select: {
        id: true,
        serviceId: true,
      },
    });

    if (!step) {
      redirect("/services?notice=services-not-found");
    }

    await prisma.$transaction(async (tx) => {
      await tx.serviceStep.update({
        where: {
          id: step.id,
        },
        data: {
          name,
          description,
          defaultProgress,
          expectedMinutes,
        },
      });

      await reorderServiceSteps(tx, step.serviceId);
    });

    await writeServicesAuditLog({
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action: "service.step_updated",
      entityType: "ServiceStep",
      entityId: step.id,
      metadata: {
        serviceId: step.serviceId,
        name,
        defaultProgress,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/services?notice=services-database");
  }

  revalidatePath("/services");
  revalidatePath("/journey");
  redirect("/services?notice=services-step-updated");
}

export async function addServiceMaterialAction(formData: FormData) {
  const session = await requireViewSession("services");

  if (!canWriteServices(session)) {
    redirect("/services?notice=services-denied");
  }

  const serviceId = requiredString(formData.get("serviceId"));
  const inventoryItemId = optionalString(formData.get("inventoryItemId"));
  const name = requiredString(formData.get("name"));
  const quantity = parseMoney(formData.get("quantity"));
  const unit = optionalString(formData.get("unit"));
  const required = requiredString(formData.get("required")) === "on";

  if (!serviceId || !name || quantity === null || quantity <= 0) {
    redirect("/services?notice=services-material-missing");
  }

  try {
    const [service, inventoryItem] = await Promise.all([
      findScopedService(session, serviceId),
      inventoryItemId
        ? prisma.inventoryItem.findFirst({
            where: {
              id: inventoryItemId,
              organizationId: session.organizationId,
              OR: [
                {
                  clinicId: null,
                },
                {
                  clinicId: {
                    in: session.clinicIds,
                  },
                },
              ],
            },
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
            },
          })
        : null,
    ]);

    if (!service || (inventoryItemId && !inventoryItem)) {
      redirect("/services?notice=services-not-found");
    }

    const material = await prisma.serviceMaterial.create({
      data: {
        organizationId: session.organizationId,
        serviceId,
        inventoryItemId: inventoryItem?.id ?? null,
        itemCode: inventoryItem?.code ?? optionalString(formData.get("itemCode")),
        name: inventoryItem?.name ?? name,
        quantity,
        unit: inventoryItem?.unit ?? unit,
        required,
        note: optionalString(formData.get("note")),
      },
      select: {
        id: true,
      },
    });

    await writeServicesAuditLog({
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action: "service.material_added",
      entityType: "ServiceMaterial",
      entityId: material.id,
      metadata: {
        serviceId,
        inventoryItemId: inventoryItem?.id ?? null,
        quantity,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/services?notice=services-database");
  }

  revalidatePath("/services");
  revalidatePath("/inventory");
  redirect("/services?notice=services-material-added");
}

export async function createCompensationPolicyAction(formData: FormData) {
  const session = await requireViewSession("services");

  if (!canWriteServices(session)) {
    redirect("/services?notice=services-denied");
  }

  const code = requiredString(formData.get("code")).toUpperCase();
  const name = requiredString(formData.get("name"));
  const version = requiredString(formData.get("version")) || "1";
  const doctorPoolPercent = parsePercent(formData.get("doctorPoolPercent"));
  const assistantPoolPercent = parsePercent(formData.get("assistantPoolPercent"));
  const consultantSharePercent = parsePercent(
    formData.get("consultantSharePercent"),
  );
  const operatorSharePercent = parsePercent(formData.get("operatorSharePercent"));
  const clinicalSupportSharePercent = parsePercent(
    formData.get("clinicalSupportSharePercent"),
  );
  const assistantPrimarySharePercent = parsePercent(
    formData.get("assistantPrimarySharePercent"),
  );
  const assistantSecondarySharePercent = parsePercent(
    formData.get("assistantSecondarySharePercent"),
  );
  const doctorShareTotal =
    consultantSharePercent + operatorSharePercent + clinicalSupportSharePercent;
  const assistantShareTotal =
    assistantPrimarySharePercent + assistantSecondarySharePercent;

  if (!code || !name) {
    redirect("/services?notice=services-missing");
  }

  if (doctorShareTotal > 100 || assistantShareTotal > 100) {
    redirect("/services?notice=services-policy-share-over");
  }

  try {
    const policy = await prisma.serviceCompensationRule.create({
      data: {
        organizationId: session.organizationId,
        code,
        name,
        version,
        active: true,
        pools: {
          create: [
            {
              pool: "DOCTOR",
              percentOfService: doctorPoolPercent,
              shares: {
                create: [
                  {
                    role: "CONSULTANT",
                    sharePercent: consultantSharePercent,
                    required: false,
                  },
                  {
                    role: "OPERATOR",
                    sharePercent: operatorSharePercent,
                    required: true,
                  },
                  {
                    role: "CLINICAL_SUPPORT",
                    sharePercent: clinicalSupportSharePercent,
                    fallbackRole: "OPERATOR",
                    required: false,
                  },
                ],
              },
            },
            {
              pool: "ASSISTANT",
              percentOfService: assistantPoolPercent,
              shares: {
                create: [
                  {
                    role: "ASSISTANT_PRIMARY",
                    sharePercent: assistantPrimarySharePercent,
                    required: false,
                  },
                  {
                    role: "ASSISTANT_SECONDARY",
                    sharePercent: assistantSecondarySharePercent,
                    fallbackRole: "ASSISTANT_PRIMARY",
                    required: false,
                  },
                ],
              },
            },
          ],
        },
      },
      select: {
        id: true,
      },
    });

    await writeServicesAuditLog({
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action: "compensation_policy.created",
      entityType: "ServiceCompensationRule",
      entityId: policy.id,
      metadata: {
        code,
        name,
        version,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/services?notice=services-database");
  }

  revalidatePath("/services");
  redirect("/services?notice=services-policy-created");
}

export async function deleteCompensationPolicyAction(formData: FormData) {
  const session = await requireViewSession("services");

  if (!canWriteServices(session)) {
    redirect("/services?notice=services-denied");
  }

  const policyId = requiredString(formData.get("policyId"));

  if (!policyId) {
    redirect("/services?notice=services-not-found");
  }

  try {
    const policy = await prisma.serviceCompensationRule.findFirst({
      where: {
        id: policyId,
        organizationId: session.organizationId,
        serviceId: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        _count: {
          select: {
            accruals: true,
            treatmentServices: true,
          },
        },
      },
    });

    if (!policy) {
      redirect("/services?notice=services-not-found");
    }

    const hasHistoricalUse =
      policy._count.accruals > 0 || policy._count.treatmentServices > 0;

    await prisma.$transaction(async (tx) => {
      await tx.serviceCatalogItem.updateMany({
        where: {
          organizationId: session.organizationId,
          defaultCompensationRuleId: policy.id,
        },
        data: {
          defaultCompensationRuleId: null,
        },
      });

      if (hasHistoricalUse) {
        await tx.serviceCompensationRule.update({
          where: {
            id: policy.id,
          },
          data: {
            active: false,
            effectiveTo: new Date(),
          },
        });
      } else {
        await tx.serviceCompensationRule.delete({
          where: {
            id: policy.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: hasHistoricalUse
            ? "compensation_policy.deactivated"
            : "compensation_policy.deleted",
          entityType: "ServiceCompensationRule",
          entityId: policy.id,
          metadata: {
            code: policy.code,
            name: policy.name,
            historicalUse: hasHistoricalUse,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/services?notice=services-database");
  }

  revalidatePath("/services");
  revalidatePath("/journey");
  redirect("/services?notice=services-policy-deleted");
}

async function findScopedService(session: AppSession, serviceId: string) {
  return prisma.serviceCatalogItem.findFirst({
    where: {
      id: serviceId,
      organizationId: session.organizationId,
    },
    select: {
      id: true,
      status: true,
    },
  });
}

async function reorderServiceSteps(
  client: Prisma.TransactionClient,
  serviceId: string,
) {
  const steps = await client.serviceStep.findMany({
    where: {
      serviceId,
    },
    select: {
      id: true,
      sequence: true,
      defaultProgress: true,
      createdAt: true,
    },
  });
  const orderedSteps = [...steps].sort((left, right) => {
    const leftProgress =
      left.defaultProgress === null ? Number.MAX_SAFE_INTEGER : Number(left.defaultProgress);
    const rightProgress =
      right.defaultProgress === null ? Number.MAX_SAFE_INTEGER : Number(right.defaultProgress);
    const progressDelta = leftProgress - rightProgress;

    if (progressDelta !== 0) {
      return progressDelta;
    }

    const sequenceDelta = left.sequence - right.sequence;

    if (sequenceDelta !== 0) {
      return sequenceDelta;
    }

    return left.createdAt.getTime() - right.createdAt.getTime();
  });

  await Promise.all(
    orderedSteps.map((step, index) =>
      client.serviceStep.update({
        where: {
          id: step.id,
        },
        data: {
          sequence: 1000 + index,
        },
      }),
    ),
  );
  await Promise.all(
    orderedSteps.map((step, index) =>
      client.serviceStep.update({
        where: {
          id: step.id,
        },
        data: {
          sequence: index + 1,
        },
      }),
    ),
  );
}

async function findScopedCategory(session: AppSession, categoryId: string) {
  return prisma.serviceCategory.findFirst({
    where: {
      id: categoryId,
      organizationId: session.organizationId,
    },
    select: {
      id: true,
    },
  });
}

async function findScopedPolicy(session: AppSession, policyId: string) {
  return prisma.serviceCompensationRule.findFirst({
    where: {
      id: policyId,
      organizationId: session.organizationId,
      active: true,
    },
    select: {
      id: true,
    },
  });
}

function canWriteServices(session: AppSession) {
  return hasAnyRole(session, mutableServiceRoles);
}

function canDeleteServices(session: AppSession) {
  return hasAnyRole(session, ["OWNER"]);
}

function parseOptionalInteger(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").replace(/[^\d]/g, ""));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePercent(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").replace(/[^\d.]/g, ""));

  return Number.isFinite(parsed) ? parsed : 0;
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

async function writeServicesAuditLog(input: {
  organizationId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
