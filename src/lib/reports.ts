import "server-only";

import { clinics as demoClinics, formatVnd } from "@/lib/data";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type {
  ClinicReport,
  ReportAgingBucket,
  ReportPatientSourceMixItem,
  ReportProviderPerformance,
  ReportsWorkspace,
  ReportServiceMixItem,
  ReportSummary,
  ReportTrendPoint,
} from "@/lib/reports-types";
import type { AppSession } from "@/lib/session";

export async function getReportsWorkspace(
  session: AppSession,
  options: {
    from?: string | null;
    to?: string | null;
    clinicId?: string | null;
  } = {},
): Promise<ReportsWorkspace> {
  try {
    const allowedIds = allowedClinicIds(session);
    const clinicIds =
      options.clinicId && allowedIds.includes(options.clinicId)
        ? [options.clinicId]
        : allowedIds;
    const todayKey = vietnamDateKey(new Date());
    const currentMonth = todayKey.slice(0, 7);
    const requestedStart = parseVietnamDateKey(options.from);
    const requestedEnd = parseVietnamDateKey(options.to);
    const fromKey = requestedStart ?? `${currentMonth}-01`;
    const toKey = requestedEnd ?? todayKey;
    const normalizedFromKey = fromKey <= toKey ? fromKey : toKey;
    const normalizedToKey = fromKey <= toKey ? toKey : fromKey;
    const periodStart = new Date(`${normalizedFromKey}T00:00:00+07:00`);
    const periodEnd = new Date(`${normalizedToKey}T23:59:59+07:00`);
    const trendStart = startOfVietnamDay(addDays(periodEnd, -6));
    const appointmentStart = periodStart < trendStart ? periodStart : trendStart;
    const now = new Date();

    const [
      dbClinics,
      invoices,
      receipts,
      appointments,
      patients,
      invoiceItems,
      crmLeadCount,
      openCrmActivityCount,
      inventoryItems,
      openAttendanceCount,
      patientFileCount,
      communityCount,
      sourcePolicies,
      sourceAccruals,
    ] = await Promise.all([
      prisma.clinic.findMany({
        where: {
          organizationId: session.organizationId,
          id: {
            in: clinicIds,
          },
        },
        select: {
          id: true,
          chainId: true,
          chain: {
            select: {
              name: true,
            },
          },
          name: true,
          city: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.invoice.findMany({
        where: {
          clinicId: {
            in: clinicIds,
          },
          patient: {
            organizationId: session.organizationId,
          },
        },
        select: {
          id: true,
          clinicId: true,
          status: true,
          amount: true,
          paidAmount: true,
          dueDate: true,
          createdAt: true,
          patient: {
            select: {
              leadSource: true,
            },
          },
        },
      }),
      prisma.receipt.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
          receivedAt: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
        select: {
          clinicId: true,
          method: true,
          amount: true,
          allocatedAmount: true,
          unallocatedAmount: true,
          receivedAt: true,
          patient: {
            select: {
              leadSource: true,
            },
          },
        },
      }),
      prisma.appointment.findMany({
        where: {
          clinicId: {
            in: clinicIds,
          },
          startsAt: {
            gte: appointmentStart,
            lte: periodEnd,
          },
          patient: {
            organizationId: session.organizationId,
          },
        },
        include: {
          provider: {
            select: {
              id: true,
              fullName: true,
              role: true,
            },
          },
        },
      }),
      prisma.patient.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
        },
        select: {
          clinicId: true,
          leadSource: true,
          createdAt: true,
          consents: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
            select: {
              status: true,
              expiresAt: true,
            },
          },
        },
      }),
      prisma.invoiceItem.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
          createdAt: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
        include: {
          treatmentService: {
            select: {
              serviceCode: true,
              serviceName: true,
            },
          },
          receiptAllocations: {
            select: {
              amount: true,
            },
          },
          invoice: {
            select: {
              status: true,
            },
          },
        },
      }),
      prisma.crmLead.count({
        where: {
          organizationId: session.organizationId,
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
      prisma.crmActivity.count({
        where: {
          organizationId: session.organizationId,
          completedAt: null,
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
      prisma.inventoryItem.findMany({
        where: {
          organizationId: session.organizationId,
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
          active: true,
        },
        select: {
          minimumStock: true,
          onHandQuantity: true,
        },
      }),
      prisma.attendanceLog.count({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
          clockOutAt: null,
        },
      }),
      prisma.patientFile.count({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
        },
      }),
      prisma.communityPost.count({
        where: {
          organizationId: session.organizationId,
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
      prisma.sourceCommissionPolicy.findMany({
        where: {
          organizationId: session.organizationId,
        },
        select: {
          source: true,
          monthlyBudget: true,
        },
      }),
      prisma.sourceCommissionAccrual.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
          earnedAt: {
            gte: periodStart,
            lte: periodEnd,
          },
          status: {
            in: ["EARNED", "APPROVED"],
          },
        },
        select: {
          source: true,
          commissionAmount: true,
        },
      }),
    ]);

    const periodInvoices = invoices.filter((invoice) =>
      isWithin(invoice.createdAt, periodStart, periodEnd),
    );
    const activePeriodInvoices = periodInvoices.filter(
      (invoice) => invoice.status !== "VOID",
    );
    const periodAppointments = appointments.filter((appointment) =>
      isWithin(appointment.startsAt, periodStart, periodEnd),
    );
    const periodPatients = patients.filter((patient) =>
      isWithin(patient.createdAt, periodStart, periodEnd),
    );
    const actualReceipts = receipts.filter((receipt) => receipt.method !== "credit_balance");

    const clinicReports: ClinicReport[] = dbClinics.map((clinic) => {
      const clinicInvoices = periodInvoices.filter(
        (invoice) => invoice.status !== "VOID" && invoice.clinicId === clinic.id,
      );
      const clinicAllInvoices = invoices.filter((invoice) => invoice.clinicId === clinic.id);
      const clinicReceipts = actualReceipts.filter((receipt) => receipt.clinicId === clinic.id);
      const production = sumNumbers(clinicInvoices.map((invoice) => Number(invoice.amount)));
      const collection = sumNumbers(clinicReceipts.map((receipt) => Number(receipt.amount)));
      const openBalance = clinicAllInvoices
        .filter((invoice) => invoice.status !== "PAID" && invoice.status !== "VOID")
        .reduce(
          (total, invoice) =>
            total + Math.max(Number(invoice.amount) - Number(invoice.paidAmount), 0),
          0,
        );
      const overdueInvoices = clinicAllInvoices.filter(
        (invoice) =>
          invoice.status !== "PAID" &&
          invoice.status !== "VOID" &&
          invoice.dueDate < now,
      ).length;
      const consentRenewals = patients.filter((patient) => {
        if (patient.clinicId !== clinic.id) {
          return false;
        }

        const latestConsent = patient.consents[0];

        return (
          !latestConsent ||
          latestConsent.status !== "GRANTED" ||
          Boolean(latestConsent.expiresAt && latestConsent.expiresAt < now)
        );
      }).length;
      const todayVisits = periodAppointments.filter(
        (appointment) => appointment.clinicId === clinic.id,
      ).length;
      const patientCount = patients.filter((patient) => patient.clinicId === clinic.id).length;
      const newPatients = periodPatients.filter((patient) => patient.clinicId === clinic.id).length;

      return {
        clinicId: clinic.id,
        chainId: clinic.chainId,
        chainName: clinic.chain?.name ?? null,
        name: clinic.name,
        city: clinic.city,
        todayVisits,
        production,
        collection,
        openBalance,
        overdueInvoices,
        consentRenewals,
        patientCount,
        newPatients,
        collectionRatio: production > 0 ? Math.round((collection / production) * 100) : 0,
      };
    });

    const summary = buildSummary({
      clinicReports,
      periodAppointments,
      periodPatients,
    });
    const aging = buildAging(invoices, now);
    const trend = buildTrend({
      start: trendStart,
      end: periodEnd,
      appointments,
      invoices: activePeriodInvoices,
      receipts: actualReceipts,
    });
    const serviceMix = buildServiceMix(invoiceItems);
    const providerPerformance = buildProviderPerformance(periodAppointments);
    const patientSourceMix = buildPatientSourceMix({
      patients,
      invoices: activePeriodInvoices,
      receipts: actualReceipts,
      periodStart,
      periodEnd,
      sourceAccruals,
      sourcePolicies,
    });
    const lowStockCount = inventoryItems.filter(
      (item) => Number(item.onHandQuantity) <= Number(item.minimumStock),
    ).length;
    const unappliedCredit = actualReceipts.reduce(
      (total, receipt) => total + Number(receipt.unallocatedAmount),
      0,
    );

    return {
      source: "database",
      message:
        clinicReports.length === 0
          ? "Chưa có dữ liệu trong phạm vi hiện tại."
          : null,
      generatedAt: vietnamDateTime(now),
      periodLabel: `${vietnamDate(periodStart)} - ${vietnamDate(periodEnd)}`,
      filters: {
        from: normalizedFromKey,
        to: normalizedToKey,
        clinicId: clinicIds.length === 1 && options.clinicId === clinicIds[0] ? clinicIds[0] : null,
      },
      summary,
      clinicReports,
      signals: [
        {
          title: "Open balance",
          value: formatVnd(summary.openBalance),
          detail: `${summary.overdueInvoices} overdue`,
        },
        {
          title: "Unapplied credit",
          value: formatVnd(unappliedCredit),
          detail: "Patient advance balance",
        },
        {
          title: "CRM follow-ups",
          value: String(openCrmActivityCount),
          detail: `${crmLeadCount} leads`,
        },
        {
          title: "Low stock items",
          value: String(lowStockCount),
          detail: "At or below minimum",
        },
        {
          title: "Open attendance",
          value: String(openAttendanceCount),
          detail: "Clock-ins without clock-out",
        },
        {
          title: "Patient files",
          value: String(patientFileCount),
          detail: `${communityCount} community posts`,
        },
      ],
      trend,
      aging,
      serviceMix,
      providerPerformance,
      patientSourceMix,
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "reports");
    return demoReportsWorkspace(session);
  }
}

function demoReportsWorkspace(session: AppSession): ReportsWorkspace {
  const allowedIds = new Set(session.clinicIds);
  const clinicReports: ClinicReport[] = demoClinics
    .filter((clinic) => allowedIds.has(clinic.id))
    .map((clinic) => {
      const openBalance = clinic.production - clinic.collection;

      return {
        clinicId: clinic.id,
        chainId: clinic.chainId ?? null,
        chainName: clinic.chainName ?? null,
        name: clinic.name,
        city: clinic.city,
        todayVisits: clinic.todayVisits,
        production: clinic.production,
        collection: clinic.collection,
        openBalance,
        overdueInvoices: Math.max(Math.round(clinic.pendingClaims / 3), 1),
        consentRenewals: clinic.pendingClaims,
        patientCount: clinic.todayVisits * 18,
        newPatients: Math.max(Math.round(clinic.todayVisits / 4), 1),
        collectionRatio: clinic.production > 0 ? Math.round((clinic.collection / clinic.production) * 100) : 0,
      };
    });
  const summary = buildSummary({
    clinicReports,
    periodAppointments: [],
    periodPatients: [],
  });
  const trend = [
    { label: "Mon", visits: 18, production: 64000000, collection: 52000000 },
    { label: "Tue", visits: 23, production: 78000000, collection: 61000000 },
    { label: "Wed", visits: 21, production: 71000000, collection: 65000000 },
    { label: "Thu", visits: 26, production: 92000000, collection: 76000000 },
    { label: "Fri", visits: 24, production: 84000000, collection: 70000000 },
    { label: "Sat", visits: 31, production: 118000000, collection: 96000000 },
    { label: "Sun", visits: 12, production: 39000000, collection: 34000000 },
  ];

  return {
    source: "demo",
    message:
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    generatedAt: "Demo snapshot",
    periodLabel: "Demo month to date",
    filters: {
      from: "",
      to: "",
      clinicId: null,
    },
    summary,
    clinicReports,
    signals: [
      { title: "Open balance", value: formatVnd(summary.openBalance), detail: `${summary.overdueInvoices} overdue` },
      { title: "CRM follow-ups", value: "8", detail: "24 leads" },
      { title: "Low stock items", value: "3", detail: "At or below minimum" },
      { title: "Open attendance", value: "1", detail: "Clock-ins without clock-out" },
      { title: "Patient files", value: "42", detail: "Protected records" },
      { title: "Collection ratio", value: `${summary.collectionRatio}%`, detail: "Month to date" },
    ],
    trend,
    aging: [
      { label: "Current", amount: Math.round(summary.openBalance * 0.35), count: 4 },
      { label: "1-30", amount: Math.round(summary.openBalance * 0.4), count: 5 },
      { label: "31-60", amount: Math.round(summary.openBalance * 0.18), count: 2 },
      { label: "61-90", amount: Math.round(summary.openBalance * 0.07), count: 1 },
      { label: "90+", amount: 0, count: 0 },
    ],
    serviceMix: [
      { label: "Implant", serviceCode: "IMP", quantity: 6, production: 180000000, collected: 125000000 },
      { label: "Orthodontics", serviceCode: "ORTHO", quantity: 9, production: 135000000, collected: 88000000 },
      { label: "Restorative", serviceCode: "REST", quantity: 18, production: 72000000, collected: 69000000 },
    ],
    providerPerformance: [
      { providerId: "demo-1", name: "Dr. Nguyen", role: "DENTIST", visits: 18, completed: 14 },
      { providerId: "demo-2", name: "Dr. Tran", role: "DENTIST", visits: 16, completed: 13 },
      { providerId: "demo-3", name: "Hygienist Le", role: "HYGIENIST", visits: 22, completed: 20 },
    ],
    patientSourceMix: [
      { source: "Referral", patientCount: 86, newPatientCount: 9, production: 210000000, collection: 162000000, manualCost: 12000000, roiPercent: 1350, commissionDue: 4200000 },
      { source: "Facebook", patientCount: 64, newPatientCount: 12, production: 184000000, collection: 119000000, manualCost: 18000000, roiPercent: 661, commissionDue: 6200000 },
      { source: "Walk-in", patientCount: 41, newPatientCount: 5, production: 93000000, collection: 88000000, manualCost: 0, roiPercent: null, commissionDue: 0 },
    ],
  };
}

function buildSummary({
  clinicReports,
  periodAppointments,
  periodPatients,
}: {
  clinicReports: ClinicReport[];
  periodAppointments: Array<{ status: string }>;
  periodPatients: unknown[];
}): ReportSummary {
  const production = sumNumbers(clinicReports.map((clinic) => clinic.production));
  const collection = sumNumbers(clinicReports.map((clinic) => clinic.collection));

  return {
    production,
    collection,
    openBalance: sumNumbers(clinicReports.map((clinic) => clinic.openBalance)),
    collectionRatio: production > 0 ? Math.round((collection / production) * 100) : 0,
    visits: periodAppointments.length || sumNumbers(clinicReports.map((clinic) => clinic.todayVisits)),
    newPatients:
      periodPatients.length ||
      sumNumbers(clinicReports.map((clinic) => clinic.newPatients ?? 0)),
    overdueInvoices: sumNumbers(clinicReports.map((clinic) => clinic.overdueInvoices)),
  };
}

function buildTrend({
  start,
  end,
  appointments,
  invoices,
  receipts,
}: {
  start: Date;
  end: Date;
  appointments: Array<{ startsAt: Date }>;
  invoices: Array<{ createdAt: Date; amount: unknown }>;
  receipts: Array<{ receivedAt: Date; amount: unknown }>;
}): ReportTrendPoint[] {
  const points: ReportTrendPoint[] = [];

  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const key = vietnamDateKey(cursor);

    points.push({
      label: shortVietnamDate(cursor),
      visits: appointments.filter((appointment) => vietnamDateKey(appointment.startsAt) === key).length,
      production: sumNumbers(
        invoices
          .filter((invoice) => vietnamDateKey(invoice.createdAt) === key)
          .map((invoice) => Number(invoice.amount)),
      ),
      collection: sumNumbers(
        receipts
          .filter((receipt) => vietnamDateKey(receipt.receivedAt) === key)
          .map((receipt) => Number(receipt.amount)),
      ),
    });
  }

  return points;
}

function buildAging(
  invoices: Array<{ status: string; dueDate: Date; amount: unknown; paidAmount: unknown }>,
  now: Date,
): ReportAgingBucket[] {
  const buckets: ReportAgingBucket[] = [
    { label: "Current", amount: 0, count: 0 },
    { label: "1-30", amount: 0, count: 0 },
    { label: "31-60", amount: 0, count: 0 },
    { label: "61-90", amount: 0, count: 0 },
    { label: "90+", amount: 0, count: 0 },
  ];

  invoices
    .filter((invoice) => invoice.status !== "PAID" && invoice.status !== "VOID")
    .forEach((invoice) => {
      const balance = Math.max(Number(invoice.amount) - Number(invoice.paidAmount), 0);
      if (balance <= 0) {
        return;
      }

      const daysPastDue = Math.floor(
        (now.getTime() - invoice.dueDate.getTime()) / (24 * 60 * 60 * 1000),
      );
      const bucket =
        daysPastDue <= 0
          ? buckets[0]
          : daysPastDue <= 30
            ? buckets[1]
            : daysPastDue <= 60
              ? buckets[2]
              : daysPastDue <= 90
                ? buckets[3]
                : buckets[4];

      bucket.amount += balance;
      bucket.count += 1;
    });

  return buckets;
}

function buildServiceMix(
  invoiceItems: Array<{
    description: string;
    quantity: unknown;
    amount: unknown;
    invoice: { status: string };
    treatmentService: { serviceCode: string; serviceName: string } | null;
    receiptAllocations: Array<{ amount: unknown }>;
  }>,
): ReportServiceMixItem[] {
  const groups = new Map<string, ReportServiceMixItem>();

  invoiceItems.forEach((item) => {
    if (item.invoice.status === "VOID") {
      return;
    }

    const serviceCode = item.treatmentService?.serviceCode ?? null;
    const label = item.treatmentService?.serviceName ?? item.description;
    const key = `${serviceCode ?? "manual"}:${label}`;
    const current =
      groups.get(key) ??
      ({
        label,
        serviceCode,
        quantity: 0,
        production: 0,
        collected: 0,
      } satisfies ReportServiceMixItem);

    current.quantity += Number(item.quantity);
    current.production += Number(item.amount);
    current.collected += sumNumbers(
      item.receiptAllocations.map((allocation) => Number(allocation.amount)),
    );
    groups.set(key, current);
  });

  return [...groups.values()]
    .sort((left, right) => right.production - left.production)
    .slice(0, 8);
}

function buildProviderPerformance(
  appointments: Array<{
    provider: { id: string; fullName: string; role: string };
    status: string;
  }>,
): ReportProviderPerformance[] {
  const providers = new Map<string, ReportProviderPerformance>();

  appointments.forEach((appointment) => {
    const current =
      providers.get(appointment.provider.id) ??
      ({
        providerId: appointment.provider.id,
        name: appointment.provider.fullName,
        role: appointment.provider.role,
        visits: 0,
        completed: 0,
      } satisfies ReportProviderPerformance);

    current.visits += 1;
    if (appointment.status === "COMPLETED") {
      current.completed += 1;
    }
    providers.set(appointment.provider.id, current);
  });

  return [...providers.values()]
    .sort((left, right) => right.visits - left.visits)
    .slice(0, 8);
}

function buildPatientSourceMix({
  invoices,
  patients,
  periodEnd,
  periodStart,
  receipts,
  sourceAccruals,
  sourcePolicies,
}: {
  patients: Array<{
    leadSource: string | null;
    createdAt: Date;
  }>;
  invoices: Array<{
    amount: unknown;
    patient: {
      leadSource: string | null;
    };
  }>;
  receipts: Array<{
    amount: unknown;
    patient: {
      leadSource: string | null;
    };
  }>;
  sourcePolicies: Array<{
    source: string;
    monthlyBudget: unknown | null;
  }>;
  sourceAccruals: Array<{
    source: string;
    commissionAmount: unknown;
  }>;
  periodStart: Date;
  periodEnd: Date;
}): ReportPatientSourceMixItem[] {
  const sources = new Map<string, ReportPatientSourceMixItem>();

  patients.forEach((patient) => {
    const source = patient.leadSource?.trim() || "Không rõ";
    const current =
      sources.get(source) ??
      ({
        source,
        patientCount: 0,
        newPatientCount: 0,
        production: 0,
        collection: 0,
        manualCost: 0,
        roiPercent: null,
        commissionDue: 0,
      } satisfies ReportPatientSourceMixItem);

    current.patientCount += 1;
    if (isWithin(patient.createdAt, periodStart, periodEnd)) {
      current.newPatientCount += 1;
    }
    sources.set(source, current);
  });

  invoices.forEach((invoice) => {
    const source = invoice.patient.leadSource?.trim() || "Không rõ";
    const current =
      sources.get(source) ??
      ({
        source,
        patientCount: 0,
        newPatientCount: 0,
        production: 0,
        collection: 0,
        manualCost: 0,
        roiPercent: null,
        commissionDue: 0,
      } satisfies ReportPatientSourceMixItem);

    current.production += Number(invoice.amount);
    sources.set(source, current);
  });

  receipts.forEach((receipt) => {
    const source = receipt.patient.leadSource?.trim() || "Không rõ";
    const current =
      sources.get(source) ??
      ({
        source,
        patientCount: 0,
        newPatientCount: 0,
        production: 0,
        collection: 0,
        manualCost: 0,
        roiPercent: null,
        commissionDue: 0,
      } satisfies ReportPatientSourceMixItem);

    current.collection += Number(receipt.amount);
    sources.set(source, current);
  });

  sourcePolicies.forEach((policy) => {
    const current = ensureReportSourceItem(sources, policy.source);
    current.manualCost += policy.monthlyBudget == null ? 0 : Number(policy.monthlyBudget);
  });

  sourceAccruals.forEach((accrual) => {
    ensureReportSourceItem(sources, accrual.source).commissionDue += Number(accrual.commissionAmount);
  });

  for (const item of sources.values()) {
    item.roiPercent =
      item.manualCost > 0 ? Math.round((item.collection / item.manualCost) * 100) : null;
  }

  return [...sources.values()]
    .sort(
      (left, right) =>
        right.collection - left.collection ||
        right.production - left.production ||
        right.newPatientCount - left.newPatientCount ||
        right.patientCount - left.patientCount,
    )
    .slice(0, 8);
}

function ensureReportSourceItem(
  sources: Map<string, ReportPatientSourceMixItem>,
  rawSource: string | null,
) {
  const source = rawSource?.trim() || "Không rõ";
  const current =
    sources.get(source) ??
    ({
      source,
      patientCount: 0,
      newPatientCount: 0,
      production: 0,
      collection: 0,
      manualCost: 0,
      roiPercent: null,
      commissionDue: 0,
    } satisfies ReportPatientSourceMixItem);

  sources.set(source, current);
  return current;
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function parseVietnamDateKey(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00+07:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return value;
}

function isWithin(date: Date, start: Date, end: Date) {
  return date >= start && date <= end;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfVietnamDay(date: Date) {
  return new Date(`${vietnamDateKey(date)}T00:00:00+07:00`);
}

function sumNumbers(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function vietnamDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function shortVietnamDate(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function vietnamDate(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function vietnamDateTime(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}
