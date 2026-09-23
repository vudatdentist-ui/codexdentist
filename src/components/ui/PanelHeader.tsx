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
        <Icon size={18} strokeWidth={1.65} aria-hidden="true" />
        <h2 className="panel-title">{title}</h2>
      </div>
      {action != null && <span className="panel-header-action">{action}</span>}
    </div>
  );
}
