import type { HTMLAttributes, ReactNode } from "react";
import styles from "../shared.module.css";
import { cx } from "../utils";

export interface SurfaceProps extends HTMLAttributes<HTMLElement> { as?: "article" | "div" | "section"; children: ReactNode; padding?: "none" | "sm" | "md" | "lg"; raised?: boolean; }
const paddingClass = { none: undefined, sm: styles.surfacePaddingSm, md: styles.surfacePaddingMd, lg: styles.surfacePaddingLg } as const;

export function Surface({ as: Component = "div", children, className, padding = "md", raised = false, ...props }: SurfaceProps) {
  return <Component className={cx(styles.surface, paddingClass[padding], raised && styles.surfaceRaised, className)} {...props}>{children}</Component>;
}
