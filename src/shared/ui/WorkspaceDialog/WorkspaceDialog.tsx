"use client";
import { useEffect, useId, useRef, type ReactNode, type KeyboardEvent } from "react";
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
  function containTab(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget;
    const targets = [...dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
    )].filter(node => node.tabIndex >= 0 && !node.matches(":disabled") && !node.closest("[inert]") && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden");
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
    const active = document.activeElement;
    // Keep keyboard traversal inside the dialog when native focus would leave it.
    if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
      event.preventDefault(); first.focus();
    }
  }
  return (
    <dialog ref={ref} className={`workspace-dialog ${className}`} aria-labelledby={titleId} onKeyDown={containTab}
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
