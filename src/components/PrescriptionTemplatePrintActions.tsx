"use client";

import Link from "next/link";

export function PrescriptionTemplatePrintActions() {
  return (
    <div className="print-actions">
      <Link href="/pharmacy">Quay lại đơn thuốc</Link>
      <button type="button" onClick={() => window.print()}>
        In đơn thuốc
      </button>
    </div>
  );
}
