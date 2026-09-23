"use client";

import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { WorkspaceDialog } from "@/shared/ui/WorkspaceDialog/WorkspaceDialog";
import { nextTabIndex } from "@/shared/ui/tab-navigation";

export function OperationalDialog({ label, onClose, children }: {
  label: string; onClose: () => void; children: ReactNode;
}) {
  return <WorkspaceDialog open onClose={onClose} title={label} closeLabel={label}
    hideHeader className="operational-dialog">{children}</WorkspaceDialog>;
}

export function WorkspaceTabs({ children, className = "", onKeyDown, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tabs = ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.forEach(tab => { tab.tabIndex = tab.getAttribute("aria-selected") === "true" && !tab.disabled ? 0 : -1; });
  });
  return <div {...props} ref={ref} role="tablist" className={`workspace-tabs ${className}`} onKeyDown={event => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
    const current = event.target.closest<HTMLButtonElement>('[role="tab"]');
    if (!current) return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .filter(tab => !tab.disabled && tab.getAttribute("aria-disabled") !== "true");
    const index = nextTabIndex(event.key, tabs.indexOf(current), tabs.length);
    if (index === null) return;
    event.preventDefault();
    tabs[index].focus();
    tabs[index].click();
    tabs[index].scrollIntoView({ block: "nearest", inline: "nearest" });
  }}>{children}</div>;
}
