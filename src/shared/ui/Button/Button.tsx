import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "../shared.module.css";
import { cx } from "../utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ControlSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  fullWidth?: boolean;
  loading?: boolean;
  size?: ControlSize;
  variant?: ButtonVariant;
}

const variantClass: Record<ButtonVariant, string> = { primary: styles.primary, secondary: styles.secondary, ghost: styles.ghost, danger: styles.danger };
const sizeClass: Record<ControlSize, string | undefined> = { sm: styles.controlSm, md: undefined, lg: styles.controlLg };

export function Button({ children, className, disabled, fullWidth = false, loading = false, size = "md", type = "button", variant = "secondary", ...props }: ButtonProps) {
  return <button aria-busy={loading || undefined} className={cx(styles.control, variantClass[variant], sizeClass[size], fullWidth && styles.fullWidth, className)} disabled={disabled || loading} type={type} {...props}>{loading && <span aria-hidden="true" className={styles.spinner} />}{children}</button>;
}
