import { requireViewSession } from "@/lib/auth";
import { csvCell } from "@/lib/csv";
import { getBillingWorkspace } from "@/lib/billing";

export async function GET() {
  const session = await requireViewSession("billing");
  const workspace = await getBillingWorkspace(session);
  const generatedAt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());

  const rows = workspace.invoices.map((invoice) => {
    const paidAmount =
      invoice.paidAmount ?? (invoice.status === "Paid" ? invoice.amount : 0);
    const clinic = session.clinics.find((item) => item.id === invoice.clinicId);

    return [
      invoice.id,
      clinic?.name ?? invoice.clinicId,
      clinic?.city ?? "",
      invoice.patient,
      invoice.due,
      invoice.status,
      invoice.amount,
      paidAmount,
      invoice.amount - paidAmount,
      workspace.source,
      generatedAt,
    ];
  });

  const csv = [
    [
      "invoice_no",
      "clinic",
      "city",
      "patient",
      "due_date",
      "status",
      "amount_vnd",
      "paid_vnd",
      "balance_vnd",
      "source",
      "exported_at",
    ],
    ...rows,
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Disposition": `attachment; filename="codexmed-invoices-${generatedAt}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
