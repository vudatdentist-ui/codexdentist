import "server-only";

import { defaultDataSeedEnabled } from "@/lib/env";
import { canUseAllClinics, hasAnyRole, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type {
  AccountingAiRunSummary,
  AccountingBudgetTargetSummary,
  AccountingCategorySummary,
  AccountingEntrySummary,
  AccountingKind,
  AccountingPnLLine,
  AccountingSummary,
  AccountingWorkspace,
} from "@/lib/accounting-types";
import type { AppSession } from "@/lib/session";

const mutableAccountingRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"];

const categoryDefinitions: Array<{
  code: string;
  name: string;
  nameEn: string;
  kind: AccountingKind;
  targetPercent: number | null;
  warningPercent: number | null;
  sortOrder: number;
}> = [
  { code: "COLLECTIONS", name: "Tiền thu bệnh nhân", nameEn: "Patient collections", kind: "INCOME", targetPercent: null, warningPercent: null, sortOrder: 10 },
  { code: "MANUAL_INCOME", name: "Thu khác", nameEn: "Other income", kind: "INCOME", targetPercent: null, warningPercent: null, sortOrder: 20 },
  { code: "INTERNAL_TRANSFER", name: "Chuyển khoản nội bộ", nameEn: "Internal transfer", kind: "TRANSFER", targetPercent: null, warningPercent: null, sortOrder: 30 },
  { code: "CLINICAL_PAYROLL", name: "Lương chuyên môn", nameEn: "Clinical payroll", kind: "EXPENSE", targetPercent: 22, warningPercent: 28, sortOrder: 110 },
  { code: "OPS_PAYROLL", name: "Lương vận hành", nameEn: "Operations payroll", kind: "EXPENSE", targetPercent: 18, warningPercent: 23, sortOrder: 120 },
  { code: "BENEFITS_TAX", name: "BHXH, phúc lợi, thuế nhân sự", nameEn: "Benefits and payroll tax", kind: "EXPENSE", targetPercent: 4, warningPercent: 6, sortOrder: 130 },
  { code: "SUPPLIES", name: "Vật tư tiêu hao", nameEn: "Dental supplies", kind: "EXPENSE", targetPercent: 7, warningPercent: 9, sortOrder: 210 },
  { code: "LAB", name: "Lab / labo", nameEn: "Lab fees", kind: "EXPENSE", targetPercent: 8, warningPercent: 12, sortOrder: 220 },
  { code: "MARKETING", name: "Marketing / nguồn khách", nameEn: "Marketing and acquisition", kind: "EXPENSE", targetPercent: 6, warningPercent: 10, sortOrder: 310 },
  { code: "FACILITY", name: "Mặt bằng, điện nước", nameEn: "Facility and utilities", kind: "EXPENSE", targetPercent: 9, warningPercent: 13, sortOrder: 410 },
  { code: "EQUIPMENT", name: "Thiết bị, bảo trì, khấu hao", nameEn: "Equipment and maintenance", kind: "EXPENSE", targetPercent: 7, warningPercent: 10, sortOrder: 420 },
  { code: "SOFTWARE_ADMIN", name: "Phần mềm, kế toán, pháp lý", nameEn: "Software, admin, legal", kind: "EXPENSE", targetPercent: 5, warningPercent: 7, sortOrder: 510 },
  { code: "TRAINING_QA", name: "Đào tạo, kiểm soát chất lượng", nameEn: "Training and quality", kind: "EXPENSE", targetPercent: 2, warningPercent: 3, sortOrder: 610 },
  { code: "RESERVE", name: "Dự phòng hoàn tiền, bảo hành", nameEn: "Refund and warranty reserve", kind: "EXPENSE", targetPercent: 2, warningPercent: 4, sortOrder: 710 },
  { code: "OTHER_EXPENSE", name: "Chi phí khác", nameEn: "Other expense", kind: "EXPENSE", targetPercent: 2, warningPercent: 5, sortOrder: 900 },
];

export async function getAccountingWorkspace(
  session: AppSession,
  options: { periodMonth?: string | null } = {},
): Promise<AccountingWorkspace> {
  try {
    if (defaultDataSeedEnabled()) {
      await ensureAccountingCategories(session.organizationId);
    }

    const clinicIds = allowedClinicIds(session);
    const periodMonth = normalizeAccountingPeriodMonth(options.periodMonth);
    const { start, end } = monthBounds(periodMonth);

    const [
      categories,
      entries,
      receipts,
      payrollRuns,
      purchaseOrders,
      budgetTargets,
      clinics,
      aiRuns,
    ] = await Promise.all([
      prisma.accountingCategory.findMany({
        where: {
          organizationId: session.organizationId,
          active: true,
        },
        orderBy: {
          sortOrder: "asc",
        },
      }),
      prisma.accountingEntry.findMany({
        where: {
          organizationId: session.organizationId,
          occurredAt: {
            gte: start,
            lt: end,
          },
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
        include: {
          category: true,
          clinic: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          occurredAt: "desc",
        },
        take: 400,
      }),
      prisma.receipt.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
          method: {
            not: "credit_balance",
          },
          receivedAt: {
            gte: start,
            lt: end,
          },
        },
        include: {
          patient: {
            select: {
              fullName: true,
            },
          },
          clinic: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          receivedAt: "desc",
        },
        take: 500,
      }),
      prisma.payrollRun.findMany({
        where: {
          organizationId: session.organizationId,
          status: "PAID",
          paidAt: {
            gte: start,
            lt: end,
          },
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
        include: {
          clinic: {
            select: {
              name: true,
            },
          },
        },
      }),
      prisma.purchaseOrder.findMany({
        where: {
          organizationId: session.organizationId,
          status: {
            in: ["RECEIVED", "PARTIAL"],
          },
          AND: [
            {
              OR: [
                {
                  receivedAt: {
                    gte: start,
                    lt: end,
                  },
                },
                {
                  status: "PARTIAL",
                  receivedAt: null,
                  updatedAt: {
                    gte: start,
                    lt: end,
                  },
                },
              ],
            },
            {
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
          ],
        },
        include: {
          clinic: {
            select: {
              name: true,
            },
          },
          supplier: {
            select: {
              name: true,
            },
          },
          lines: {
            select: {
              receivedQuantity: true,
              unitCost: true,
            },
          },
        },
      }),
      prisma.accountingBudgetTarget.findMany({
        where: {
          organizationId: session.organizationId,
          periodMonth,
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
      }),
      prisma.clinic.findMany({
        where: {
          organizationId: session.organizationId,
          id: {
            in: clinicIds,
          },
        },
        select: {
          id: true,
        },
      }),
      prisma.aiRun.findMany({
        where: {
          organizationId: session.organizationId,
          module: "accounting",
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 20,
      }),
    ]);

    const categorySummaries = categories.map(toCategorySummary);
    const categoryByCode = new Map(categories.map((category) => [category.code, category]));
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const derivedEntries: AccountingEntrySummary[] = [
      ...receipts.filter((receipt) => receipt.method !== "credit_balance").map((receipt) =>
        toDerivedEntry({
          id: `receipt-${receipt.id}`,
          clinicId: receipt.clinicId,
          clinicName: receipt.clinic.name,
          category: categoryByCode.get("COLLECTIONS"),
          kind: "INCOME",
          amount: Number(receipt.amount),
          occurredAt: receipt.receivedAt,
          description: `Phiếu thu ${receipt.receiptNo} - ${receipt.patient.fullName}`,
          paymentMethod: receipt.method,
          reference: receipt.reference,
          sourceType: "billing_receipt",
          sourceId: receipt.id,
        }),
      ),
      ...payrollRuns.map((run) =>
        toDerivedEntry({
          id: `payroll-${run.id}`,
          clinicId: run.clinicId,
          clinicName: run.clinic?.name ?? null,
          category: categoryByCode.get("CLINICAL_PAYROLL"),
          kind: "EXPENSE",
          amount: Number(run.netAmount),
          occurredAt: run.paidAt ?? run.generatedAt,
          description: `Payroll ${vietnamDate(run.periodStart)} - ${vietnamDate(run.periodEnd)}`,
          paymentMethod: "payroll",
          reference: run.id,
          sourceType: "payroll_run",
          sourceId: run.id,
        }),
      ),
      ...purchaseOrders.map((order) =>
        toDerivedEntry({
          id: `purchase-${order.id}`,
          clinicId: order.clinicId,
          clinicName: order.clinic?.name ?? null,
          category: categoryByCode.get("SUPPLIES"),
          kind: "EXPENSE",
          amount: order.lines.reduce(
            (total, line) =>
              total + Number(line.receivedQuantity) * Number(line.unitCost),
            0,
          ),
          occurredAt: order.receivedAt ?? order.updatedAt,
          description: `${order.poNo} - ${order.supplier.name}`,
          paymentMethod: "purchase_order",
          reference: order.poNo,
          sourceType: "purchase_order",
          sourceId: order.id,
        }),
      ),
    ].filter((entry) => entry.categoryId && entry.amount > 0);

    const manualEntries = entries.map(toEntrySummary);
    const allEntries = [...derivedEntries, ...manualEntries].sort(
      (left, right) => Date.parse(right.occurredAtIso) - Date.parse(left.occurredAtIso),
    );
    const summary = buildSummary(periodMonth, allEntries);
    const targetByCategoryId = new Map(
      budgetTargets.map((target) => [target.categoryId, target]),
    );
    const pnlLines = buildPnlLines({
      entries: allEntries,
      categories: categorySummaries,
      targetByCategoryId,
      collections: summary.collections,
    });

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableAccountingRoles) && clinics.length > 0,
      message:
        clinics.length === 0
          ? "Chưa có dữ liệu trong phạm vi hiện tại."
          : null,
      generatedAt: vietnamDateTime(new Date()),
      periodMonth,
      categories: categorySummaries,
      entries: allEntries,
      budgetTargets: budgetTargets.map(toBudgetTargetSummary),
      pnlLines,
      summary,
      aiRuns: aiRuns.map(toAiRunSummary),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "accounting");
    return demoAccountingWorkspace();
  }
}

export async function ensureAccountingCategories(organizationId: string) {
  await Promise.all(
    categoryDefinitions.map((category) =>
      prisma.accountingCategory.upsert({
        where: {
          organizationId_code: {
            organizationId,
            code: category.code,
          },
        },
        update: {
          name: category.name,
          nameEn: category.nameEn,
          kind: category.kind,
          targetPercent: category.targetPercent,
          warningPercent: category.warningPercent,
          sortOrder: category.sortOrder,
          active: true,
        },
        create: {
          organizationId,
          ...category,
          active: true,
        },
      }),
    ),
  );
}

function buildSummary(periodMonth: string, entries: AccountingEntrySummary[]): AccountingSummary {
  const collections = sumByCategory(entries, "COLLECTIONS");
  const manualIncome = entries
    .filter((entry) => entry.kind === "INCOME" && entry.categoryCode !== "COLLECTIONS")
    .reduce((total, entry) => total + entry.amount, 0);
  const totalIncome = entries
    .filter((entry) => entry.kind === "INCOME")
    .reduce((total, entry) => total + entry.amount, 0);
  const totalExpenses = entries
    .filter((entry) => entry.kind === "EXPENSE")
    .reduce((total, entry) => total + entry.amount, 0);
  const operatingProfit = totalIncome - totalExpenses;

  return {
    periodMonth,
    collections,
    manualIncome,
    totalIncome,
    totalExpenses,
    operatingProfit,
    profitPercent: percentOf(operatingProfit, collections),
    expensePercent: percentOf(totalExpenses, collections),
    clinicalPayrollPercent: percentOf(sumByCategory(entries, "CLINICAL_PAYROLL"), collections),
    opsPayrollPercent: percentOf(sumByCategory(entries, "OPS_PAYROLL"), collections),
    marketingPercent: percentOf(sumByCategory(entries, "MARKETING"), collections),
    labAndSuppliesPercent: percentOf(
      sumByCategory(entries, "LAB") + sumByCategory(entries, "SUPPLIES"),
      collections,
    ),
  };
}

function buildPnlLines({
  entries,
  categories,
  targetByCategoryId,
  collections,
}: {
  entries: AccountingEntrySummary[];
  categories: AccountingCategorySummary[];
  targetByCategoryId: Map<string, { targetPercent: unknown; warningPercent: unknown | null }>;
  collections: number;
}): AccountingPnLLine[] {
  return categories
    .map((category) => {
      const amount = entries
        .filter((entry) => entry.categoryId === category.id)
        .reduce((total, entry) => total + entry.amount, 0);
      const override = targetByCategoryId.get(category.id);
      const targetPercent =
        override?.targetPercent == null ? category.targetPercent : Number(override.targetPercent);
      const warningPercent =
        override?.warningPercent == null ? category.warningPercent : Number(override.warningPercent);
      const percentOfCollections = percentOf(amount, collections);
      const status: AccountingPnLLine["status"] =
        category.kind !== "EXPENSE" || !warningPercent
          ? "INFO"
          : percentOfCollections > warningPercent
            ? "OVER"
            : targetPercent && percentOfCollections > targetPercent
              ? "WATCH"
              : "OK";

      return {
        categoryId: category.id,
        categoryCode: category.code,
        categoryName: category.name,
        kind: category.kind,
        amount,
        percentOfCollections,
        targetPercent,
        warningPercent,
        status,
      };
    })
    .filter((line) => line.amount > 0 || line.kind === "EXPENSE");
}

function toCategorySummary(category: {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  kind: string;
  targetPercent: unknown | null;
  warningPercent: unknown | null;
  sortOrder: number;
  active: boolean;
}): AccountingCategorySummary {
  return {
    id: category.id,
    code: category.code,
    name: category.name,
    nameEn: category.nameEn,
    kind: normalizeKind(category.kind),
    targetPercent: category.targetPercent == null ? null : Number(category.targetPercent),
    warningPercent: category.warningPercent == null ? null : Number(category.warningPercent),
    sortOrder: category.sortOrder,
    active: category.active,
  };
}

function toEntrySummary(entry: {
  id: string;
  clinicId: string | null;
  clinic: { name: string } | null;
  categoryId: string;
  category: { code: string; name: string };
  kind: string;
  amount: unknown;
  occurredAt: Date;
  vendor: string | null;
  description: string;
  paymentMethod: string | null;
  reference: string | null;
  attachmentFileName: string | null;
  attachmentMimeType: string | null;
  attachmentSizeBytes: number | null;
  attachmentStorageKey: string | null;
  attachmentThumbnailStorageKey: string | null;
  sourceType: string;
  sourceId: string | null;
  locked: boolean;
}): AccountingEntrySummary {
  return {
    id: entry.id,
    clinicId: entry.clinicId,
    clinicName: entry.clinic?.name ?? null,
    categoryId: entry.categoryId,
    categoryCode: entry.category.code,
    categoryName: entry.category.name,
    kind: normalizeKind(entry.kind),
    amount: Number(entry.amount),
    occurredAt: vietnamDate(entry.occurredAt),
    occurredAtIso: entry.occurredAt.toISOString(),
    vendor: entry.vendor,
    description: entry.description,
    paymentMethod: entry.paymentMethod,
    reference: entry.reference,
    attachmentFileName: entry.attachmentFileName,
    attachmentMimeType: entry.attachmentMimeType,
    attachmentSizeBytes: entry.attachmentSizeBytes,
    attachmentUrl: entry.attachmentStorageKey ? `/accounting-attachments/${entry.id}` : null,
    attachmentThumbnailUrl: entry.attachmentThumbnailStorageKey
      ? `/accounting-attachments/${entry.id}?variant=thumbnail`
      : null,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    locked: entry.locked,
  };
}

function toDerivedEntry(input: {
  id: string;
  clinicId: string | null;
  clinicName: string | null;
  category?: { id: string; code: string; name: string } | null;
  kind: AccountingKind;
  amount: number;
  occurredAt: Date;
  description: string;
  paymentMethod: string | null;
  reference: string | null;
  sourceType: string;
  sourceId: string;
}): AccountingEntrySummary {
  return {
    id: input.id,
    clinicId: input.clinicId,
    clinicName: input.clinicName,
    categoryId: input.category?.id ?? "",
    categoryCode: input.category?.code ?? "",
    categoryName: input.category?.name ?? "",
    kind: input.kind,
    amount: input.amount,
    occurredAt: vietnamDate(input.occurredAt),
    occurredAtIso: input.occurredAt.toISOString(),
    vendor: null,
    description: input.description,
    paymentMethod: input.paymentMethod,
    reference: input.reference,
    attachmentFileName: null,
    attachmentMimeType: null,
    attachmentSizeBytes: null,
    attachmentUrl: null,
    attachmentThumbnailUrl: null,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    locked: true,
  };
}

function toBudgetTargetSummary(target: {
  id: string;
  clinicId: string | null;
  categoryId: string;
  periodMonth: string;
  targetPercent: unknown;
  warningPercent: unknown | null;
}): AccountingBudgetTargetSummary {
  return {
    id: target.id,
    clinicId: target.clinicId,
    categoryId: target.categoryId,
    periodMonth: target.periodMonth,
    targetPercent: Number(target.targetPercent),
    warningPercent: target.warningPercent == null ? null : Number(target.warningPercent),
  };
}

function toAiRunSummary(run: {
  id: string;
  action: string;
  status: string;
  model: string;
  createdAt: Date;
  completedAt: Date | null;
  output: unknown;
  rawOutput: string | null;
  error: string | null;
  totalTokens: number | null;
}): AccountingAiRunSummary {
  return {
    id: run.id,
    action: run.action,
    status: run.status,
    model: run.model,
    createdAt: vietnamDateTime(run.createdAt),
    completedAt: run.completedAt ? vietnamDateTime(run.completedAt) : null,
    output: run.output,
    rawOutput: run.rawOutput,
    error: run.error,
    totalTokens: run.totalTokens,
  };
}

function demoAccountingWorkspace(): AccountingWorkspace {
  const periodMonth = currentVietnamMonth();
  const categories = categoryDefinitions.map((category, index) => ({
    id: category.code,
    code: category.code,
    name: category.name,
    nameEn: category.nameEn,
    kind: category.kind,
    targetPercent: category.targetPercent,
    warningPercent: category.warningPercent,
    sortOrder: index,
    active: true,
  }));

  const entries: AccountingEntrySummary[] = [
    demoEntry("demo-income", "COLLECTIONS", "Tiền thu bệnh nhân demo", "INCOME", 680000000, categories, true),
    demoEntry("demo-clinical-payroll", "CLINICAL_PAYROLL", "Lương chuyên môn demo", "EXPENSE", 148000000, categories, true),
    demoEntry("demo-ops-payroll", "OPS_PAYROLL", "Lương vận hành demo", "EXPENSE", 96000000, categories, false),
    demoEntry("demo-marketing", "MARKETING", "Marketing demo", "EXPENSE", 42000000, categories, false),
    demoEntry("demo-supplies", "SUPPLIES", "Vật tư demo", "EXPENSE", 48000000, categories, true),
    demoEntry("demo-lab", "LAB", "Lab demo", "EXPENSE", 52000000, categories, true),
    demoEntry("demo-facility", "FACILITY", "Mặt bằng demo", "EXPENSE", 61000000, categories, false),
  ];
  const summary = buildSummary(periodMonth, entries);
  const pnlLines = buildPnlLines({
    entries,
    categories,
    targetByCategoryId: new Map(),
    collections: summary.collections,
  });

  return {
    source: "demo",
    canMutate: false,
    message: "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    generatedAt: vietnamDateTime(new Date()),
    periodMonth,
    categories,
    entries,
    budgetTargets: [],
    pnlLines,
    summary,
    aiRuns: [],
  };
}

function demoEntry(
  id: string,
  categoryCode: string,
  description: string,
  kind: AccountingKind,
  amount: number,
  categories: AccountingCategorySummary[],
  locked: boolean,
): AccountingEntrySummary {
  const category = categories.find((candidate) => candidate.code === categoryCode) ?? categories[0];

  return {
    id,
    clinicId: null,
    clinicName: null,
    categoryId: category.id,
    categoryCode: category.code,
    categoryName: category.name,
    kind,
    amount,
    occurredAt: vietnamDate(new Date()),
    occurredAtIso: new Date().toISOString(),
    vendor: null,
    description,
    paymentMethod: locked ? "derived" : "manual",
    reference: null,
    attachmentFileName: null,
    attachmentMimeType: null,
    attachmentSizeBytes: null,
    attachmentUrl: null,
    attachmentThumbnailUrl: null,
    sourceType: locked ? "demo_derived" : "manual",
    sourceId: null,
    locked,
  };
}

function sumByCategory(entries: AccountingEntrySummary[], categoryCode: string) {
  return entries
    .filter((entry) => entry.categoryCode === categoryCode)
    .reduce((total, entry) => total + entry.amount, 0);
}

function percentOf(amount: number, collections: number) {
  if (collections <= 0) {
    return 0;
  }

  return Math.round((amount / collections) * 1000) / 10;
}

function normalizeKind(kind: string): AccountingKind {
  return kind === "INCOME" || kind === "TRANSFER" ? kind : "EXPENSE";
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function currentVietnamMonth() {
  return vietnamDate(new Date()).slice(0, 7);
}

function normalizeAccountingPeriodMonth(periodMonth: string | null | undefined) {
  if (periodMonth && /^\d{4}-\d{2}$/.test(periodMonth)) {
    const [year, month] = periodMonth.split("-").map(Number);

    if (year >= 2020 && year <= 2100 && month >= 1 && month <= 12) {
      return periodMonth;
    }
  }

  return currentVietnamMonth();
}

function monthBounds(periodMonth: string) {
  const [year, month] = periodMonth.split("-").map(Number);

  return {
    start: new Date(Date.UTC(year, month - 1, 1, -7, 0, 0)),
    end: new Date(Date.UTC(year, month, 1, -7, 0, 0)),
  };
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
