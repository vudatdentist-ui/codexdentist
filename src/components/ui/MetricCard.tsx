import type { UiTone } from "./types";

export type MetricTone = UiTone;

export function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: MetricTone;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

