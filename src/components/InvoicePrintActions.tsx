"use client";

import { ArrowLeft, Download, Printer } from "lucide-react";
import Link from "next/link";

export function InvoicePrintActions() {
  return (
    <div className="print-actions">
      <Link href="/billing" className="secondary-button">
        <ArrowLeft size={16} aria-hidden="true" />
        Back to billing
      </Link>
      <a href="/billing/export" className="secondary-button">
        <Download size={16} aria-hidden="true" />
        Export CSV
      </a>
      <button className="primary-button" type="button" onClick={() => window.print()}>
        <Printer size={16} aria-hidden="true" />
        Print invoice
      </button>
    </div>
  );
}
