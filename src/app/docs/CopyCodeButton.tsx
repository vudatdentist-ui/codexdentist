"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyCodeButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className="docs-copy-command"
      onClick={copyValue}
      aria-label={copied ? "Đã sao chép lệnh" : "Sao chép lệnh"}
      title={copied ? "Đã sao chép" : "Sao chép lệnh"}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
      <span>{copied ? "Đã sao chép" : "Sao chép"}</span>
    </button>
  );
}
