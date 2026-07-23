"use client";

import { Clock3, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

export function DemoWorkspaceBanner({ expiresAt }: { expiresAt: number }) {
  const [remaining, setRemaining] = useState(() => remainingText(expiresAt));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemaining(remainingText(expiresAt));
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return (
    <aside className="demo-workspace-banner">
      <div>
        <Clock3 size={16} />
        <strong>Workspace demo</strong>
        <span>{remaining}</span>
      </div>
      <a href="https://codexdentist.com" target="_blank" rel="noreferrer">
        Cài đặt Codexdentist
        <ExternalLink size={14} />
      </a>
    </aside>
  );
}

function remainingText(expiresAt: number) {
  const remainingMinutes = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  if (remainingMinutes <= 0) {
    return "Đã hết hạn";
  }

  return `Còn ${hours} giờ ${minutes} phút`;
}
