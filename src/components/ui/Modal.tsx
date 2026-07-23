import type { ReactNode } from "react";

export function Modal({
  children,
  className,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <div aria-labelledby={labelledBy} className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={["modal-card", className].filter(Boolean).join(" ")}>
        {children}
      </div>
    </div>
  );
}

