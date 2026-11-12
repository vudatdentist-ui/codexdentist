// Reports/Dashboard domain read semantics. Inputs must already be tenant/clinic scoped.
export function resolveReportPeriod(
  options: { from?: string | null; to?: string | null } = {},
  now = new Date(),
) {
  const todayKey = vietnamDateKey(now);
  const fromKey = parseVietnamDateKey(options.from) ?? `${todayKey.slice(0, 7)}-01`;
  const toKey = parseVietnamDateKey(options.to) ?? todayKey;
  const from = fromKey <= toKey ? fromKey : toKey;
  const to = fromKey <= toKey ? toKey : fromKey;

  return {
    from,
    to,
    start: new Date(`${from}T00:00:00+07:00`),
    end: new Date(`${to}T23:59:59.999+07:00`),
  };
}

export function invoiceProductionByClinic(
  invoices: readonly { clinicId: string; createdAt: Date; status: string; amount: unknown }[],
  period: { start: Date; end: Date },
) {
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    // Preserve Reports' gross invoice amounts, including DRAFT. Refunds affect
    // paidAmount/Payments; receipts and credit applications are separate concepts.
    if (invoice.status !== "VOID" && invoice.createdAt >= period.start && invoice.createdAt <= period.end) {
      totals.set(invoice.clinicId, (totals.get(invoice.clinicId) ?? 0) + Number(invoice.amount));
    }
  }
  return totals;
}

function parseVietnamDateKey(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime()) || vietnamDateKey(date) !== value) {
    return null;
  }
  return value;
}

function vietnamDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
  }).format(date);
}
