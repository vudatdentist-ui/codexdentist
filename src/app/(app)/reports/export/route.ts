import { requireViewSession } from "@/lib/auth";
import { csvCell } from "@/lib/csv";
import { getReportsWorkspace } from "@/lib/reports";

export async function GET(request: Request) {
  const session = await requireViewSession("reports");
  const url = new URL(request.url);
  const workspace = await getReportsWorkspace(session, {
    clinicId: url.searchParams.get("clinicId"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  const generatedAt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());

  const rows: Array<Array<string | number>> = [
    [
      "section",
      "clinic_or_group",
      "metric",
      "value",
      "amount_vnd",
      "source",
      "period",
      "exported_at",
    ],
    ...workspace.clinicReports.flatMap((clinic) => [
      [
        "clinic",
        clinic.name,
        "production",
        clinic.todayVisits,
        clinic.production,
        workspace.source,
        workspace.periodLabel,
        generatedAt,
      ],
      [
        "clinic",
        clinic.name,
        "collection",
        clinic.collectionRatio ?? 0,
        clinic.collection,
        workspace.source,
        workspace.periodLabel,
        generatedAt,
      ],
      [
        "clinic",
        clinic.name,
        "open_balance",
        clinic.overdueInvoices,
        clinic.openBalance,
        workspace.source,
        workspace.periodLabel,
        generatedAt,
      ],
    ]),
    ...workspace.serviceMix.map((item) => [
      "service_mix",
      item.label,
      item.serviceCode ?? "",
      item.quantity,
      item.production,
      workspace.source,
      workspace.periodLabel,
      generatedAt,
    ]),
    ...workspace.patientSourceMix.map((item) => [
      "patient_source",
      item.source,
      `roi_${item.roiPercent ?? "na"}`,
      item.newPatientCount,
      item.collection,
      workspace.source,
      workspace.periodLabel,
      generatedAt,
    ]),
    ...workspace.aging.map((bucket) => [
      "aging",
      bucket.label,
      "open_balance",
      bucket.count,
      bucket.amount,
      workspace.source,
      workspace.periodLabel,
      generatedAt,
    ]),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Disposition": `attachment; filename="codexmed-reports-${generatedAt}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
