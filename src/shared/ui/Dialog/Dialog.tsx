"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "../shared.module.css";
import { cx } from "../utils";

export interface DialogProps {
  children: ReactNode;
  className?: string;
  closeLabel: string;
  description?: ReactNode;
  footer?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  size?: "sm" | "md" | "lg";
  title: ReactNode;
}

const sizeClass = {
  sm: styles.dialogSm,
  md: undefined,
  lg: styles.dialogLg,
} as const;

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.closest("[hidden], [aria-hidden='true']"),
  );
}

export function Dialog({
  children,
  className,
  closeLabel,
  description,
  footer,
  onOpenChange,
  open,
  size = "md",
  title,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || active === dialog || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || active === dialog || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    (closeRef.current ?? dialogRef.current)?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onOpenChange, open]);

  if (!open) return null;

  return (
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onOpenChange(false);
      }}
    >
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cx(styles.dialog, sizeClass[size], className)}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <div className={styles.dialogHeading}>
            <h2 className={styles.dialogTitle} id={titleId}>
              {title}
            </h2>
            {description && (
              <p className={styles.dialogDescription} id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          <button
            aria-label={closeLabel}
            className={styles.dialogClose}
            onClick={() => onOpenChange(false)}
            ref={closeRef}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className={styles.dialogBody}>{children}</div>
        {footer && <footer className={styles.dialogFooter}>{footer}</footer>}
      </section>
    </div>
  );
}
