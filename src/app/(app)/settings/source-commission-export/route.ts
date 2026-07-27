import { requireViewSession } from "@/lib/auth";
import { csvCell } from "@/lib/csv";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await requireViewSession("settings");

  try {
    const accruals = await prisma.sourceCommissionAccrual.findMany({
      where: {
        organizationId: session.organizationId,
        clinicId: {
          in: session.clinicIds,
        },
      },
      include: {
        clinic: {
          select: {
            name: true,
          },
        },
        patient: {
          select: {
            fullName: true,
            phone: true,
          },
        },
        receipt: {
          select: {
            receiptNo: true,
          },
        },
        policy: {
          select: {
            name: true,
            ownerLabel: true,
          },
        },
      },
      orderBy: {
        earnedAt: "desc",
      },
    });

    const rows = [
      [
        "source",
        "policy",
        "owner",
        "clinic",
        "patient",
        "phone",
        "receipt_no",
        "base_amount",
        "rate_percent",
        "fixed_amount",
        "commission_amount",
        "status",
        "earned_at",
        "paid_at",
      ],
      ...accruals.map((accrual) => [
        accrual.source,
        accrual.policy.name,
        accrual.policy.ownerLabel ?? "",
        accrual.clinic.name,
        accrual.patient.fullName,
        accrual.patient.phone ?? "",
        accrual.receipt.receiptNo,
        Number(accrual.baseAmount),
        Number(accrual.ratePercent),
        Number(accrual.fixedAmount),
        Number(accrual.commissionAmount),
        accrual.status,
        accrual.earnedAt.toISOString(),
        accrual.paidAt?.toISOString() ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");

    return new Response(csv, {
      headers: {
        "Content-Disposition": "attachment; filename=source-commission.csv",
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(error);
    return new Response("Source commission export failed.", { status: 500 });
  }
}
