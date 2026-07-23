export function StatusPill({
  className,
  label,
  status,
}: {
  className?: string;
  label?: string;
  status: string;
}) {
  return (
    <span className={["status", status.toLowerCase().replace(/\s+/g, "-"), className].filter(Boolean).join(" ")}>
      {label ?? status}
    </span>
  );
}

