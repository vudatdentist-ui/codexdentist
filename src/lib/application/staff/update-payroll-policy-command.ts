import "server-only";
import { accessibleClinicIds as allowedClinicIdsFor } from "@/lib/tenant-scope";
import { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId, } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { nullableJson, } from "@/lib/application/staff/support";
export async function updatePayrollPolicyCommand(input: {
    session: AppSession;
    roleOverrides: false | Prisma.InputJsonObject | null;
    staffOverrides: false | Prisma.InputJsonObject | null;
    includeBaseSalary: boolean;
    standardWorkdays: number;
    taxPercent: number;
    insurancePercent: number;
    otherDeductionAmount: number;
    clinicIdInput: string;
}) {
    const { session, roleOverrides, staffOverrides, includeBaseSalary, standardWorkdays, taxPercent, insurancePercent, otherDeductionAmount, clinicIdInput } = input;
    if (!canPerformAction(session, "payroll.manage")) {
        failCommand("staff-denied");
    }
    const scopedClinicId = clinicIdInput && clinicIdInput !== "all" ? clinicIdInput : null;
    const allowedClinicIds = allowedClinicIdsFor(session);
    if (scopedClinicId && !allowedClinicIds.includes(scopedClinicId)) {
        failCommand("staff-denied");
    }
    if (roleOverrides === false || staffOverrides === false) {
        failCommand("staff-payroll-policy-bad-json");
    }
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
        failCommand("staff-denied");
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
}
