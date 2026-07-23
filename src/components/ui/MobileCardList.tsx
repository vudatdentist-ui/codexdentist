import type { HTMLAttributes, ReactNode } from "react";

export function MobileCardList({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
}) {
  return (
    <div className={["mobile-card-list", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
}

