import type { HTMLAttributes, ReactNode } from "react";

export function DataTable({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
}) {
  return (
    <div className={["table-wrap", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
}

