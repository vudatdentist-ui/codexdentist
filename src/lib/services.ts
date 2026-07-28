import "server-only";

import { defaultDataSeedEnabled } from "@/lib/env";
import { canUseAllClinics, hasAnyRole, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import {
  serviceCatalog,
  type DentalServiceCatalogItem,
  type DentalServiceCategory,
  type DentalServiceStepDefinition,
} from "@/lib/service-catalog";
import type { AppSession } from "@/lib/session";
import type {
  ServiceCatalogSummary,
  ServiceCategorySummary,
  ServiceCompensationPolicySummary,
  ServiceInventoryItemOption,
  ServicesWorkspace,
  TreatmentServiceSummary,
} from "@/lib/services-types";

const mutableServiceRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "BILLING",
];

type CompensationPoolValue = "DOCTOR" | "ASSISTANT";
type CompensationRoleValue =
  | "CONSULTANT"
  | "OPERATOR"
  | "CLINICAL_SUPPORT"
  | "ASSISTANT_PRIMARY"
  | "ASSISTANT_SECONDARY";

const categoryDefinitions: Array<{
  code: DentalServiceCategory;
  name: string;
  nameEn: string;
}> = [
  { code: "diagnostics", name: "Khám và chẩn đoán", nameEn: "Diagnostics" },
  { code: "preventive", name: "Dự phòng", nameEn: "Preventive" },
  { code: "restorative", name: "Phục hồi", nameEn: "Restorative" },
  { code: "endodontics", name: "Nội nha", nameEn: "Endodontics" },
  { code: "periodontics", name: "Nha chu", nameEn: "Periodontics" },
  { code: "surgery", name: "Phẫu thuật", nameEn: "Surgery" },
  { code: "prosthodontics", name: "Phục hình", nameEn: "Prosthodontics" },
  { code: "implant", name: "Implant", nameEn: "Implant" },
  { code: "orthodontics", name: "Chỉnh nha", nameEn: "Orthodontics" },
  { code: "pediatric", name: "Nha trẻ em", nameEn: "Pediatric" },
  { code: "emergency", name: "Cấp cứu", nameEn: "Emergency" },
];

const serviceCatalogSeedRevision = "2026.05.workflow-v2";

const fallbackServiceStepDefinitions: DentalServiceStepDefinition[] = [
  {
    sequence: 1,
    name: "Tư vấn và chuẩn bị",
    defaultProgress: 20,
    expectedMinutes: 20,
  },
  {
    sequence: 2,
    name: "Thực hiện điều trị",
    defaultProgress: 70,
    expectedMinutes: 45,
  },
  {
    sequence: 3,
    name: "Hoàn tất và dặn dò",
    defaultProgress: 100,
    expectedMinutes: 20,
  },
];

const policyDefinitions = [
  {
    code: "DEFAULT",
    name: "Chính sách chuẩn",
    doctorPoolPercent: 10,
    assistantPoolPercent: 2,
    consultantSharePercent: 20,
    operatorSharePercent: 50,
    clinicalSupportSharePercent: 30,
    assistantPrimarySharePercent: 70,
    assistantSecondarySharePercent: 30,
  },
  {
    code: "PROSTHO",
    name: "Phục hình",
    doctorPoolPercent: 12,
    assistantPoolPercent: 2,
    consultantSharePercent: 30,
    operatorSharePercent: 60,
    clinicalSupportSharePercent: 10,
    assistantPrimarySharePercent: 70,
    assistantSecondarySharePercent: 30,
  },
  {
    code: "IMPLANT",
    name: "Implant",
    doctorPoolPercent: 15,
    assistantPoolPercent: 3,
    consultantSharePercent: 20,
    operatorSharePercent: 60,
    clinicalSupportSharePercent: 20,
    assistantPrimarySharePercent: 70,
    assistantSecondarySharePercent: 30,
  },
  {
    code: "ORTHO",
    name: "Chỉnh nha",
    doctorPoolPercent: 8,
    assistantPoolPercent: 1.5,
    consultantSharePercent: 40,
    operatorSharePercent: 40,
    clinicalSupportSharePercent: 20,
    assistantPrimarySharePercent: 70,
    assistantSecondarySharePercent: 30,
  },
];

export async function getServicesWorkspace(
  session: AppSession,
  options: { patientId?: string } = {},
): Promise<ServicesWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);

    const serviceCount = await prisma.serviceCatalogItem.count({
      where: {
        organizationId: session.organizationId,
      },
    });

    if (defaultDataSeedEnabled() || serviceCount === 0) {
      await ensureServiceCatalogSeed(session.organizationId);
    }

    const [categories, policies, inventoryItems, services, treatmentServices] = await Promise.all([
      prisma.serviceCategory.findMany({
        where: {
          organizationId: session.organizationId,
        },
        orderBy: [
          {
            sortOrder: "asc",
          },
          {
            name: "asc",
          },
        ],
      }),
      prisma.serviceCompensationRule.findMany({
        where: {
          organizationId: session.organizationId,
          serviceId: null,
          active: true,
        },
        include: {
          pools: {
            include: {
              shares: true,
            },
          },
        },
        orderBy: {
          code: "asc",
        },
      }),
      prisma.inventoryItem.findMany({
        where: {
          organizationId: session.organizationId,
          active: true,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        orderBy: {
          code: "asc",
        },
        take: 200,
      }),
      prisma.serviceCatalogItem.findMany({
        where: {
          organizationId: session.organizationId,
        },
        include: {
          category: true,
          defaultCompensationRule: true,
          steps: {
            orderBy: {
              sequence: "asc",
            },
          },
          prices: {
            where: {
              active: true,
            },
            orderBy: {
              effectiveFrom: "desc",
            },
            take: 3,
          },
          materials: {
            include: {
              inventoryItem: {
                select: {
                  code: true,
                  name: true,
                  unit: true,
                },
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
        },
        orderBy: [
          {
            category: {
              sortOrder: "asc",
            },
          },
          {
            code: "asc",
          },
        ],
      }),
      prisma.treatmentService.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          clinicId: {
            in: clinicIds,
          },
        },
        include: {
          createdBy: {
            select: {
              fullName: true,
            },
          },
          serviceCatalogItem: {
            select: {
              code: true,
              defaultPrice: true,
              steps: {
                orderBy: {
                  sequence: "asc",
                },
              },
            },
          },
          progressEvents: {
            include: {
              consultant: {
                select: {
                  fullName: true,
                },
              },
              performedBy: {
                select: {
                  fullName: true,
                },
              },
              clinicalSupport: {
                select: {
                  fullName: true,
                },
              },
              assistantPrimary: {
                select: {
                  fullName: true,
                },
              },
              assistantSecondary: {
                select: {
                  fullName: true,
                },
              },
              compensationAccrual: {
                select: {
                  totalAmount: true,
                },
              },
            },
            orderBy: {
              occurredAt: "desc",
            },
            take: 6,
          },
          receiptAllocations: {
            include: {
              receipt: {
                select: {
                  method: true,
                },
              },
            },
          },
          invoiceItems: {
            include: {
              invoice: {
                select: {
                  invoiceNo: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy: [
          {
            createdAt: "asc",
          },
          {
            id: "asc",
          },
        ],
        take: 300,
      }),
    ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableServiceRoles),
      canDelete: hasAnyRole(session, ["OWNER"]),
      message:
        services.length === 0
          ? "Chưa có dữ liệu trong phạm vi hiện tại."
          : null,
      categories: categories.map(toCategorySummary),
      policies: policies.map(toPolicySummary),
      inventoryItems: inventoryItems.map(toInventoryItemOption),
      services: services.map(toServiceSummary),
      treatmentServices: treatmentServices.map(toTreatmentServiceSummary),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "services");
    return demoServicesWorkspace(session);
  }
}

export async function ensureServiceCatalogSeed(organizationId: string) {
  const [categoryMap, policyMap] = await Promise.all([
    ensureServiceCategories(organizationId),
    ensureCompensationPolicies(organizationId),
  ]);

  for (const service of serviceCatalog) {
    const categoryId = categoryMap.get(service.category);
    const policyId = policyIdForCategory(service.category, policyMap);
    const existingService = await prisma.serviceCatalogItem.findUnique({
      where: {
        organizationId_code: {
          organizationId,
          code: service.code,
        },
      },
      select: {
        id: true,
        version: true,
      },
    });

    if (!existingService) {
      const createdService = await prisma.serviceCatalogItem.create({
        data: {
          organizationId,
          categoryId,
          code: service.code,
          name: service.name,
          nameEn: service.nameEn,
          defaultPrice: service.price,
          defaultDurationMinutes: service.defaultDurationMinutes,
          defaultCompensationRuleId: policyId,
          targetMode: service.targetMode ?? targetModeForCategory(service.category),
          consentRequired: service.consentRequired ?? false,
          version: serviceCatalogSeedRevision,
          status: "ACTIVE",
          prices: {
            create: {
              organizationId,
              price: service.price,
              currency: "VND",
              active: true,
              note: "Imported baseline price",
            },
          },
        },
        select: {
          id: true,
        },
      });

      await syncSeedServiceSteps(createdService.id, organizationId, service.steps, true);
      continue;
    }

    const shouldApplySeedRevision = existingService.version !== serviceCatalogSeedRevision;

    if (shouldApplySeedRevision) {
      await prisma.serviceCatalogItem.update({
        where: {
          id: existingService.id,
        },
        data: {
          categoryId,
          name: service.name,
          nameEn: service.nameEn,
          defaultPrice: service.price,
          defaultDurationMinutes: service.defaultDurationMinutes,
          defaultCompensationRuleId: policyId,
          targetMode: service.targetMode ?? targetModeForCategory(service.category),
          consentRequired: service.consentRequired ?? false,
          version: serviceCatalogSeedRevision,
          status: "ACTIVE",
        },
      });

      await ensureDefaultServicePrice(organizationId, existingService.id, service);
      await syncSeedServiceSteps(existingService.id, organizationId, service.steps, true);
      continue;
    }

    await ensureDefaultServicePrice(organizationId, existingService.id, service);
  }
}

async function ensureDefaultServicePrice(
  organizationId: string,
  serviceId: string,
  service: DentalServiceCatalogItem,
) {
  const activePrice = await prisma.servicePrice.findFirst({
    where: {
      organizationId,
      serviceId,
      clinicId: null,
      active: true,
    },
    select: {
      id: true,
    },
  });

  if (activePrice) {
    return;
  }

  await prisma.servicePrice.create({
    data: {
      organizationId,
      serviceId,
      price: service.price,
      currency: "VND",
      active: true,
      note: "Imported baseline price",
    },
  });
}

async function syncSeedServiceSteps(
  serviceId: string,
  organizationId: string,
  steps: DentalServiceStepDefinition[],
  deleteStepsOutsideSeed: boolean,
) {
  const seedSequences = steps.map((step) => step.sequence);

  if (deleteStepsOutsideSeed) {
    await prisma.serviceStep.deleteMany({
      where: {
        organizationId,
        serviceId,
        sequence: {
          notIn: seedSequences,
        },
      },
    });
  }

  for (const step of steps) {
    await prisma.serviceStep.upsert({
      where: {
        serviceId_sequence: {
          serviceId,
          sequence: step.sequence,
        },
      },
      update: {
        name: step.name,
        description: step.description ?? null,
        defaultProgress: step.defaultProgress,
        expectedMinutes: step.expectedMinutes,
        roleHint: step.roleHint ?? null,
        required: step.required ?? true,
      },
      create: {
        organizationId,
        serviceId,
        sequence: step.sequence,
        name: step.name,
        description: step.description ?? null,
        defaultProgress: step.defaultProgress,
        expectedMinutes: step.expectedMinutes,
        roleHint: step.roleHint ?? null,
        required: step.required ?? true,
      },
    });
  }
}

async function ensureServiceCategories(organizationId: string) {
  const categoryMap = new Map<DentalServiceCategory, string>();

  for (const [index, category] of categoryDefinitions.entries()) {
    const record = await prisma.serviceCategory.upsert({
      where: {
        organizationId_code: {
          organizationId,
          code: category.code,
        },
      },
      update: {
        name: category.name,
        nameEn: category.nameEn,
        sortOrder: index + 1,
        active: true,
      },
      create: {
        organizationId,
        code: category.code,
        name: category.name,
        nameEn: category.nameEn,
        sortOrder: index + 1,
        active: true,
      },
      select: {
        id: true,
        code: true,
      },
    });

    categoryMap.set(record.code as DentalServiceCategory, record.id);
  }

  return categoryMap;
}

async function ensureCompensationPolicies(organizationId: string) {
  const policyMap = new Map<string, string>();

  for (const policy of policyDefinitions) {
    const record = await prisma.serviceCompensationRule.upsert({
      where: {
        organizationId_code_version: {
          organizationId,
          code: policy.code,
          version: "1",
        },
      },
      update: {
        name: policy.name,
        active: true,
      },
      create: {
        organizationId,
        code: policy.code,
        name: policy.name,
        version: "1",
        active: true,
        pools: {
          create: [
            {
              pool: "DOCTOR",
              percentOfService: policy.doctorPoolPercent,
              shares: {
                create: [
                  {
                    role: "CONSULTANT",
                    sharePercent: policy.consultantSharePercent,
                    required: false,
                  },
                  {
                    role: "OPERATOR",
                    sharePercent: policy.operatorSharePercent,
                    required: true,
                  },
                  {
                    role: "CLINICAL_SUPPORT",
                    sharePercent: policy.clinicalSupportSharePercent,
                    fallbackRole: "OPERATOR",
                    required: false,
                  },
                ],
              },
            },
            {
              pool: "ASSISTANT",
              percentOfService: policy.assistantPoolPercent,
              shares: {
                create: [
                  {
                    role: "ASSISTANT_PRIMARY",
                    sharePercent: policy.assistantPrimarySharePercent,
                    fallbackRole: "OPERATOR",
                    required: false,
                  },
                  {
                    role: "ASSISTANT_SECONDARY",
                    sharePercent: policy.assistantSecondarySharePercent,
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
        code: true,
      },
    });

    await syncPolicyPool(record.id, "DOCTOR", policy.doctorPoolPercent, [
      ["CONSULTANT", policy.consultantSharePercent, null, false],
      ["OPERATOR", policy.operatorSharePercent, null, true],
      ["CLINICAL_SUPPORT", policy.clinicalSupportSharePercent, "OPERATOR", false],
    ]);
    await syncPolicyPool(record.id, "ASSISTANT", policy.assistantPoolPercent, [
      [
        "ASSISTANT_PRIMARY",
        policy.assistantPrimarySharePercent,
        "OPERATOR",
        false,
      ],
      [
        "ASSISTANT_SECONDARY",
        policy.assistantSecondarySharePercent,
        "ASSISTANT_PRIMARY",
        false,
      ],
    ]);

    policyMap.set(record.code, record.id);
  }

  return policyMap;
}

async function syncPolicyPool(
  ruleId: string,
  pool: CompensationPoolValue,
  percentOfService: number,
  shares: Array<[CompensationRoleValue, number, CompensationRoleValue | null, boolean]>,
) {
  const poolRule = await prisma.serviceCompensationPoolRule.upsert({
    where: {
      ruleId_pool: {
        ruleId,
        pool,
      },
    },
    update: {
      percentOfService,
    },
    create: {
      ruleId,
      pool,
      percentOfService,
    },
    select: {
      id: true,
    },
  });

  for (const [role, sharePercent, fallbackRole, required] of shares) {
    await prisma.serviceCompensationShare.upsert({
      where: {
        poolRuleId_role: {
          poolRuleId: poolRule.id,
          role,
        },
      },
      update: {
        sharePercent,
        fallbackRole,
        required,
      },
      create: {
        poolRuleId: poolRule.id,
        role,
        sharePercent,
        fallbackRole,
        required,
      },
    });
  }
}

function policyIdForCategory(
  category: DentalServiceCategory,
  policyMap: Map<string, string>,
) {
  if (category === "implant") {
    return policyMap.get("IMPLANT") ?? null;
  }

  if (category === "prosthodontics") {
    return policyMap.get("PROSTHO") ?? null;
  }

  if (category === "orthodontics") {
    return policyMap.get("ORTHO") ?? null;
  }

  return policyMap.get("DEFAULT") ?? null;
}

function targetModeForCategory(category: DentalServiceCategory) {
  if (category === "orthodontics") {
    return "ARCH";
  }

  if (category === "prosthodontics") {
    return "TOOTH_OR_GROUP";
  }

  return "TOOTH";
}

function demoServicesWorkspace(session: AppSession): ServicesWorkspace {
  const categories = categoryDefinitions.map((category, index) => ({
    id: category.code,
    code: category.code,
    name: category.name,
    nameEn: category.nameEn,
    active: true,
    sortOrder: index + 1,
  }));

  const policies = policyDefinitions.map((policy) => ({
    id: policy.code,
    code: policy.code,
    name: policy.name,
    version: "1",
    active: true,
    doctorPoolPercent: policy.doctorPoolPercent,
    assistantPoolPercent: policy.assistantPoolPercent,
    consultantSharePercent: policy.consultantSharePercent,
    operatorSharePercent: policy.operatorSharePercent,
    clinicalSupportSharePercent: policy.clinicalSupportSharePercent,
    assistantPrimarySharePercent: policy.assistantPrimarySharePercent,
    assistantSecondarySharePercent: policy.assistantSecondarySharePercent,
  }));

  return {
    source: "demo",
    canMutate: false,
    canDelete: false,
    message:
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    categories,
    policies,
    inventoryItems: [],
    services: serviceCatalog.map((service): ServiceCatalogSummary => {
      const category =
        categories.find((candidate) => candidate.code === service.category) ??
        categories[0];
      const policy =
        policies.find((candidate) => candidate.id === "DEFAULT") ?? null;

      return {
        id: service.id,
        code: service.code,
        categoryCode: service.category,
        categoryName: category.name,
        name: service.name,
        nameEn: service.nameEn,
        status: "ACTIVE",
        defaultPrice: service.price,
        defaultDurationMinutes: service.defaultDurationMinutes,
        targetMode: service.targetMode ?? targetModeForCategory(service.category),
        defaultCompensationRuleId: policy?.id ?? null,
        defaultCompensationRuleName: policy?.name ?? null,
        steps: (service.steps.length > 0 ? service.steps : fallbackServiceStepDefinitions).map((step) => ({
          id: `${service.id}-${step.sequence}`,
          sequence: step.sequence,
          name: step.name,
          defaultProgress: step.defaultProgress,
          expectedMinutes: step.expectedMinutes,
          description: step.description ?? null,
        })),
        prices: [
          {
            id: `${service.id}-price`,
            price: service.price,
            currency: "VND",
            active: true,
            effectiveFrom: vietnamDate(new Date()),
          },
        ],
        materials: [],
      };
    }),
    treatmentServices: [],
  };
}

function toCategorySummary(category: {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  active: boolean;
  sortOrder: number;
}): ServiceCategorySummary {
  return {
    id: category.id,
    code: category.code as DentalServiceCategory,
    name: category.name,
    nameEn: category.nameEn,
    active: category.active,
    sortOrder: category.sortOrder,
  };
}

function toServiceSummary(service: {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  status: string;
  defaultPrice: unknown;
  defaultDurationMinutes: number | null;
  targetMode: string;
  category: {
    code: string;
    name: string;
  } | null;
  defaultCompensationRuleId: string | null;
  defaultCompensationRule: {
    name: string;
  } | null;
  steps: Array<{
    id: string;
    sequence: number;
    name: string;
    description: string | null;
    defaultProgress: number | null;
    expectedMinutes: number | null;
  }>;
  prices: Array<{
    id: string;
    price: unknown;
    currency: string;
    active: boolean;
    effectiveFrom: Date;
  }>;
  materials: Array<{
    id: string;
    inventoryItemId: string | null;
    itemCode: string | null;
    name: string;
    quantity: unknown;
    unit: string | null;
    required: boolean;
    note: string | null;
    inventoryItem: {
      code: string;
      name: string;
      unit: string;
    } | null;
  }>;
}): ServiceCatalogSummary {
  return {
    id: service.id,
    code: service.code,
    categoryCode: (service.category?.code ?? "diagnostics") as DentalServiceCategory,
    categoryName: service.category?.name ?? "Chưa phân nhóm",
    name: service.name,
    nameEn: service.nameEn,
    status: service.status as ServiceCatalogSummary["status"],
    defaultPrice: Number(service.defaultPrice),
    defaultDurationMinutes: service.defaultDurationMinutes,
    targetMode: service.targetMode,
    defaultCompensationRuleId: service.defaultCompensationRuleId,
    defaultCompensationRuleName: service.defaultCompensationRule?.name ?? null,
    steps: sortServiceSteps(service.steps).map((step, index) => ({
      id: step.id,
      sequence: index + 1,
      name: step.name,
      description: step.description,
      defaultProgress: step.defaultProgress,
      expectedMinutes: step.expectedMinutes,
    })),
    prices: service.prices.map((price) => ({
      id: price.id,
      price: Number(price.price),
      currency: price.currency,
      active: price.active,
      effectiveFrom: vietnamDate(price.effectiveFrom),
    })),
    materials: service.materials.map((material) => ({
      id: material.id,
      inventoryItemId: material.inventoryItemId,
      itemCode: material.itemCode ?? material.inventoryItem?.code ?? null,
      name: material.name || material.inventoryItem?.name || "Material",
      quantity: material.quantity == null ? null : Number(material.quantity),
      unit: material.unit ?? material.inventoryItem?.unit ?? null,
      required: material.required,
      note: material.note,
    })),
  };
}

function toInventoryItemOption(item: {
  id: string;
  code: string;
  name: string;
  unit: string;
  onHandQuantity: unknown;
}): ServiceInventoryItemOption {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    unit: item.unit,
    onHandQuantity: Number(item.onHandQuantity),
  };
}

function sortServiceSteps<
  T extends {
    sequence: number;
    defaultProgress: number | null;
  },
>(steps: T[]) {
  return [...steps].sort((left, right) => {
    const leftProgress = left.defaultProgress ?? Number.MAX_SAFE_INTEGER;
    const rightProgress = right.defaultProgress ?? Number.MAX_SAFE_INTEGER;
    const progressDelta = leftProgress - rightProgress;

    if (progressDelta !== 0) {
      return progressDelta;
    }

    return left.sequence - right.sequence;
  });
}

function toPolicySummary(rule: {
  id: string;
  code: string;
  name: string;
  version: string;
  active: boolean;
  pools: Array<{
    pool: string;
    percentOfService: unknown;
    shares: Array<{
      role: string;
      sharePercent: unknown;
    }>;
  }>;
}): ServiceCompensationPolicySummary {
  const doctorPool = rule.pools.find((pool) => pool.pool === "DOCTOR");
  const assistantPool = rule.pools.find((pool) => pool.pool === "ASSISTANT");

  return {
    id: rule.id,
    code: rule.code,
    name: rule.name,
    version: rule.version,
    active: rule.active,
    doctorPoolPercent: Number(doctorPool?.percentOfService ?? 0),
    assistantPoolPercent: Number(assistantPool?.percentOfService ?? 0),
    consultantSharePercent: sharePercent(doctorPool, "CONSULTANT"),
    operatorSharePercent: sharePercent(doctorPool, "OPERATOR"),
    clinicalSupportSharePercent: sharePercent(doctorPool, "CLINICAL_SUPPORT"),
    assistantPrimarySharePercent: sharePercent(assistantPool, "ASSISTANT_PRIMARY"),
    assistantSecondarySharePercent: sharePercent(
      assistantPool,
      "ASSISTANT_SECONDARY",
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

function toTreatmentServiceSummary(service: {
  id: string;
  clinicId: string;
  patientId: string;
  serviceCatalogItemId: string | null;
  serviceCode: string;
  serviceName: string;
  targetSummary: string | null;
  teeth: string[];
  status: string;
  finalPrice: unknown;
  currentProgressPercent: unknown;
  currentStepSequence: number | null;
  compensationRuleId: string | null;
  compensationRuleCode: string | null;
  compensationRuleName: string | null;
  compensationRuleVersion: string | null;
  createdById: string;
  createdBy: {
    fullName: string;
  };
  createdAt: Date;
  serviceCatalogItem: {
    code: string;
    defaultPrice: unknown;
    steps: Array<{
      id: string;
      sequence: number;
      name: string;
      description: string | null;
      defaultProgress: number | null;
      expectedMinutes: number | null;
    }>;
  } | null;
  receiptAllocations: Array<{
    amount: unknown;
    receipt: {
      method: string;
    };
  }>;
  invoiceItems: Array<{
    amount: unknown;
    invoice: {
      invoiceNo: string;
      status: string;
    };
  }>;
  progressEvents: Array<{
    id: string;
    fromProgressPercent: unknown;
    toProgressPercent: unknown;
    progressDeltaPercent: unknown;
    consultant: {
      fullName: string;
    } | null;
    performedBy: {
      fullName: string;
    };
    clinicalSupport: {
      fullName: string;
    } | null;
    assistantPrimary: {
      fullName: string;
    } | null;
    assistantSecondary: {
      fullName: string;
    } | null;
    note: string | null;
    occurredAt: Date;
    compensationAccrual: {
      totalAmount: unknown;
    } | null;
  }>;
}): TreatmentServiceSummary {
  const activeInvoiceItems = service.invoiceItems.filter(
    (item) => item.invoice.status !== "VOID",
  );

  return {
    id: service.id,
    clinicId: service.clinicId,
    patientId: service.patientId,
    serviceCatalogItemId: service.serviceCatalogItemId,
    serviceCode: service.serviceCode,
    catalogCode: service.serviceCatalogItem?.code ?? service.serviceCode,
    serviceName: service.serviceName,
    targetSummary: service.targetSummary,
    teeth: service.teeth,
    status: service.status as TreatmentServiceSummary["status"],
    listPrice: Number(service.serviceCatalogItem?.defaultPrice ?? service.finalPrice),
    finalPrice: Number(service.finalPrice),
    currentProgressPercent: Number(service.currentProgressPercent),
    currentStepSequence: service.currentStepSequence,
    collectedAmount: sumAmounts(
      service.receiptAllocations.filter(
        (allocation) => allocation.receipt.method !== "credit_balance",
      ),
    ),
    creditAllocatedAmount: sumAmounts(
      service.receiptAllocations.filter(
        (allocation) => allocation.receipt.method === "credit_balance",
      ),
    ),
    invoicedAmount: sumAmounts(activeInvoiceItems),
    invoiceNos: Array.from(
      new Set(activeInvoiceItems.map((item) => item.invoice.invoiceNo)),
    ),
    compensationRuleId: service.compensationRuleId,
    compensationRuleCode: service.compensationRuleCode,
    compensationRuleName: service.compensationRuleName,
    compensationRuleVersion: service.compensationRuleVersion,
    createdById: service.createdById,
    createdByName: service.createdBy.fullName,
    createdAt: vietnamDate(service.createdAt),
    steps: sortServiceSteps(service.serviceCatalogItem?.steps ?? []).map((step, index) => ({
      id: step.id,
      sequence: index + 1,
      name: step.name,
      description: step.description,
      defaultProgress: step.defaultProgress,
      expectedMinutes: step.expectedMinutes,
    })),
    progressEvents: service.progressEvents.map((event) => ({
      id: event.id,
      fromProgressPercent: Number(event.fromProgressPercent),
      toProgressPercent: Number(event.toProgressPercent),
      progressDeltaPercent: Number(event.progressDeltaPercent),
      consultantName: event.consultant?.fullName ?? null,
      performedByName: event.performedBy.fullName,
      clinicalSupportName: event.clinicalSupport?.fullName ?? null,
      assistantPrimaryName: event.assistantPrimary?.fullName ?? null,
      assistantSecondaryName: event.assistantSecondary?.fullName ?? null,
      note: event.note,
      occurredAt: vietnamDateTime(event.occurredAt),
      occurredAtIso: event.occurredAt.toISOString(),
      totalCompensationAmount: Number(event.compensationAccrual?.totalAmount ?? 0),
    })),
  };
}

function sumAmounts(items: Array<{ amount: unknown }>) {
  return items.reduce((total, item) => total + Number(item.amount), 0);
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function vietnamDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function vietnamDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
