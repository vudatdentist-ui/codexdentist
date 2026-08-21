import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "../shared.module.css";
import { cx } from "../utils";
import type { ButtonVariant, ControlSize } from "../Button";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  "aria-label": string;
  children: ReactNode;
  loading?: boolean;
  size?: ControlSize;
  variant?: ButtonVariant;
}

const variantClass: Record<ButtonVariant, string> = { primary: styles.primary, secondary: styles.secondary, ghost: styles.ghost, danger: styles.danger };
const sizeClass: Record<ControlSize, string | undefined> = { sm: styles.iconButtonSm, md: undefined, lg: styles.iconButtonLg };

export function IconButton({ children, className, disabled, loading = false, size = "md", type = "button", variant = "ghost", ...props }: IconButtonProps) {
  return <button aria-busy={loading || undefined} className={cx(styles.iconButton, variantClass[variant], sizeClass[size], className)} disabled={disabled || loading} type={type} {...props}>{loading ? <span aria-hidden="true" className={styles.spinner} /> : children}</button>;
}
