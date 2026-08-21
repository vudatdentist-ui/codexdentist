import type { HTMLAttributes, ReactNode } from "react";
import styles from "../shared.module.css";
import { cx } from "../utils";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> { children: ReactNode; tone?: BadgeTone; }
const toneClass: Record<BadgeTone, string> = { neutral: styles.neutral, info: styles.info, success: styles.success, warning: styles.warning, danger: styles.dangerTone };

export function Badge({ children, className, tone = "neutral", ...props }: BadgeProps) {
  return <span className={cx(styles.badge, toneClass[tone], className)} {...props}>{children}</span>;
}
