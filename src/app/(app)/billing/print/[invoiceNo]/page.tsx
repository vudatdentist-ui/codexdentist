import { notFound } from "next/navigation";
import { InvoicePrintActions } from "@/components/InvoicePrintActions";
import { requireViewSession } from "@/lib/auth";
import { getPrintableInvoice } from "@/lib/billing";
import { formatVnd } from "@/lib/data";

type PrintInvoicePageProps = {
  params: Promise<{
    invoiceNo: string;
  }>;
};

export default async function PrintInvoicePage({ params }: PrintInvoicePageProps) {
  const session = await requireViewSession("billing");
  const { invoiceNo } = await params;
  const invoice = await getPrintableInvoice(session, decodeURIComponent(invoiceNo));

  if (!invoice) {
    notFound();
  }

  const paidAmount =
    invoice.paidAmount ?? (invoice.status === "Paid" ? invoice.amount : 0);
  const balance = invoice.amount - paidAmount;

  return (
    <main className="print-shell">
      <InvoicePrintActions />

      <article className="invoice-template">
        <header className="invoice-template-header">
          <div>
            <p className="eyebrow">Clinic invoice</p>
            <h1>{invoice.id}</h1>
          </div>
          <div className="invoice-brand">
            <img src="/icons/codexmed-icon.svg" alt="" aria-hidden="true" />
            <strong>Codexdentist</strong>
            <span>SMART DENTAL SOLUTIONS</span>
          </div>
        </header>

        <section className="invoice-meta-grid">
          <div>
            <span>Clinic</span>
            <strong>{invoice.clinicName}</strong>
            <small>{invoice.clinicCity}</small>
          </div>
          <div>
            <span>Patient</span>
            <strong>{invoice.patient}</strong>
            <small>{invoice.patientPhone ?? "No phone on file"}</small>
            {invoice.patientEmail && <small>{invoice.patientEmail}</small>}
          </div>
          <div>
            <span>Invoice status</span>
            <strong>{invoice.status}</strong>
            <small>Issued {invoice.issuedAt}</small>
            <small>Due {invoice.due}</small>
          </div>
        </section>

        <section className="invoice-total-band">
          <div>
            <span>Total</span>
            <strong>{formatVnd(invoice.amount)}</strong>
          </div>
          <div>
            <span>Paid</span>
            <strong>{formatVnd(paidAmount)}</strong>
          </div>
          <div>
            <span>Balance due</span>
            <strong>{formatVnd(balance)}</strong>
          </div>
        </section>

        <section className="invoice-ledger">
          <div className="invoice-ledger-row head">
            <span>Description</span>
            <span>Amount</span>
          </div>
          {invoice.items.length ? (
            invoice.items.map((item) => (
              <div
                className="invoice-ledger-row"
                key={`${item.serviceCode ?? "manual"}-${item.description}-${item.amount}`}
              >
                <span>
                  {item.serviceCode ? `${item.serviceCode} - ` : ""}
                  {item.description}
                </span>
                <strong>{formatVnd(item.amount)}</strong>
              </div>
            ))
          ) : (
            <div className="invoice-ledger-row">
              <span>Dental services and treatment charges</span>
              <strong>{formatVnd(invoice.amount)}</strong>
            </div>
          )}
        </section>

        <section className="invoice-ledger">
          <div className="invoice-ledger-row head">
            <span>Payment history</span>
            <span>Amount</span>
          </div>
          {invoice.payments.length ? (
            invoice.payments.map((payment) => (
              <div
                className="invoice-ledger-row"
                key={`${payment.paidAt}-${payment.amount}-${payment.method}`}
              >
                <span>
                  {payment.paidAt} - {payment.method}
                  {payment.reference ? ` - ${payment.reference}` : ""}
                </span>
                <strong>{formatVnd(payment.amount)}</strong>
              </div>
            ))
          ) : (
            <div className="invoice-ledger-row muted">
              <span>No payment recorded</span>
              <strong>{formatVnd(0)}</strong>
            </div>
          )}
        </section>

        <section className="invoice-notes-grid">
          <div>
            <strong>Payment instructions</strong>
            <p>
              Please reference invoice {invoice.id} when paying by bank transfer or
              card terminal. Front desk should reconcile this invoice before end of
              day close.
            </p>
          </div>
          <div>
            <strong>Accounting note</strong>
            <p>
              This document supports clinic workflow review and patient payment
              collection. Issue statutory tax invoices through the clinic accounting
              system when required.
            </p>
          </div>
        </section>

        <footer className="invoice-signature-grid">
          <div>
            <span>Prepared by</span>
            <strong>{session.fullName}</strong>
          </div>
          <div>
            <span>Patient signature</span>
            <strong>&nbsp;</strong>
          </div>
        </footer>
      </article>
    </main>
  );
}
