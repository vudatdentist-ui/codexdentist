import type { ReactNode } from "react";
import type { UiTone } from "./types";

export function Badge({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: UiTone;
}) {
  return (
    <span className={["badge", tone, className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}

