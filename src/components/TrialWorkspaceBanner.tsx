"use client";

import { CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";

export function TrialWorkspaceBanner({ expiresAt }: { expiresAt: number }) {
  const [remaining, setRemaining] = useState(() => remainingText(expiresAt));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemaining(remainingText(expiresAt));
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return (
    <aside className="trial-workspace-banner" aria-label="Trạng thái dùng thử">
      <div>
        <CalendarClock size={16} aria-hidden="true" />
        <strong>Dùng thử Codexdentist</strong>
        <span>{remaining}</span>
      </div>
      <span>Workspace riêng của phòng khám</span>
    </aside>
  );
}

function remainingText(expiresAt: number) {
  const remainingMs = Math.max(0, expiresAt - Date.now());
  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

  if (remainingMs <= 0) {
    return "Đã hết hạn";
  }

  if (remainingDays === 1) {
    return "Còn 1 ngày";
  }

  return `Còn ${remainingDays} ngày`;
}
