"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  parseDateInVietnam,
  parseDateTimeInVietnam,
  parseEndOfDateInVietnam,
  parseMoney,
  requiredString,
} from "@/lib/form-validation";
import { ensureStaffProfiles } from "@/lib/payroll";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export async function createPayrollRunFromAccrualsAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "payroll.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const periodStart = parseDateInVietnam(formData.get("periodStart"));
  const periodEnd = parseEndOfDateInVietnam(formData.get("periodEnd"), () => new Date());
  const clinicId = requiredString(formData.get("clinicId"));
  const allowedClinicIds = allowedClinicIdsFor(session);
  const scopedClinicId = clinicId && clinicId !== "all" ? clinicId : null;
  const includeBaseSalary = formData.get("includeBaseSalary") === "on";
  const submittedStandardWorkdays = optionalPositiveInteger(formData.get("standardWorkdays"));
  const submittedTaxPercent = optionalPercentageInput(formData.get("taxPercent"));
  const submittedInsurancePercent = optionalPercentageInput(formData.get("insurancePercent"));
  const submittedOtherDeductionAmount = parseMoney(formData.get("otherDeductionAmount"));

  if (
    periodStart === "invalid" ||
    periodEnd === "invalid" ||
    !periodStart ||
    !periodEnd
  ) {
    redirect("/staff?notice=staff-payroll-date");
  }

  if (scopedClinicId && !allowedClinicIds.includes(scopedClinicId)) {
    redirect("/staff?notice=staff-denied");
  }

  await ensureStaffProfiles(session);

  try {
    const payrollPolicy = await findPayrollPolicy(session, scopedClinicId);
    const standardWorkdays = submittedStandardWorkdays ?? payrollPolicy?.standardWorkdays ?? 26;
    const taxPercent = submittedTaxPercent ?? Number(payrollPolicy?.taxPercent ?? 0);
    const insurancePercent = submittedInsurancePercent ?? Number(payrollPolicy?.insurancePercent ?? 0);
    const otherDeductionAmount = Math.max(
      Number(submittedOtherDeductionAmount ?? payrollPolicy?.otherDeductionAmount ?? 0),
      0,
    );
    const accrualWhere = {
      organizationId: session.organizationId,
      clinicId: scopedClinicId
        ? scopedClinicId
        : {
            in: allowedClinicIds,
          },
      status: "EARNED",
      createdAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    } satisfies Prisma.CompensationAccrualWhereInput;
    const staffWhere = {
      organizationId: session.organizationId,
      active: true,
      user: {
        active: true,
      },
      ...(scopedClinicId
        ? { clinicId: scopedClinicId }
        : {
            OR: [
              {
                clinicId: {
                  in: allowedClinicIds,
                },
              },
              {
                clinicId: null,
              },
            ],
          }),
    } satisfies Prisma.StaffProfileWhereInput;
    const accruals = await prisma.compensationAccrual.findMany({
        where: accrualWhere,
        include: {
          lines: true,
        },
      });
    const salaryProfiles = includeBaseSalary
        ? await prisma.staffProfile.findMany({
            where: staffWhere,
            select: {
              id: true,
              userId: true,
              employeeCode: true,
              baseSalary: true,
              user: {
                select: {
                  role: true,
                },
              },
            },
          })
        : [];
    const attendanceLogs = includeBaseSalary
        ? await prisma.attendanceLog.findMany({
            where: {
              organizationId: session.organizationId,
              clinicId: scopedClinicId
                ? scopedClinicId
                : {
                    in: allowedClinicIds,
                  },
              clockInAt: {
                gte: periodStart,
                lte: periodEnd,
              },
            },
            select: {
              staffProfileId: true,
              clockInAt: true,
            },
          })
        : [];

    const accrualLines = accruals.flatMap((accrual) => accrual.lines);

    if (accrualLines.length === 0 && salaryProfiles.length === 0) {
      redirect("/staff?notice=staff-payroll-empty");
    }

    const profileByUserId = await staffProfileMap(
      session,
      Array.from(new Set(accrualLines.map((line) => line.userId))),
    );
    const salaryProfilesByUserId = new Map(salaryProfiles.map((profile) => [profile.userId, profile]));
    const workdaysByProfileId = buildWorkdaysByProfile(attendanceLogs);

    await prisma.$transaction(async (tx) => {
      const payrollRun = await tx.payrollRun.create({
        data: {
          organizationId: session.organizationId,
          clinicId: scopedClinicId,
          status: "DRAFT",
          periodStart,
          periodEnd,
          grossAmount: 0,
          deductionAmount: 0,
          netAmount: 0,
        },
        select: {
          id: true,
        },
      });

      const lineIdsByUserId = new Map<string, string[]>();

      for (const accrualLine of accrualLines) {
        const existing = lineIdsByUserId.get(accrualLine.userId) ?? [];
        existing.push(accrualLine.id);
        lineIdsByUserId.set(accrualLine.userId, existing);
      }

      for (const profile of salaryProfiles) {
        if (!lineIdsByUserId.has(profile.userId)) {
          lineIdsByUserId.set(profile.userId, []);
        }
      }

      let grossAmount = 0;
      let deductionAmount = 0;
      let netAmount = 0;

      for (const [userId, lineIds] of lineIdsByUserId.entries()) {
        const profile = salaryProfilesByUserId.get(userId) ?? profileByUserId.get(userId);

        if (!profile) {
          continue;
        }

        const commissionAmount = accrualLines
          .filter((line) => line.userId === userId)
          .reduce((total, line) => total + Number(line.amount), 0);
        const workdays = workdaysByProfileId.get(profile.id)?.size ?? 0;
        const monthlyBaseSalary = Number("baseSalary" in profile ? profile.baseSalary ?? 0 : 0);
        const effectivePolicy = effectivePayrollPolicyForProfile(payrollPolicy, profile, {
          standardWorkdays,
          taxPercent,
          insurancePercent,
          otherDeductionAmount,
        });
        const baseAmount = includeBaseSalary
          ? proratedBaseSalary(monthlyBaseSalary, workdays, effectivePolicy.standardWorkdays)
          : 0;
        const grossLineAmount = baseAmount + commissionAmount;
        const taxAmount = Math.round((grossLineAmount * effectivePolicy.taxPercent) / 100);
        const insuranceAmount = Math.round((grossLineAmount * effectivePolicy.insurancePercent) / 100);
        const lineDeductionAmount = Math.min(
          grossLineAmount,
          taxAmount + insuranceAmount + effectivePolicy.otherDeductionAmount,
        );
        const lineNetAmount = Math.max(grossLineAmount - lineDeductionAmount, 0);
        const payrollLine = await tx.payrollLine.create({
          data: {
            payrollRunId: payrollRun.id,
            staffProfileId: profile.id,
            employeeCode: profile.employeeCode,
            baseAmount,
            commissionAmount,
            bonusAmount: 0,
            deductionAmount: lineDeductionAmount,
            netAmount: lineNetAmount,
            metrics: {
              compensationLineCount: lineIds.length,
              standardWorkdays: effectivePolicy.standardWorkdays,
              workedDays: workdays,
              monthlyBaseSalary,
              taxPercent: effectivePolicy.taxPercent,
              taxAmount,
              insurancePercent: effectivePolicy.insurancePercent,
              insuranceAmount,
              otherDeductionAmount: effectivePolicy.otherDeductionAmount,
              overrideSource: effectivePolicy.source,
            } as Prisma.InputJsonValue,
          },
          select: {
            id: true,
          },
        });
        grossAmount += grossLineAmount;
        deductionAmount += lineDeductionAmount;
        netAmount += lineNetAmount;

        if (lineIds.length > 0) {
          await tx.compensationAccrualLine.updateMany({
            where: {
              id: {
                in: lineIds,
              },
            },
            data: {
              payrollLineId: payrollLine.id,
            },
          });
        }
      }

      await tx.payrollRun.update({
        where: {
          id: payrollRun.id,
        },
        data: {
          grossAmount,
          deductionAmount,
          netAmount,
        },
      });

      if (accruals.length > 0) {
        await tx.compensationAccrual.updateMany({
          where: {
            id: {
              in: accruals.map((accrual) => accrual.id),
            },
          },
          data: {
            payrollRunId: payrollRun.id,
            status: "APPROVED",
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "payroll.run_created_from_accruals",
          entityType: "PayrollRun",
          entityId: payrollRun.id,
          metadata: {
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            clinicId: scopedClinicId,
            accrualCount: accruals.length,
            includeBaseSalary,
            standardWorkdays,
            taxPercent,
            insurancePercent,
            otherDeductionAmount,
            grossAmount,
            deductionAmount,
            netAmount,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-database");
  }

  revalidatePath("/staff");
  redirect("/staff?notice=staff-payroll-created");
}

export async function updatePayrollPolicyAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "payroll.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const clinicIdInput = requiredString(formData.get("clinicId"));
  const scopedClinicId = clinicIdInput && clinicIdInput !== "all" ? clinicIdInput : null;
  const allowedClinicIds = allowedClinicIdsFor(session);
  const includeBaseSalary = formData.get("includeBaseSalary") === "on";
  const standardWorkdays = positiveInteger(formData.get("standardWorkdays"), 26);
  const taxPercent = percentageInput(formData.get("taxPercent"));
  const insurancePercent = percentageInput(formData.get("insurancePercent"));
  const otherDeductionAmount = Math.max(Number(parseMoney(formData.get("otherDeductionAmount")) ?? 0), 0);
  const roleOverrides = parseOverridesJson(formData.get("roleOverridesJson"));
  const staffOverrides = parseOverridesJson(formData.get("staffOverridesJson"));

  if (scopedClinicId && !allowedClinicIds.includes(scopedClinicId)) {
    redirect("/staff?notice=staff-denied");
  }

  if (roleOverrides === false || staffOverrides === false) {
    redirect("/staff?notice=staff-payroll-policy-bad-json");
  }

  try {
    const clinic = scopedClinicId
      ? await prisma.clinic.findFirst({
          where: {
            id: scopedClinicId,
            organizationId: session.organizationId,
          },
          select: {
            id: true,
            name: true,
          },
        })
      : null;

    if (scopedClinicId && !clinic) {
      redirect("/staff?notice=staff-denied");
    }

    const scopeKey = scopedClinicId ?? "all";
    const policy = await prisma.payrollPolicy.upsert({
      where: {
        organizationId_scopeKey: {
          organizationId: session.organizationId,
          scopeKey,
        },
      },
      update: {
        clinicId: scopedClinicId,
        name: clinic ? `${clinic.name} payroll policy` : "Organization payroll policy",
        includeBaseSalary,
        standardWorkdays,
        taxPercent,
        insurancePercent,
        otherDeductionAmount,
        roleOverrides: nullableJson(roleOverrides),
        staffOverrides: nullableJson(staffOverrides),
        active: true,
      },
      create: {
        organizationId: session.organizationId,
        clinicId: scopedClinicId,
        scopeKey,
        name: clinic ? `${clinic.name} payroll policy` : "Organization payroll policy",
        includeBaseSalary,
        standardWorkdays,
        taxPercent,
        insurancePercent,
        otherDeductionAmount,
        roleOverrides: nullableJson(roleOverrides),
        staffOverrides: nullableJson(staffOverrides),
      },
      select: {
        id: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "payroll.policy_upserted",
        entityType: "PayrollPolicy",
        entityId: policy.id,
        metadata: {
          clinicId: scopedClinicId,
          includeBaseSalary,
          standardWorkdays,
          taxPercent,
          insurancePercent,
          otherDeductionAmount,
          roleOverrides: nullableJson(roleOverrides),
          staffOverrides: nullableJson(staffOverrides),
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-database");
  }

  revalidatePath("/staff");
  redirect("/staff?notice=staff-payroll-policy-saved");
}

export async function importPayrollPoliciesAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "payroll.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const csvText = requiredString(formData.get("csvText"));

  if (!csvText) {
    redirect("/staff?notice=staff-payroll-policy-import-empty");
  }

  const allowedClinicIds = allowedClinicIdsFor(session);

  try {
    const rows = parsePayrollPolicyCsv(csvText);

    if (rows.length === 0) {
      redirect("/staff?notice=staff-payroll-policy-import-empty");
    }

    const clinics = await prisma.clinic.findMany({
      where: {
        organizationId: session.organizationId,
        id: {
          in: allowedClinicIds,
        },
      },
      select: {
        id: true,
        name: true,
      },
    });
    const clinicById = new Map(clinics.map((clinic) => [clinic.id, clinic]));
    const clinicByName = new Map(
      clinics.map((clinic) => [clinic.name.trim().toLowerCase(), clinic]),
    );
    let importedCount = 0;

    for (const row of rows) {
      const scopeKey = (row.scope_key || row.scope || "all").trim();
      const clinicName = (row.clinic_name || row.clinic || "").trim();
      const clinic =
        scopeKey && scopeKey !== "all"
          ? clinicById.get(scopeKey)
          : clinicName && clinicName.toLowerCase() !== "all clinics"
            ? clinicByName.get(clinicName.toLowerCase())
            : null;

      if (scopeKey !== "all" && !clinic) {
        continue;
      }

      const resolvedScopeKey = clinic?.id ?? "all";
      const standardWorkdays = positiveInteger(row.standard_workdays ?? "", 26);
      const taxPercent = percentageInput(row.tax_percent ?? "");
      const insurancePercent = percentageInput(row.insurance_percent ?? "");
      const otherDeductionAmount = Math.max(
        Number(parseMoney(row.other_deduction_vnd ?? "") ?? 0),
        0,
      );
      const roleOverrides = parseOverridesJson(row.role_overrides_json ?? "");
      const staffOverrides = parseOverridesJson(row.staff_overrides_json ?? "");
      const includeBaseSalary = parseBoolean(row.include_base_salary, true);
      const active = parseBoolean(row.active, true);

      if (roleOverrides === false || staffOverrides === false) {
        continue;
      }

      const policy = await prisma.payrollPolicy.upsert({
        where: {
          organizationId_scopeKey: {
            organizationId: session.organizationId,
            scopeKey: resolvedScopeKey,
          },
        },
        update: {
          clinicId: clinic?.id ?? null,
          name:
            row.policy_name?.trim() ||
            (clinic ? `${clinic.name} payroll policy` : "Organization payroll policy"),
          includeBaseSalary,
          standardWorkdays,
          taxPercent,
          insurancePercent,
          otherDeductionAmount,
          roleOverrides: nullableJson(roleOverrides),
          staffOverrides: nullableJson(staffOverrides),
          active,
        },
        create: {
          organizationId: session.organizationId,
          clinicId: clinic?.id ?? null,
          scopeKey: resolvedScopeKey,
          name:
            row.policy_name?.trim() ||
            (clinic ? `${clinic.name} payroll policy` : "Organization payroll policy"),
          includeBaseSalary,
          standardWorkdays,
          taxPercent,
          insurancePercent,
          otherDeductionAmount,
          roleOverrides: nullableJson(roleOverrides),
          staffOverrides: nullableJson(staffOverrides),
          active,
        },
        select: {
          id: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "payroll.policy_imported",
          entityType: "PayrollPolicy",
          entityId: policy.id,
          metadata: {
            scopeKey: resolvedScopeKey,
            clinicId: clinic?.id ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      importedCount += 1;
    }

    if (importedCount === 0) {
      redirect("/staff?notice=staff-payroll-policy-import-empty");
    }
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-payroll-policy-import-failed");
  }

  revalidatePath("/staff");
  redirect("/staff?notice=staff-payroll-policy-imported");
}

export async function createStaffShiftAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "staff.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const staffProfileId = requiredString(formData.get("staffProfileId"));
  const clinicId = requiredString(formData.get("clinicId"));
  const date = requiredString(formData.get("date"));
  const startTime = requiredString(formData.get("startTime"));
  const endTime = requiredString(formData.get("endTime"));
  const startsAt = parseDateTimeInVietnam(date, startTime);
  const endsAt = parseDateTimeInVietnam(date, endTime);

  if (
    !staffProfileId ||
    !clinicId ||
    startsAt === "invalid" ||
    endsAt === "invalid" ||
    startsAt >= endsAt
  ) {
    redirect("/staff?notice=staff-shift-missing");
  }

  if (!allowedClinicIdsFor(session).includes(clinicId)) {
    redirect("/staff?notice=staff-denied");
  }

  try {
    const profile = await scopedStaffProfile(session, staffProfileId);

    if (!profile) {
      redirect("/staff?notice=staff-profile-missing");
    }

    const shift = await prisma.staffShift.create({
      data: {
        organizationId: session.organizationId,
        clinicId,
        staffProfileId: profile.id,
        status: "SCHEDULED",
        roleOnShift: requiredString(formData.get("roleOnShift")) || null,
        startsAt,
        endsAt,
        notes: requiredString(formData.get("notes")) || null,
      },
      select: {
        id: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "staff_shift.created",
        entityType: "StaffShift",
        entityId: shift.id,
        metadata: {
          staffProfileId: profile.id,
          clinicId,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-database");
  }

  revalidatePath("/staff");
  redirect("/staff?notice=staff-shift-created");
}

export async function clockInStaffAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "staff.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const staffProfileId = requiredString(formData.get("staffProfileId"));
  const clinicId = requiredString(formData.get("clinicId"));

  if (!staffProfileId || !clinicId || !allowedClinicIdsFor(session).includes(clinicId)) {
    redirect("/staff?notice=staff-profile-missing");
  }

  try {
    const profile = await scopedStaffProfile(session, staffProfileId);

    if (!profile) {
      redirect("/staff?notice=staff-profile-missing");
    }

    const openLog = await prisma.attendanceLog.findFirst({
      where: {
        staffProfileId: profile.id,
        clockOutAt: null,
      },
      select: {
        id: true,
      },
    });

    if (openLog) {
      redirect("/staff?notice=staff-attendance-open");
    }

    const log = await prisma.attendanceLog.create({
      data: {
        organizationId: session.organizationId,
        clinicId,
        staffProfileId: profile.id,
        clockInAt: new Date(),
        source: "STAFF",
        note: requiredString(formData.get("note")) || null,
      },
      select: {
        id: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "attendance.clock_in",
        entityType: "AttendanceLog",
        entityId: log.id,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-database");
  }

  revalidatePath("/staff");
  redirect("/staff?notice=staff-clocked-in");
}

export async function clockOutStaffAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "staff.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const attendanceLogId = requiredString(formData.get("attendanceLogId"));

  try {
    const log = await prisma.attendanceLog.findFirst({
      where: {
        id: attendanceLogId,
        organizationId: session.organizationId,
        clinicId: {
          in: allowedClinicIdsFor(session),
        },
        clockOutAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!log) {
      redirect("/staff?notice=staff-attendance-missing");
    }

    await prisma.attendanceLog.update({
      where: {
        id: log.id,
      },
      data: {
        clockOutAt: new Date(),
        outStatus: requiredString(formData.get("outStatus")) || "NORMAL",
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "attendance.clock_out",
        entityType: "AttendanceLog",
        entityId: log.id,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-database");
  }

  revalidatePath("/staff");
  redirect("/staff?notice=staff-clocked-out");
}

export async function createLeaveRequestAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "staff.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const staffProfileId = requiredString(formData.get("staffProfileId"));
  const startsAt = parseDateInVietnam(formData.get("startsAt"));
  const endsAt = parseEndOfDateInVietnam(formData.get("endsAt"), () => new Date());

  if (
    !staffProfileId ||
    startsAt === "invalid" ||
    endsAt === "invalid" ||
    !startsAt ||
    !endsAt ||
    startsAt > endsAt
  ) {
    redirect("/staff?notice=staff-leave-missing");
  }

  try {
    const profile = await scopedStaffProfile(session, staffProfileId);

    if (!profile) {
      redirect("/staff?notice=staff-profile-missing");
    }

    const shouldApproveImmediately = startsAt <= vietnamStartOfToday();
    const leave = await prisma.leaveRequest.create({
      data: {
        organizationId: session.organizationId,
        clinicId: profile.clinicId,
        staffProfileId: profile.id,
        leaveType: requiredString(formData.get("leaveType")) || "ANNUAL",
        status: shouldApproveImmediately ? "APPROVED" : "REQUESTED",
        startsAt,
        endsAt,
        hours: parseMoney(formData.get("hours")),
        reason: requiredString(formData.get("reason")) || null,
        decisionNote: shouldApproveImmediately
          ? "Quản lý tạo nghỉ khẩn cấp trong ngày nên hệ thống ghi nhận đã duyệt."
          : null,
      },
      select: {
        id: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: shouldApproveImmediately
          ? "leave_request.created_approved_same_day"
          : "leave_request.created",
        entityType: "LeaveRequest",
        entityId: leave.id,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-database");
  }

  revalidatePath("/staff");
  redirect("/staff?notice=staff-leave-created");
}

export async function updateLeaveRequestStatusAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "staff.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const leaveRequestId = requiredString(formData.get("leaveRequestId"));
  const status = requiredString(formData.get("status"));

  if (!leaveRequestId || (status !== "APPROVED" && status !== "REJECTED")) {
    redirect("/staff?notice=staff-leave-missing");
  }

  const nextStatus = status as "APPROVED" | "REJECTED";

  try {
    const request = await prisma.leaveRequest.findFirst({
      where: {
        id: leaveRequestId,
        organizationId: session.organizationId,
        OR: [
          {
            clinicId: {
              in: allowedClinicIdsFor(session),
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

    if (!request) {
      redirect("/staff?notice=staff-leave-missing");
    }

    await prisma.$transaction(async (tx) => {
      await tx.leaveRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: nextStatus,
          decisionNote: requiredString(formData.get("decisionNote")) || null,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: nextStatus === "APPROVED" ? "leave_request.approved" : "leave_request.rejected",
          entityType: "LeaveRequest",
          entityId: request.id,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-database");
  }

  revalidatePath("/staff");
  redirect(`/staff?notice=${nextStatus === "APPROVED" ? "staff-leave-approved" : "staff-leave-rejected"}`);
}

export async function adjustAttendanceLogAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "staff.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const attendanceLogId = requiredString(formData.get("attendanceLogId"));
  const clockInDate = requiredString(formData.get("clockInDate"));
  const clockInTime = requiredString(formData.get("clockInTime"));
  const clockOutDate = requiredString(formData.get("clockOutDate"));
  const clockOutTime = requiredString(formData.get("clockOutTime"));
  const clockInAt = parseDateTimeInVietnam(clockInDate, clockInTime);
  const clockOutAt =
    clockOutDate && clockOutTime
      ? parseDateTimeInVietnam(clockOutDate, clockOutTime)
      : null;

  if (
    !attendanceLogId ||
    clockInAt === "invalid" ||
    clockOutAt === "invalid" ||
    (clockOutAt && clockInAt >= clockOutAt)
  ) {
    redirect("/staff?notice=staff-attendance-missing");
  }

  try {
    const log = await prisma.attendanceLog.findFirst({
      where: {
        id: attendanceLogId,
        organizationId: session.organizationId,
        clinicId: {
          in: allowedClinicIdsFor(session),
        },
      },
      select: {
        id: true,
      },
    });

    if (!log) {
      redirect("/staff?notice=staff-attendance-missing");
    }

    await prisma.$transaction(async (tx) => {
      await tx.attendanceLog.update({
        where: {
          id: log.id,
        },
        data: {
          clockInAt,
          clockOutAt,
          outStatus: requiredString(formData.get("outStatus")) || "ADJUSTED",
          note: requiredString(formData.get("note")) || null,
          adjusted: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "attendance.adjusted",
          entityType: "AttendanceLog",
          entityId: log.id,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-database");
  }

  revalidatePath("/staff");
  redirect("/staff?notice=staff-attendance-adjusted");
}

export async function approvePayrollRunAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "payroll.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const payrollRunId = requiredString(formData.get("payrollRunId"));

  try {
    const payrollRun = await scopedPayrollRun(session, payrollRunId);

    if (!payrollRun || payrollRun.status !== "DRAFT") {
      redirect("/staff?notice=staff-payroll-run-missing");
    }

    await prisma.$transaction(async (tx) => {
      await tx.payrollRun.update({
        where: {
          id: payrollRun.id,
        },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
        },
      });

      await tx.compensationAccrual.updateMany({
        where: {
          payrollRunId: payrollRun.id,
        },
        data: {
          status: "APPROVED",
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "payroll.run_approved",
          entityType: "PayrollRun",
          entityId: payrollRun.id,
          metadata: {
            netAmount: Number(payrollRun.netAmount),
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-database");
  }

  revalidatePath("/staff");
  redirect("/staff?notice=staff-payroll-approved");
}

export async function markPayrollRunPaidAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "payroll.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const payrollRunId = requiredString(formData.get("payrollRunId"));

  try {
    const payrollRun = await scopedPayrollRun(session, payrollRunId);

    if (!payrollRun || payrollRun.status !== "APPROVED") {
      redirect("/staff?notice=staff-payroll-run-missing");
    }

    await prisma.$transaction(async (tx) => {
      await tx.payrollRun.update({
        where: {
          id: payrollRun.id,
        },
        data: {
          status: "PAID",
          paidAt: new Date(),
        },
      });

      await tx.compensationAccrual.updateMany({
        where: {
          payrollRunId: payrollRun.id,
        },
        data: {
          status: "PAID",
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "payroll.run_paid",
          entityType: "PayrollRun",
          entityId: payrollRun.id,
          metadata: {
            netAmount: Number(payrollRun.netAmount),
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-database");
  }

  revalidatePath("/staff");
  redirect("/staff?notice=staff-payroll-paid");
}

export async function voidPayrollRunAction(formData: FormData) {
  const session = await requireViewSession("staff");

  if (!canPerformAction(session, "payroll.manage")) {
    redirect("/staff?notice=staff-denied");
  }

  const payrollRunId = requiredString(formData.get("payrollRunId"));

  try {
    const payrollRun = await scopedPayrollRun(session, payrollRunId);

    if (!payrollRun || payrollRun.status === "PAID" || payrollRun.status === "VOID") {
      redirect("/staff?notice=staff-payroll-run-missing");
    }

    await prisma.$transaction(async (tx) => {
      const lineIds = payrollRun.lines.map((line) => line.id);

      if (lineIds.length > 0) {
        await tx.compensationAccrualLine.updateMany({
          where: {
            payrollLineId: {
              in: lineIds,
            },
          },
          data: {
            payrollLineId: null,
          },
        });
      }

      await tx.payrollLine.deleteMany({
        where: {
          payrollRunId: payrollRun.id,
        },
      });

      await tx.compensationAccrual.updateMany({
        where: {
          payrollRunId: payrollRun.id,
        },
        data: {
          payrollRunId: null,
          status: "EARNED",
        },
      });

      await tx.payrollRun.update({
        where: {
          id: payrollRun.id,
        },
        data: {
          status: "VOID",
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "payroll.run_voided",
          entityType: "PayrollRun",
          entityId: payrollRun.id,
          metadata: {
            releasedLineCount: lineIds.length,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/staff?notice=staff-database");
  }

  revalidatePath("/staff");
  redirect("/staff?notice=staff-payroll-voided");
}

async function staffProfileMap(session: AppSession, userIds: string[]) {
  const profiles = await prisma.staffProfile.findMany({
    where: {
      organizationId: session.organizationId,
      userId: {
        in: userIds,
      },
    },
    select: {
      id: true,
      userId: true,
      employeeCode: true,
      user: {
        select: {
          role: true,
        },
      },
    },
  });

  return new Map(profiles.map((profile) => [profile.userId, profile]));
}

function allowedClinicIdsFor(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

async function scopedPayrollRun(session: AppSession, payrollRunId: string) {
  if (!payrollRunId) {
    return null;
  }

  return prisma.payrollRun.findFirst({
    where: {
      id: payrollRunId,
      organizationId: session.organizationId,
      OR: [
        {
          clinicId: {
            in: allowedClinicIdsFor(session),
          },
        },
        {
          clinicId: null,
        },
      ],
    },
    include: {
      lines: {
        select: {
          id: true,
        },
      },
    },
  });
}

async function scopedStaffProfile(session: AppSession, staffProfileId: string) {
  if (!staffProfileId) {
    return null;
  }

  return prisma.staffProfile.findFirst({
    where: {
      id: staffProfileId,
      organizationId: session.organizationId,
      OR: [
        {
          clinicId: {
            in: allowedClinicIdsFor(session),
          },
        },
        {
          clinicId: null,
        },
      ],
    },
    select: {
      id: true,
      clinicId: true,
    },
  });
}

function positiveInteger(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(Math.floor(parsed), 1);
}

function optionalPositiveInteger(value: FormDataEntryValue | null) {
  if (value == null || String(value).trim() === "") {
    return null;
  }

  return positiveInteger(value, 26);
}

function percentageInput(value: FormDataEntryValue | null) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.min(parsed, 100);
}

function optionalPercentageInput(value: FormDataEntryValue | null) {
  if (value == null || String(value).trim() === "") {
    return null;
  }

  return percentageInput(value);
}

function parsePayrollPolicyCsv(csvText: string) {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const [headerLine, ...dataLines] = lines;

  if (!headerLine) {
    return [];
  }

  const headers = splitCsvLine(headerLine).map((header) => header.trim().toLowerCase());

  return dataLines.map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });

    return row;
  });
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);

  return cells;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  const normalized = (value ?? "").trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  return ["true", "1", "yes", "y", "on"].includes(normalized);
}

function parseOverridesJson(value: FormDataEntryValue | string | null) {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Prisma.InputJsonObject)
      : false;
  } catch {
    return false;
  }
}

function nullableJson(value: Prisma.InputJsonObject | null) {
  return value ?? Prisma.JsonNull;
}

function effectivePayrollPolicyForProfile(
  policy: Awaited<ReturnType<typeof findPayrollPolicy>>,
  profile: {
    id: string;
    employeeCode: string;
    user?: {
      role: string;
    };
  },
  base: {
    insurancePercent: number;
    otherDeductionAmount: number;
    standardWorkdays: number;
    taxPercent: number;
  },
) {
  const staffOverrides = overrideRecord(policy?.staffOverrides);
  const roleOverrides = overrideRecord(policy?.roleOverrides);
  const roleKey = profile.user?.role ?? "";
  const override =
    staffOverrides[profile.id] ??
    staffOverrides[profile.employeeCode] ??
    roleOverrides[roleKey] ??
    null;

  if (!override) {
    return {
      ...base,
      source: "base",
    };
  }

  return {
    insurancePercent: overridePercent(override.insurancePercent, base.insurancePercent),
    otherDeductionAmount: overrideMoney(
      override.otherDeductionAmount,
      base.otherDeductionAmount,
    ),
    standardWorkdays: overrideWorkdays(override.standardWorkdays, base.standardWorkdays),
    taxPercent: overridePercent(override.taxPercent, base.taxPercent),
    source:
      staffOverrides[profile.id] || staffOverrides[profile.employeeCode]
        ? "staff"
        : "role",
  };
}

function overrideRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, Record<string, unknown>>;
  }

  return value as Record<string, Record<string, unknown>>;
}

function overridePercent(value: unknown, fallback: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(parsed, 100);
}

function overrideMoney(value: unknown, fallback: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function overrideWorkdays(value: unknown, fallback: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(Math.floor(parsed), 1);
}

async function findPayrollPolicy(session: AppSession, clinicId: string | null) {
  const scopeKeys = clinicId ? [clinicId, "all"] : ["all"];

  return prisma.payrollPolicy.findFirst({
    where: {
      organizationId: session.organizationId,
      scopeKey: {
        in: scopeKeys,
      },
      active: true,
    },
    orderBy: {
      clinicId: "desc",
    },
  });
}

function proratedBaseSalary(
  monthlyBaseSalary: number,
  workedDays: number,
  standardWorkdays: number,
) {
  if (monthlyBaseSalary <= 0 || standardWorkdays <= 0) {
    return 0;
  }

  return Math.round(
    (monthlyBaseSalary / standardWorkdays) *
      Math.min(Math.max(workedDays, 0), standardWorkdays),
  );
}

function buildWorkdaysByProfile(
  logs: Array<{ staffProfileId: string; clockInAt: Date }>,
) {
  const byProfile = new Map<string, Set<string>>();

  for (const log of logs) {
    const days = byProfile.get(log.staffProfileId) ?? new Set<string>();
    days.add(vietnamDateKey(log.clockInAt));
    byProfile.set(log.staffProfileId, days);
  }

  return byProfile;
}

function vietnamDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function vietnamStartOfToday() {
  return new Date(`${vietnamDateKey(new Date())}T00:00:00+07:00`);
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}
