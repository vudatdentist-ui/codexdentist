import type { LucideIcon } from "lucide-react";
export {
  EmptyState,
  MetricCard,
  PanelHeader,
  StatusPill,
  type MetricTone,
} from "@/components/ui";

export function SurfaceCard({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <article className="surface-card">
      <Icon size={20} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{text}</p>
    </article>
  );
}

export function RecordTile({ title, value }: { title: string; value: string }) {
  return (
    <div className="record-tile">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}
