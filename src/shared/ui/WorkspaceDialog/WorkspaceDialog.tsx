"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function WorkspaceDialog({ open, onClose, title, closeLabel, className = "", children }: {
  open: boolean; onClose: () => void; title: string; closeLabel: string;
  className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  return (
    <dialog ref={ref} className={`workspace-dialog ${className}`} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="workspace-dialog-surface">
        <header className="workspace-dialog-heading"><h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" aria-label={closeLabel} onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        {open ? children : null}
      </div>
    </dialog>
  );
}
