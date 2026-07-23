"use client";

import Link from "next/link";

export function FormTemplatePrintActions() {
  return (
    <div className="print-actions">
      <Link href="/forms">Quay lại biểu mẫu</Link>
      <button type="button" onClick={() => window.print()}>
        In biểu mẫu
      </button>
    </div>
  );
}
