import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variantClass: Record<ButtonVariant, string> = {
  primary: "primary-button",
  secondary: "secondary-button",
  ghost: "ghost-button",
  danger: "danger-button",
};

export function Button({
  children,
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
}) {
  return (
    <button
      className={[variantClass[variant], className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}

