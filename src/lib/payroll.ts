import "server-only";

import { defaultDataSeedEnabled } from "@/lib/env";
import { canUseAllClinics, hasAnyRole, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type {
  CompensationAccrualSummary,
  PayrollRunSummary,
  PayrollPolicySummary,
  PayrollStaffSummary,
  StaffShiftSummary,
  AttendanceLogSummary,
  LeaveRequestSummary,
  StaffPayrollWorkspace,
} from "@/lib/payroll-types";
import type { AppSession } from "@/lib/session";

const mutableStaffRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"];
const payrollUserRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
  "BILLING",
];

export async function getStaffPayrollWorkspace(
  session: AppSession,
  options: { scope?: "management" | "self" } = {},
): Promise<StaffPayrollWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);
    const selfScope = options.scope === "self";

    if (defaultDataSeedEnabled()) {
      await ensureStaffProfiles(session, { scope: selfScope ? "self" : "management" });
    }
    await rejectStaleLeaveRequests(session, clinicIds);

    const [staffProfiles, accruals, payrollRuns, payrollPolicies, shifts, attendanceLogs, leaveRequests] = await Promise.all([
      prisma.staffProfile.findMany({
        where: {
          organizationId: session.organizationId,
          ...(selfScope ? { userId: session.userId } : {}),
          OR: [
            {
              clinicId: {
                in: clinicIds,
              },
            },
            {
              clinicId: null,
            },
          ],
        },
        include: {
          user: {
            select: {
              fullName: true,
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
        orderBy: {
          employeeCode: "asc",
        },
      }),
      prisma.compensationAccrual.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
          ...(selfScope
            ? {
                lines: {
                  some: {
                    userId: session.userId,
                  },
                },
              }
            : {}),
        },
        include: {
          treatmentService: {
            include: {
              patient: {
                select: {
                  fullName: true,
                },
              },
            },
          },
          lines: {
            ...(selfScope
              ? {
                  where: {
                    userId: session.userId,
                  },
                }
              : {}),
            include: {
              user: {
                select: {
                  fullName: true,
                },
              },
            },
            orderBy: {
              amount: "desc",
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: selfScope ? 500 : 100,
      }),
      prisma.payrollRun.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              clinicId: {
                in: clinicIds,
              },
            },
            {
              clinicId: null,
            },
          ],
          ...(selfScope
            ? {
                lines: {
                  some: {
                    staffProfile: {
                      userId: session.userId,
                    },
                  },
                },
              }
            : {}),
        },
        include: {
          clinic: {
            select: {
              id: true,
              name: true,
            },
          },
          lines: {
            select: {
              id: true,
            },
          },
        },
        orderBy: {
          generatedAt: "desc",
        },
        take: 12,
      }),
      prisma.payrollPolicy.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              scopeKey: "all",
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
              id: true,
              name: true,
            },
          },
        },
        orderBy: [{ clinicId: "asc" }, { updatedAt: "desc" }],
      }),
      prisma.staffShift.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
          ...(selfScope
            ? {
                staffProfile: {
                  userId: session.userId,
                },
              }
            : {}),
        },
        include: {
          staffProfile: {
            include: {
              user: {
                select: {
                  fullName: true,
                },
              },
            },
          },
          clinic: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          startsAt: "desc",
        },
        take: selfScope ? 120 : 40,
      }),
      prisma.attendanceLog.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
          ...(selfScope
            ? {
                staffProfile: {
                  userId: session.userId,
                },
              }
            : {}),
        },
        include: {
          staffProfile: {
            include: {
              user: {
                select: {
                  fullName: true,
                },
              },
            },
          },
          clinic: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          clockInAt: "desc",
        },
        take: selfScope ? 120 : 40,
      }),
      prisma.leaveRequest.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              clinicId: {
                in: clinicIds,
              },
            },
            {
              clinicId: null,
            },
          ],
          ...(selfScope
            ? {
                staffProfile: {
                  userId: session.userId,
                },
              }
            : {}),
        },
        include: {
          staffProfile: {
            include: {
              user: {
                select: {
                  fullName: true,
                },
              },
            },
          },
          clinic: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 40,
      }),
    ]);

    return {
      source: "database",
      canMutate: selfScope ? session.role !== "PATIENT" : hasAnyRole(session, mutableStaffRoles),
      message:
        staffProfiles.length === 0
          ? "Chưa có dữ liệu trong phạm vi hiện tại."
          : null,
      staff: staffProfiles.map(toStaffSummary),
      accruals: accruals.map(toAccrualSummary),
      payrollRuns: payrollRuns.map(toPayrollRunSummary),
      payrollPolicies: payrollPolicies.map(toPayrollPolicySummary),
      shifts: shifts.map(toShiftSummary),
      attendanceLogs: attendanceLogs.map(toAttendanceSummary),
      leaveRequests: leaveRequests.map(toLeaveSummary),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "payroll");
    return {
      source: "demo",
      canMutate: false,
      message:
        "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
      staff: [],
      accruals: [],
      payrollRuns: [],
      payrollPolicies: [],
      shifts: [],
      attendanceLogs: [],
      leaveRequests: [],
    };
  }
}

async function rejectStaleLeaveRequests(session: AppSession, clinicIds: string[]) {
  const todayStart = vietnamStartOfToday();
  const staleRequests = await prisma.leaveRequest.findMany({
    where: {
      organizationId: session.organizationId,
      status: "REQUESTED",
      startsAt: {
        lte: todayStart,
      },
      OR: [
        {
          clinicId: {
            in: clinicIds,
          },
        },
        {
          clinicId: null,
        },
      ],
    },
    select: {
      id: true,
    },
  });

  if (staleRequests.length === 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.updateMany({
      where: {
        id: {
          in: staleRequests.map((request) => request.id),
        },
      },
      data: {
        status: "REJECTED",
        decisionNote:
          "Tự động từ chối vì đơn chưa được duyệt trước ngày bắt đầu. Nghỉ khẩn cấp trong ngày cần quản lý tạo/duyệt trực tiếp.",
      },
    });

    await tx.auditLog.createMany({
      data: staleRequests.map((request) => ({
        organizationId: session.organizationId,
        actorId: session.userId.startsWith("demo-") ? null : session.userId,
        action: "leave_request.auto_rejected_stale",
        entityType: "LeaveRequest",
        entityId: request.id,
      })),
    });
  });
}

function toPayrollPolicySummary(policy: {
  id: string;
  clinicId: string | null;
  scopeKey: string;
  name: string;
  includeBaseSalary: boolean;
  standardWorkdays: number;
  taxPercent: unknown;
  insurancePercent: unknown;
  otherDeductionAmount: unknown;
  roleOverrides: unknown;
  staffOverrides: unknown;
  active: boolean;
  clinic: {
    id: string;
    name: string;
  } | null;
}): PayrollPolicySummary {
  return {
    id: policy.id,
    clinicId: policy.clinicId,
    clinicName: policy.clinic?.name ?? null,
    scopeKey: policy.scopeKey,
    name: policy.name,
    includeBaseSalary: policy.includeBaseSalary,
    standardWorkdays: policy.standardWorkdays,
    taxPercent: Number(policy.taxPercent),
    insurancePercent: Number(policy.insurancePercent),
    otherDeductionAmount: Number(policy.otherDeductionAmount),
    roleOverridesJson: stringifyPolicyOverrides(policy.roleOverrides),
    staffOverridesJson: stringifyPolicyOverrides(policy.staffOverrides),
    active: policy.active,
  };
}

function stringifyPolicyOverrides(value: unknown) {
  if (value == null) {
    return null;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

export async function ensureStaffProfiles(
  session: AppSession,
  options: { scope?: "management" | "self" } = {},
) {
  const users = await prisma.user.findMany({
    where: {
      organizationId: session.organizationId,
      ...(options.scope === "self" ? { id: session.userId } : {}),
      role: {
        in: payrollUserRoles,
      },
      clinics: {
        some: {
          clinicId: {
            in: session.clinicIds,
          },
        },
      },
    },
    include: {
      staffProfile: {
        select: {
          id: true,
        },
      },
      clinics: {
        select: {
          clinicId: true,
        },
        take: 1,
      },
    },
    orderBy: {
      fullName: "asc",
    },
  });

  let count = await prisma.staffProfile.count({
    where: {
      organizationId: session.organizationId,
    },
  });

  for (const user of users) {
    if (user.staffProfile) {
      continue;
    }

    count += 1;

    await prisma.staffProfile.create({
      data: {
        organizationId: session.organizationId,
        userId: user.id,
        clinicId: user.clinics[0]?.clinicId ?? session.activeClinicId ?? null,
        employeeCode: `NV${String(count).padStart(6, "0")}`,
        title: roleTitle(user.role as AppRole),
        department: "Clinic operations",
        active: user.active,
      },
    });
  }
}

function toStaffSummary(profile: {
  id: string;
  userId: string;
  employeeCode: string;
  user: {
    fullName: string;
    role: string;
    active: boolean;
  };
  clinic: {
    id: string;
    name: string;
  } | null;
  baseSalary: unknown;
  active: boolean;
}): PayrollStaffSummary {
  return {
    id: profile.id,
    userId: profile.userId,
    employeeCode: profile.employeeCode,
    fullName: profile.user.fullName,
    role: profile.user.role as AppRole,
    clinicId: profile.clinic?.id ?? null,
    clinicName: profile.clinic?.name ?? null,
    baseSalary: profile.baseSalary == null ? null : Number(profile.baseSalary),
    active: profile.active && profile.user.active,
  };
}

function toAccrualSummary(accrual: {
  id: string;
  clinicId: string;
  status: string;
  serviceAmount: unknown;
  earnedProgressPercent: unknown;
  doctorPoolAmount: unknown;
  assistantPoolAmount: unknown;
  totalAmount: unknown;
  ruleName: string | null;
  createdAt: Date;
  treatmentService: {
    serviceCode: string;
    serviceName: string;
    patient: {
      fullName: string;
    };
  };
  lines: Array<{
    id: string;
    userId: string;
    pool: string;
    role: string;
    amount: unknown;
    payrollLineId: string | null;
    user: {
      fullName: string;
    };
  }>;
}): CompensationAccrualSummary {
  return {
    id: accrual.id,
    clinicId: accrual.clinicId,
    status: accrual.status as CompensationAccrualSummary["status"],
    patientName: accrual.treatmentService.patient.fullName,
    serviceCode: accrual.treatmentService.serviceCode,
    serviceName: accrual.treatmentService.serviceName,
    serviceAmount: Number(accrual.serviceAmount),
    earnedProgressPercent: Number(accrual.earnedProgressPercent),
    doctorPoolAmount: Number(accrual.doctorPoolAmount),
    assistantPoolAmount: Number(accrual.assistantPoolAmount),
    totalAmount: Number(accrual.totalAmount),
    ruleName: accrual.ruleName,
    createdAt: vietnamDateTime(accrual.createdAt),
    createdAtIso: accrual.createdAt.toISOString(),
    lines: accrual.lines.map((line) => ({
      id: line.id,
      userId: line.userId,
      userName: line.user.fullName,
      pool: line.pool as CompensationAccrualSummary["lines"][number]["pool"],
      role: line.role,
      amount: Number(line.amount),
      payrollLineId: line.payrollLineId,
    })),
  };
}

function toPayrollRunSummary(run: {
  id: string;
  clinicId: string | null;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  grossAmount: unknown;
  deductionAmount: unknown;
  netAmount: unknown;
  generatedAt: Date;
  approvedAt: Date | null;
  paidAt: Date | null;
  clinic: {
    name: string;
  } | null;
  lines: Array<{
    id: string;
  }>;
}): PayrollRunSummary {
  return {
    id: run.id,
    clinicId: run.clinicId,
    status: run.status as PayrollRunSummary["status"],
    clinicName: run.clinic?.name ?? null,
    periodStart: vietnamDate(run.periodStart),
    periodEnd: vietnamDate(run.periodEnd),
    grossAmount: Number(run.grossAmount),
    deductionAmount: Number(run.deductionAmount),
    netAmount: Number(run.netAmount),
    lineCount: run.lines.length,
    generatedAt: vietnamDateTime(run.generatedAt),
    approvedAt: run.approvedAt ? vietnamDateTime(run.approvedAt) : null,
    paidAt: run.paidAt ? vietnamDateTime(run.paidAt) : null,
  };
}

function toShiftSummary(shift: {
  id: string;
  staffProfileId: string;
  status: string;
  roleOnShift: string | null;
  startsAt: Date;
  endsAt: Date;
  notes: string | null;
  staffProfile: {
    user: {
      fullName: string;
    };
  };
  clinic: {
    id: string;
    name: string;
  };
}): StaffShiftSummary {
  return {
    id: shift.id,
    staffProfileId: shift.staffProfileId,
    staffName: shift.staffProfile.user.fullName,
    clinicId: shift.clinic.id,
    clinicName: shift.clinic.name,
    status: shift.status as StaffShiftSummary["status"],
    roleOnShift: shift.roleOnShift,
    startsAt: vietnamDateTime(shift.startsAt),
    startsAtIso: shift.startsAt.toISOString(),
    endsAt: vietnamDateTime(shift.endsAt),
    endsAtIso: shift.endsAt.toISOString(),
    notes: shift.notes,
  };
}

function toAttendanceSummary(log: {
  id: string;
  staffProfileId: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  outStatus: string | null;
  note: string | null;
  staffProfile: {
    user: {
      fullName: string;
    };
  };
  clinic: {
    id: string;
    name: string;
  };
}): AttendanceLogSummary {
  return {
    id: log.id,
    staffProfileId: log.staffProfileId,
    staffName: log.staffProfile.user.fullName,
    clinicId: log.clinic.id,
    clinicName: log.clinic.name,
    clockInAt: vietnamDateTime(log.clockInAt),
    clockInAtIso: log.clockInAt.toISOString(),
    clockOutAt: log.clockOutAt ? vietnamDateTime(log.clockOutAt) : null,
    clockOutAtIso: log.clockOutAt?.toISOString() ?? null,
    outStatus: log.outStatus,
    note: log.note,
  };
}

function toLeaveSummary(request: {
  id: string;
  staffProfileId: string;
  leaveType: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  hours: unknown;
  reason: string | null;
  decisionNote: string | null;
  staffProfile: {
    user: {
      fullName: string;
    };
  };
  clinic: {
    id: string;
    name: string;
  } | null;
}): LeaveRequestSummary {
  return {
    id: request.id,
    staffProfileId: request.staffProfileId,
    staffName: request.staffProfile.user.fullName,
    clinicId: request.clinic?.id ?? null,
    clinicName: request.clinic?.name ?? null,
    leaveType: request.leaveType,
    status: request.status as LeaveRequestSummary["status"],
    startsAt: vietnamDate(request.startsAt),
    startsAtIso: request.startsAt.toISOString(),
    endsAt: vietnamDate(request.endsAt),
    endsAtIso: request.endsAt.toISOString(),
    hours: request.hours == null ? null : Number(request.hours),
    reason: request.reason,
    decisionNote: request.decisionNote,
  };
}

function roleTitle(role: AppRole) {
  const labels: Record<AppRole, string> = {
    OWNER: "Owner",
    AREA_MANAGER: "Area manager",
    CLINIC_MANAGER: "Clinic manager",
    DENTIST: "Dentist",
    HYGIENIST: "Hygienist",
    FRONT_DESK: "Front desk",
    BILLING: "Billing",
    PATIENT: "Patient",
  };

  return labels[role] ?? role;
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

function vietnamStartOfToday() {
  return new Date(`${vietnamDate(new Date())}T00:00:00+07:00`);
}

function vietnamDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
