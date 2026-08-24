import "server-only";

import { defaultDataSeedEnabled } from "@/lib/env";
import { ensureStaffProfiles } from "@/lib/payroll";
import { canUseAllClinics, hasAnyRole, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type { AppSession } from "@/lib/session";

export type UnifiedEarningsState = "ESTIMATED" | "EARNED" | "APPROVED" | "PAID" | "VOID";
export type UnifiedEarningsKind = "BASE" | "SERVICE" | "REFERRAL";

export type UnifiedEarningsEvent = {
  id: string;
  kind: UnifiedEarningsKind;
  state: UnifiedEarningsState;
  amount: number;
  occurredAt: string;
  title: string;
  detail: string;
};

export type UnifiedEarningsPerson = {
  staffProfileId: string;
  userId: string;
  employeeCode: string;
  fullName: string;
  role: AppRole;
  clinicId: string | null;
  clinicName: string | null;
  workedDays: number;
  standardWorkdays: number;
  monthlyBaseSalary: number;
  baseEstimated: number;
  servicePending: number;
  serviceApproved: number;
  servicePaid: number;
  serviceTotal: number;
  referralPending: number;
  referralApproved: number;
  referralPaid: number;
  referralTotal: number;
  grossEstimated: number;
  deductionsEstimated: number;
  netEstimated: number;
  payrollStatus: "NONE" | "DRAFT" | "APPROVED" | "PAID" | "VOID";
  payrollGross: number | null;
  payrollNet: number | null;
  events: UnifiedEarningsEvent[];
};

export type StaffOperationsIssue = {
  id: string;
  kind: "attendance" | "leave" | "referral" | "payroll";
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  clinicName: string | null;
  dueAt: string | null;
  href: string;
  status: string;
};

export type StaffOperationsAttendance = {
  id: string;
  staffProfileId: string;
  staffName: string;
  clinicName: string;
  clockInAt: string;
  clockInAtIso: string;
  openHours: number;
};

export type StaffOperationsLeave = {
  id: string;
  staffProfileId: string;
  staffName: string;
  clinicName: string | null;
  leaveType: string;
  startsAt: string;
  startsAtIso: string;
  endsAt: string;
  hours: number | null;
  reason: string | null;
};

export type StaffOperationsShift = {
  id: string;
  startsAt: string;
  startsAtIso: string;
  endsAt: string;
  clinicName: string;
  status: string;
  roleOnShift: string | null;
};

export type StaffOperationsPayrollRun = {
  id: string;
  status: "DRAFT" | "APPROVED" | "PAID" | "VOID";
  clinicName: string | null;
  period: string;
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  lineCount: number;
  generatedAt: string;
};

export type UnifiedEarningsWorkspaceModel = {
  source: "database" | "demo";
  message: string | null;
  periodKey: string;
  periodLabel: string;
  canManage: boolean;
  people: UnifiedEarningsPerson[];
  issues: StaffOperationsIssue[];
  openAttendance: StaffOperationsAttendance[];
  pendingLeave: StaffOperationsLeave[];
  upcomingShifts: StaffOperationsShift[];
  recentPayrollRuns: StaffOperationsPayrollRun[];
  summary: {
    staffCount: number;
    clockedInCount: number;
    pendingLeaveCount: number;
    unresolvedReferralCount: number;
    estimatedGross: number;
    estimatedNet: number;
    servicePending: number;
    referralTotal: number;
  };
};

type EarningsScope = "management" | "self";

type PolicyLike = {
  id: string;
  clinicId: string | null;
  scopeKey: string;
  includeBaseSalary: boolean;
  standardWorkdays: number;
  taxPercent: unknown;
  insurancePercent: unknown;
  otherDeductionAmount: unknown;
  roleOverrides: unknown;
  staffOverrides: unknown;
  active: boolean;
};

type StaffLike = {
  id: string;
  userId: string;
  employeeCode: string;
  baseSalary: unknown;
  clinicId: string | null;
  user: {
    fullName: string;
    email: string;
    role: string;
    active: boolean;
  };
  clinic: {
    id: string;
    name: string;
  } | null;
  active: boolean;
};

const managementRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"];

export async function getUnifiedEarningsWorkspace(
  session: AppSession,
  options: { scope?: EarningsScope } = {},
): Promise<UnifiedEarningsWorkspaceModel> {
  const scope = options.scope ?? "management";
  const selfScope = scope === "self";
  const period = currentVietnamMonth();

  try {
    if (defaultDataSeedEnabled()) {
      await ensureStaffProfiles(session, { scope });
    }

    const clinicIds = allowedClinicIds(session);
    const profileWhere = {
      organizationId: session.organizationId,
      ...(selfScope ? { userId: session.userId } : {}),
      OR: [
        { clinicId: { in: clinicIds } },
        { clinicId: null },
      ],
    };

    const [
      staffProfiles,
      policies,
      attendanceLogs,
      compensationAccruals,
      sourceAccruals,
      payrollRuns,
      leaveRequests,
      shifts,
    ] = await Promise.all([
      prisma.staffProfile.findMany({
        where: profileWhere,
        include: {
          user: {
            select: {
              fullName: true,
              email: true,
              role: true,
              active: true,
            },
          },
          clinic: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { employeeCode: "asc" },
      }),
      prisma.payrollPolicy.findMany({
        where: {
          organizationId: session.organizationId,
          active: true,
          OR: [
            { scopeKey: "all" },
            { clinicId: { in: clinicIds } },
          ],
        },
        orderBy: [{ clinicId: "asc" }, { updatedAt: "desc" }],
      }),
      prisma.attendanceLog.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: { in: clinicIds },
          ...(selfScope
            ? { staffProfile: { userId: session.userId } }
            : {}),
          OR: [
            {
              clockInAt: {
                gte: period.start,
                lte: period.end,
              },
            },
            { clockOutAt: null },
          ],
        },
        include: {
          staffProfile: {
            include: {
              user: { select: { fullName: true } },
            },
          },
          clinic: { select: { name: true } },
        },
        orderBy: { clockInAt: "desc" },
        take: selfScope ? 160 : 800,
      }),
      prisma.compensationAccrual.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: { in: clinicIds },
          createdAt: {
            gte: period.start,
            lte: period.end,
          },
          ...(selfScope
            ? { lines: { some: { userId: session.userId } } }
            : {}),
        },
        include: {
          treatmentService: {
            include: {
              patient: { select: { fullName: true } },
            },
          },
          lines: {
            ...(selfScope ? { where: { userId: session.userId } } : {}),
            select: {
              id: true,
              userId: true,
              role: true,
              amount: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: selfScope ? 500 : 2000,
      }),
      prisma.sourceCommissionAccrual.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: { in: clinicIds },
          earnedAt: {
            gte: period.start,
            lte: period.end,
          },
          status: { not: "VOID" },
        },
        include: {
          policy: {
            select: {
              name: true,
              ownerLabel: true,
            },
          },
          clinic: { select: { name: true } },
          patient: { select: { fullName: true } },
          receipt: { select: { receiptNo: true } },
        },
        orderBy: { earnedAt: "desc" },
        take: 1000,
      }),
      prisma.payrollRun.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            { clinicId: { in: clinicIds } },
            { clinicId: null },
          ],
          ...(selfScope
            ? {
                lines: {
                  some: { staffProfile: { userId: session.userId } },
                },
              }
            : {}),
        },
        include: {
          clinic: { select: { name: true } },
          lines: {
            ...(selfScope
              ? { where: { staffProfile: { userId: session.userId } } }
              : {}),
            select: {
              staffProfileId: true,
              baseAmount: true,
              commissionAmount: true,
              bonusAmount: true,
              deductionAmount: true,
              netAmount: true,
            },
          },
        },
        orderBy: { generatedAt: "desc" },
        take: 16,
      }),
      prisma.leaveRequest.findMany({
        where: {
          organizationId: session.organizationId,
          status: "REQUESTED",
          OR: [
            { clinicId: { in: clinicIds } },
            { clinicId: null },
          ],
          ...(selfScope
            ? { staffProfile: { userId: session.userId } }
            : {}),
        },
        include: {
          staffProfile: {
            include: { user: { select: { fullName: true } } },
          },
          clinic: { select: { name: true } },
        },
        orderBy: { startsAt: "asc" },
        take: selfScope ? 40 : 120,
      }),
      prisma.staffShift.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: { in: clinicIds },
          startsAt: {
            gte: new Date(),
            lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
          ...(selfScope
            ? { staffProfile: { userId: session.userId } }
            : {}),
        },
        include: {
          clinic: { select: { name: true } },
        },
        orderBy: { startsAt: "asc" },
        take: selfScope ? 40 : 120,
      }),
    ]);

    const profiles = staffProfiles.filter(
      (profile) => profile.active && profile.user.active,
    ) as StaffLike[];
    const profileByUserId = new Map(profiles.map((profile) => [profile.userId, profile]));
    const attendanceDays = buildAttendanceDays(attendanceLogs, period.key);
    const serviceByUser = buildServiceEarnings(compensationAccruals);
    const referralResolution = buildReferralEarnings(sourceAccruals, profiles);
    const payrollByProfile = buildCurrentPayrollByProfile(payrollRuns, period.start, period.end);

    const people = profiles.map((profile) => {
      const policy = effectivePolicy(policies as PolicyLike[], profile);
      const workedDays = attendanceDays.get(profile.id)?.size ?? 0;
      const monthlyBaseSalary = Number(profile.baseSalary ?? 0);
      const baseEstimated = policy.includeBaseSalary
        ? proratedBaseSalary(monthlyBaseSalary, workedDays, policy.standardWorkdays)
        : 0;
      const service = serviceByUser.get(profile.userId) ?? emptyEarningsBucket();
      const referral = referralResolution.byUser.get(profile.userId) ?? emptyEarningsBucket();
      const grossEstimated = baseEstimated + service.total + referral.total;
      const deductionsEstimated = Math.min(
        grossEstimated,
        Math.max(
          0,
          Math.round(
            (grossEstimated * (policy.taxPercent + policy.insurancePercent)) / 100 +
              policy.otherDeductionAmount,
          ),
        ),
      );
      const payroll = payrollByProfile.get(profile.id) ?? null;
      const events = [
        ...(baseEstimated > 0
          ? [
              {
                id: `base:${profile.id}:${period.key}`,
                kind: "BASE" as const,
                state: "ESTIMATED" as const,
                amount: baseEstimated,
                occurredAt: period.start.toISOString(),
                title: "Lương cứng tạm tính",
                detail: `${workedDays}/${policy.standardWorkdays} ngày công`,
              },
            ]
          : []),
        ...(service.events ?? []),
        ...(referral.events ?? []),
      ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

      return {
        staffProfileId: profile.id,
        userId: profile.userId,
        employeeCode: profile.employeeCode,
        fullName: profile.user.fullName,
        role: profile.user.role as AppRole,
        clinicId: profile.clinicId,
        clinicName: profile.clinic?.name ?? null,
        workedDays,
        standardWorkdays: policy.standardWorkdays,
        monthlyBaseSalary,
        baseEstimated,
        servicePending: service.pending,
        serviceApproved: service.approved,
        servicePaid: service.paid,
        serviceTotal: service.total,
        referralPending: referral.pending,
        referralApproved: referral.approved,
        referralPaid: referral.paid,
        referralTotal: referral.total,
        grossEstimated,
        deductionsEstimated,
        netEstimated: Math.max(grossEstimated - deductionsEstimated, 0),
        payrollStatus: payroll?.status ?? "NONE",
        payrollGross: payroll?.grossAmount ?? null,
        payrollNet: payroll?.netAmount ?? null,
        events,
      } satisfies UnifiedEarningsPerson;
    });

    const now = new Date();
    const openAttendance = attendanceLogs
      .filter((log) => !log.clockOutAt)
      .map((log) => ({
        id: log.id,
        staffProfileId: log.staffProfileId,
        staffName: log.staffProfile.user.fullName,
        clinicName: log.clinic.name,
        clockInAt: vietnamDateTime(log.clockInAt),
        clockInAtIso: log.clockInAt.toISOString(),
        openHours: Math.max(0, Math.round((now.getTime() - log.clockInAt.getTime()) / 3_600_000)),
      }));
    const pendingLeave = leaveRequests.map((request) => ({
      id: request.id,
      staffProfileId: request.staffProfileId,
      staffName: request.staffProfile.user.fullName,
      clinicName: request.clinic?.name ?? null,
      leaveType: request.leaveType,
      startsAt: vietnamDate(request.startsAt),
      startsAtIso: request.startsAt.toISOString(),
      endsAt: vietnamDate(request.endsAt),
      hours: request.hours == null ? null : Number(request.hours),
      reason: request.reason,
    }));
    const upcomingShifts = shifts.map((shift) => ({
      id: shift.id,
      startsAt: vietnamDateTime(shift.startsAt),
      startsAtIso: shift.startsAt.toISOString(),
      endsAt: vietnamDateTime(shift.endsAt),
      clinicName: shift.clinic.name,
      status: shift.status,
      roleOnShift: shift.roleOnShift,
    }));
    const recentPayrollRuns = payrollRuns.map((run) => ({
      id: run.id,
      status: run.status,
      clinicName: run.clinic?.name ?? null,
      period: `${vietnamDate(run.periodStart)} → ${vietnamDate(run.periodEnd)}`,
      grossAmount: Number(run.grossAmount),
      deductionAmount: Number(run.deductionAmount),
      netAmount: Number(run.netAmount),
      lineCount: run.lines.length,
      generatedAt: vietnamDateTime(run.generatedAt),
    })) as StaffOperationsPayrollRun[];

    const issues: StaffOperationsIssue[] = [];

    if (!selfScope) {
      for (const log of openAttendance) {
        if (log.openHours < 14) {
          continue;
        }

        issues.push({
          id: `attendance:${log.id}`,
          kind: "attendance",
          priority: log.openHours >= 18 ? "high" : "medium",
          title: `Chấm công chưa đóng: ${log.staffName}`,
          detail: `Đã mở ${log.openHours} giờ · ${log.clinicName}`,
          clinicName: log.clinicName,
          dueAt: null,
          href: "/staff",
          status: "ATTENDANCE_OPEN_TOO_LONG",
        });
      }

      for (const leave of pendingLeave) {
        const hoursUntilStart = (new Date(leave.startsAtIso).getTime() - now.getTime()) / 3_600_000;
        issues.push({
          id: `leave:${leave.id}`,
          kind: "leave",
          priority: hoursUntilStart <= 48 ? "high" : "medium",
          title: `Đơn nghỉ chờ duyệt: ${leave.staffName}`,
          detail: `${leave.leaveType} · ${leave.startsAt} → ${leave.endsAt}`,
          clinicName: leave.clinicName,
          dueAt: leave.startsAtIso,
          href: "/staff",
          status: "LEAVE_REQUESTED",
        });
      }

      for (const unresolved of referralResolution.unresolved) {
        issues.push({
          id: `referral:${unresolved.id}`,
          kind: "referral",
          priority: "medium",
          title: "Hoa hồng giới thiệu chưa gán nhân sự",
          detail: `${unresolved.patientName} · ${unresolved.source} · ${formatVnd(unresolved.amount)}`,
          clinicName: unresolved.clinicName,
          dueAt: unresolved.earnedAt,
          href: "/settings",
          status: "REFERRAL_BENEFICIARY_UNRESOLVED",
        });
      }

      for (const run of payrollRuns) {
        if (run.status !== "DRAFT") {
          continue;
        }
        const ageHours = (now.getTime() - run.generatedAt.getTime()) / 3_600_000;
        if (ageHours < 72) {
          continue;
        }
        issues.push({
          id: `payroll:${run.id}`,
          kind: "payroll",
          priority: "medium",
          title: "Bảng lương nháp chưa được duyệt",
          detail: `${run.clinic?.name ?? "Toàn hệ thống"} · ${vietnamDate(run.periodStart)} → ${vietnamDate(run.periodEnd)}`,
          clinicName: run.clinic?.name ?? null,
          dueAt: run.generatedAt.toISOString(),
          href: "/staff",
          status: "PAYROLL_DRAFT_STALE",
        });
      }
    }

    issues.sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority));

    return {
      source: "database",
      message: people.length === 0 ? "Chưa có hồ sơ nhân sự trong phạm vi hiện tại." : null,
      periodKey: period.key,
      periodLabel: period.label,
      canManage: hasAnyRole(session, managementRoles),
      people,
      issues,
      openAttendance,
      pendingLeave,
      upcomingShifts,
      recentPayrollRuns,
      summary: {
        staffCount: people.length,
        clockedInCount: openAttendance.length,
        pendingLeaveCount: pendingLeave.length,
        unresolvedReferralCount: referralResolution.unresolved.length,
        estimatedGross: people.reduce((sum, person) => sum + person.grossEstimated, 0),
        estimatedNet: people.reduce((sum, person) => sum + person.netEstimated, 0),
        servicePending: people.reduce((sum, person) => sum + person.servicePending, 0),
        referralTotal: people.reduce((sum, person) => sum + person.referralTotal, 0),
      },
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "unified earnings");
    return emptyWorkspace(period, hasAnyRole(session, managementRoles));
  }
}

function buildAttendanceDays(
  logs: Array<{ staffProfileId: string; clockInAt: Date }>,
  periodKey: string,
) {
  const days = new Map<string, Set<string>>();

  for (const log of logs) {
    const dateKey = vietnamDateKey(log.clockInAt);
    if (!dateKey.startsWith(periodKey)) {
      continue;
    }
    const set = days.get(log.staffProfileId) ?? new Set<string>();
    set.add(dateKey);
    days.set(log.staffProfileId, set);
  }

  return days;
}

function buildServiceEarnings(
  accruals: Array<{
    id: string;
    status: string;
    createdAt: Date;
    treatmentService: {
      serviceName: string;
      patient: { fullName: string };
    };
    lines: Array<{
      id: string;
      userId: string;
      role: string;
      amount: unknown;
    }>;
  }>,
) {
  const byUser = new Map<string, ReturnType<typeof emptyEarningsBucket>>();

  for (const accrual of accruals) {
    const state = normalizeEarningsState(accrual.status);
    if (state === "VOID") {
      continue;
    }

    for (const line of accrual.lines) {
      const bucket = byUser.get(line.userId) ?? emptyEarningsBucket();
      const amount = Number(line.amount);
      addToBucket(bucket, state, amount);
      bucket.events.push({
        id: `service:${line.id}`,
        kind: "SERVICE",
        state,
        amount,
        occurredAt: accrual.createdAt.toISOString(),
        title: accrual.treatmentService.serviceName,
        detail: `${accrual.treatmentService.patient.fullName} · ${serviceRoleLabel(line.role)}`,
      });
      byUser.set(line.userId, bucket);
    }
  }

  return byUser;
}

function buildReferralEarnings(
  accruals: Array<{
    id: string;
    source: string;
    commissionAmount: unknown;
    status: string;
    earnedAt: Date;
    policy: { name: string; ownerLabel: string | null };
    clinic: { name: string };
    patient: { fullName: string };
    receipt: { receiptNo: string };
  }>,
  profiles: StaffLike[],
) {
  const byUser = new Map<string, ReturnType<typeof emptyEarningsBucket>>();
  const unresolved: Array<{
    id: string;
    source: string;
    amount: number;
    patientName: string;
    clinicName: string;
    earnedAt: string;
  }> = [];

  for (const accrual of accruals) {
    const profile = resolveReferralBeneficiary(accrual.policy.ownerLabel, profiles);
    const amount = Number(accrual.commissionAmount);
    const state = normalizeEarningsState(accrual.status);

    if (!profile) {
      unresolved.push({
        id: accrual.id,
        source: accrual.source,
        amount,
        patientName: accrual.patient.fullName,
        clinicName: accrual.clinic.name,
        earnedAt: accrual.earnedAt.toISOString(),
      });
      continue;
    }

    const bucket = byUser.get(profile.userId) ?? emptyEarningsBucket();
    addToBucket(bucket, state, amount);
    bucket.events.push({
      id: `referral:${accrual.id}`,
      kind: "REFERRAL",
      state,
      amount,
      occurredAt: accrual.earnedAt.toISOString(),
      title: `Giới thiệu · ${accrual.source}`,
      detail: `${accrual.patient.fullName} · ${accrual.receipt.receiptNo}`,
    });
    byUser.set(profile.userId, bucket);
  }

  return { byUser, unresolved };
}

function resolveReferralBeneficiary(ownerLabel: string | null, profiles: StaffLike[]) {
  const value = normalizeIdentifier(ownerLabel);
  if (!value) {
    return null;
  }

  const exactIdentifierMatches = profiles.filter((profile) =>
    [profile.id, profile.userId, profile.employeeCode, profile.user.email]
      .map(normalizeIdentifier)
      .includes(value),
  );
  if (exactIdentifierMatches.length === 1) {
    return exactIdentifierMatches[0];
  }

  const nameMatches = profiles.filter(
    (profile) => normalizeIdentifier(profile.user.fullName) === value,
  );
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

function buildCurrentPayrollByProfile(
  runs: Array<{
    status: string;
    periodStart: Date;
    periodEnd: Date;
    lines: Array<{
      staffProfileId: string;
      baseAmount: unknown;
      commissionAmount: unknown;
      bonusAmount: unknown;
      deductionAmount: unknown;
      netAmount: unknown;
    }>;
  }>,
  periodStart: Date,
  periodEnd: Date,
) {
  const byProfile = new Map<
    string,
    { status: UnifiedEarningsPerson["payrollStatus"]; grossAmount: number; netAmount: number }
  >();

  for (const run of runs) {
    if (run.periodEnd < periodStart || run.periodStart > periodEnd) {
      continue;
    }
    for (const line of run.lines) {
      if (byProfile.has(line.staffProfileId)) {
        continue;
      }
      byProfile.set(line.staffProfileId, {
        status: normalizePayrollStatus(run.status),
        grossAmount:
          Number(line.baseAmount) + Number(line.commissionAmount) + Number(line.bonusAmount),
        netAmount: Number(line.netAmount),
      });
    }
  }

  return byProfile;
}

function effectivePolicy(policies: PolicyLike[], profile: StaffLike) {
  const policy =
    policies.find((candidate) => candidate.clinicId === profile.clinicId) ??
    policies.find((candidate) => candidate.scopeKey === "all") ??
    null;
  const base = {
    includeBaseSalary: policy?.includeBaseSalary ?? true,
    standardWorkdays: positiveInteger(policy?.standardWorkdays, 26),
    taxPercent: percentage(policy?.taxPercent, 0),
    insurancePercent: percentage(policy?.insurancePercent, 0),
    otherDeductionAmount: Math.max(Number(policy?.otherDeductionAmount ?? 0), 0),
  };

  if (!policy) {
    return base;
  }

  const staffOverrides = overrideRecord(policy.staffOverrides);
  const roleOverrides = overrideRecord(policy.roleOverrides);
  const override =
    staffOverrides[profile.id] ??
    staffOverrides[profile.employeeCode] ??
    roleOverrides[profile.user.role] ??
    null;

  if (!override) {
    return base;
  }

  return {
    includeBaseSalary:
      typeof override.includeBaseSalary === "boolean"
        ? override.includeBaseSalary
        : base.includeBaseSalary,
    standardWorkdays: positiveInteger(override.standardWorkdays, base.standardWorkdays),
    taxPercent: percentage(override.taxPercent, base.taxPercent),
    insurancePercent: percentage(override.insurancePercent, base.insurancePercent),
    otherDeductionAmount: Math.max(
      Number.isFinite(Number(override.otherDeductionAmount))
        ? Number(override.otherDeductionAmount)
        : base.otherDeductionAmount,
      0,
    ),
  };
}

function overrideRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, Record<string, unknown>>;
  }
  return value as Record<string, Record<string, unknown>>;
}

function emptyEarningsBucket() {
  return {
    pending: 0,
    approved: 0,
    paid: 0,
    total: 0,
    events: [] as UnifiedEarningsEvent[],
  };
}

function addToBucket(
  bucket: ReturnType<typeof emptyEarningsBucket>,
  state: UnifiedEarningsState,
  amount: number,
) {
  if (state === "VOID") {
    return;
  }
  if (state === "PAID") {
    bucket.paid += amount;
  } else if (state === "APPROVED") {
    bucket.approved += amount;
  } else {
    bucket.pending += amount;
  }
  bucket.total += amount;
}

function normalizeEarningsState(status: string): UnifiedEarningsState {
  if (status === "PAID") return "PAID";
  if (status === "APPROVED") return "APPROVED";
  if (status === "VOID" || status === "VOIDED" || status === "CANCELLED") return "VOID";
  return "EARNED";
}

function normalizePayrollStatus(status: string): UnifiedEarningsPerson["payrollStatus"] {
  if (status === "DRAFT" || status === "APPROVED" || status === "PAID" || status === "VOID") {
    return status;
  }
  return "NONE";
}

function serviceRoleLabel(role: string) {
  const labels: Record<string, string> = {
    CONSULTANT: "Tư vấn",
    OPERATOR: "Thực hiện",
    CLINICAL_SUPPORT: "Hỗ trợ chuyên môn",
    ASSISTANT_PRIMARY: "Phụ tá 1",
    ASSISTANT_SECONDARY: "Phụ tá 2",
  };
  return labels[role] ?? role;
}

function currentVietnamMonth() {
  const now = new Date();
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).format(now);
  const [year, month] = key.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const start = new Date(`${key}-01T00:00:00+07:00`);
  const end = new Date(
    new Date(
      `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+07:00`,
    ).getTime() - 1,
  );

  return {
    key,
    label: `Tháng ${month}/${year}`,
    start,
    end,
  };
}

function proratedBaseSalary(monthlyBaseSalary: number, workedDays: number, standardWorkdays: number) {
  if (monthlyBaseSalary <= 0 || standardWorkdays <= 0 || workedDays <= 0) {
    return 0;
  }
  return Math.min(
    monthlyBaseSalary,
    Math.round((monthlyBaseSalary / standardWorkdays) * Math.min(workedDays, standardWorkdays)),
  );
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function percentage(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : fallback;
}

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("vi-VN") ?? "";
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }
  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function vietnamDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function vietnamDate(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function vietnamDateTime(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

function priorityRank(priority: StaffOperationsIssue["priority"]) {
  return priority === "high" ? 0 : priority === "medium" ? 1 : 2;
}

function emptyWorkspace(
  period: ReturnType<typeof currentVietnamMonth>,
  canManage: boolean,
): UnifiedEarningsWorkspaceModel {
  return {
    source: "demo",
    message: "Chưa tải được dữ liệu nhân sự. Vui lòng thử lại sau.",
    periodKey: period.key,
    periodLabel: period.label,
    canManage,
    people: [],
    issues: [],
    openAttendance: [],
    pendingLeave: [],
    upcomingShifts: [],
    recentPayrollRuns: [],
    summary: {
      staffCount: 0,
      clockedInCount: 0,
      pendingLeaveCount: 0,
      unresolvedReferralCount: 0,
      estimatedGross: 0,
      estimatedNet: 0,
      servicePending: 0,
      referralTotal: 0,
    },
  };
}
