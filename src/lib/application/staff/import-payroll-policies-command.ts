import "server-only";
import { accessibleClinicIds as allowedClinicIdsFor } from "@/lib/tenant-scope";
import { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId, parseMoney, } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { nullableJson, parsePayrollPolicyCsv, positiveInteger, percentageInput, parseOverridesJson, parseBoolean, } from "@/lib/application/staff/support";
export async function importPayrollPoliciesCommand(input: {
    csvText: string;
    session: AppSession;
}) {
    const { csvText, session } = input;
    if (!canPerformAction(session, "payroll.manage")) {
        failCommand("staff-denied");
    }
    if (!csvText) {
        failCommand("staff-payroll-policy-import-empty");
    }
    const allowedClinicIds = allowedClinicIdsFor(session);
    const rows = parsePayrollPolicyCsv(csvText);
    if (rows.length === 0) {
        failCommand("staff-payroll-policy-import-empty");
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
    const clinicByName = new Map(clinics.map((clinic) => [clinic.name.trim().toLowerCase(), clinic]));
    let importedCount = 0;
    for (const row of rows) {
        const scopeKey = (row.scope_key || row.scope || "all").trim();
        const clinicName = (row.clinic_name || row.clinic || "").trim();
        const clinic = scopeKey && scopeKey !== "all"
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
        const otherDeductionAmount = Math.max(Number(parseMoney(row.other_deduction_vnd ?? "") ?? 0), 0);
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
                name: row.policy_name?.trim() ||
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
                name: row.policy_name?.trim() ||
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
        failCommand("staff-payroll-policy-import-empty");
    }
}
