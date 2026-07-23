import { requireViewSession } from "@/lib/auth";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export async function GET(request: Request) {
  const session = await requireViewSession("staff");
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId") ?? "";
  const payrollRun = await prisma.payrollRun.findFirst({
    where: {
      id: runId,
      organizationId: session.organizationId,
      OR: [
        {
          clinicId: {
            in: allowedClinicIds(session),
          },
        },
        {
          clinicId: null,
        },
      ],
    },
    include: {
      clinic: {
        select: {
          name: true,
        },
      },
      lines: {
        include: {
          staffProfile: {
            include: {
              user: {
                select: {
                  fullName: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: {
          employeeCode: "asc",
        },
      },
    },
  });

  if (!payrollRun) {
    return new Response("Payroll run not found", { status: 404 });
  }

  const rows = payrollRun.lines.map((line) => [
    payrollRun.id,
    payrollRun.status,
    payrollRun.clinic?.name ?? "All clinics",
    vietnamDate(payrollRun.periodStart),
    vietnamDate(payrollRun.periodEnd),
    line.employeeCode,
    line.staffProfile.user.fullName,
    line.staffProfile.user.email,
    Number(line.baseAmount),
    Number(line.commissionAmount),
    Number(line.bonusAmount),
    Number(line.deductionAmount),
    Number(line.netAmount),
    payrollMetric(line.metrics, "workedDays"),
    payrollMetric(line.metrics, "standardWorkdays"),
    payrollMetric(line.metrics, "monthlyBaseSalary"),
    payrollMetric(line.metrics, "taxAmount"),
    payrollMetric(line.metrics, "insuranceAmount"),
    payrollMetric(line.metrics, "otherDeductionAmount"),
  ]);
  const csv = [
    [
      "payroll_run_id",
      "status",
      "clinic",
      "period_start",
      "period_end",
      "employee_code",
      "employee_name",
      "email",
      "base_vnd",
      "commission_vnd",
      "bonus_vnd",
      "deduction_vnd",
      "net_vnd",
      "worked_days",
      "standard_workdays",
      "monthly_base_salary_vnd",
      "tax_vnd",
      "insurance_vnd",
      "other_deduction_vnd",
    ],
    ...rows,
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Disposition": `attachment; filename="codexmed-payroll-${payrollRun.id}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}

function payrollMetric(metrics: unknown, key: string) {
  if (!metrics || typeof metrics !== "object" || !(key in metrics)) {
    return "";
  }

  const value = (metrics as Record<string, unknown>)[key];

  return typeof value === "number" || typeof value === "string" ? value : "";
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

function csvCell(value: string | number) {
  const text = String(value);

  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}
