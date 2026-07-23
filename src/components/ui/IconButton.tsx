import type { ButtonHTMLAttributes, ReactNode } from "react";

export function IconButton({
  children,
  className,
  label,
  title,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      className={["icon-button", className].filter(Boolean).join(" ")}
      title={title ?? label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

