import { requireViewSession } from "@/lib/auth";
import { csvCell } from "@/lib/csv";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export async function GET() {
  const session = await requireViewSession("staff");
  const policies = await prisma.payrollPolicy.findMany({
    where: {
      organizationId: session.organizationId,
      OR: [
        {
          scopeKey: "all",
        },
        {
          clinicId: {
            in: allowedClinicIds(session),
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
    orderBy: [{ clinicId: "asc" }, { updatedAt: "desc" }],
  });
  const csv = [
    [
      "scope_key",
      "clinic_name",
      "policy_name",
      "include_base_salary",
      "standard_workdays",
      "tax_percent",
      "insurance_percent",
      "other_deduction_vnd",
      "role_overrides_json",
      "staff_overrides_json",
      "active",
    ],
    ...policies.map((policy) => [
      policy.scopeKey,
      policy.clinic?.name ?? "All clinics",
      policy.name,
      policy.includeBaseSalary ? "true" : "false",
      policy.standardWorkdays,
      Number(policy.taxPercent),
      Number(policy.insurancePercent),
      Number(policy.otherDeductionAmount),
      policy.roleOverrides ? JSON.stringify(policy.roleOverrides) : "",
      policy.staffOverrides ? JSON.stringify(policy.staffOverrides) : "",
      policy.active ? "true" : "false",
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Disposition": 'attachment; filename="codexmed-payroll-policies.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}
