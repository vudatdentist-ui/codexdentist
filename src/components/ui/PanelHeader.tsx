import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PanelHeader({
  action,
  icon: Icon,
  title,
}: {
  action?: ReactNode;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="panel-header">
      <div>
        <Icon size={18} aria-hidden="true" />
        <strong>{title}</strong>
      </div>
      {action != null && <span className="panel-header-action">{action}</span>}
    </div>
  );
}
