import { ensureStaffProfiles } from "@/lib/payroll";
import "server-only";
import { accessibleClinicIds as allowedClinicIdsFor } from "@/lib/tenant-scope";
import { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId, } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { findPayrollPolicy, staffProfileMap, buildWorkdaysByProfile, effectivePayrollPolicyForProfile, proratedBaseSalary, } from "@/lib/application/staff/support";
export async function createPayrollRunFromAccrualsCommand(input: {
    session: AppSession;
    submittedStandardWorkdays: number | null;
    submittedTaxPercent: number | null;
    submittedInsurancePercent: number | null;
    submittedOtherDeductionAmount: number | null;
    periodStart: import("@/lib/form-validation").ParsedDate;
    periodEnd: Date | "invalid";
    includeBaseSalary: boolean;
    clinicId: string;
}) {
    const { session, submittedStandardWorkdays, submittedTaxPercent, submittedInsurancePercent, submittedOtherDeductionAmount, periodStart, periodEnd, includeBaseSalary, clinicId } = input;
    if (!canPerformAction(session, "payroll.manage")) {
        failCommand("staff-denied");
    }
    const allowedClinicIds = allowedClinicIdsFor(session);
    const scopedClinicId = clinicId && clinicId !== "all" ? clinicId : null;
    if (periodStart === "invalid" ||
        periodEnd === "invalid" ||
        !periodStart ||
        !periodEnd) {
        failCommand("staff-payroll-date");
    }
    if (scopedClinicId && !allowedClinicIds.includes(scopedClinicId)) {
        failCommand("staff-denied");
    }
    await ensureStaffProfiles(session);
    const payrollPolicy = await findPayrollPolicy(session, scopedClinicId);
    const standardWorkdays = submittedStandardWorkdays ?? payrollPolicy?.standardWorkdays ?? 26;
    const taxPercent = submittedTaxPercent ?? Number(payrollPolicy?.taxPercent ?? 0);
    const insurancePercent = submittedInsurancePercent ?? Number(payrollPolicy?.insurancePercent ?? 0);
    const otherDeductionAmount = Math.max(Number(submittedOtherDeductionAmount ?? payrollPolicy?.otherDeductionAmount ?? 0), 0);
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
        failCommand("staff-payroll-empty");
    }
    const profileByUserId = await staffProfileMap(session, Array.from(new Set(accrualLines.map((line) => line.userId))));
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
            const lineDeductionAmount = Math.min(grossLineAmount, taxAmount + insuranceAmount + effectivePolicy.otherDeductionAmount);
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
}
