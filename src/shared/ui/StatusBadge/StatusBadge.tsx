import type { ReactNode } from "react";
import { Badge, type BadgeProps } from "../Badge";
import styles from "../shared.module.css";

export interface StatusBadgeProps extends BadgeProps { children: ReactNode; dot?: boolean; }
export function StatusBadge({ children, dot = true, ...props }: StatusBadgeProps) {
  return <Badge {...props}>{dot && <span aria-hidden="true" className={styles.statusDot} />}{children}</Badge>;
}
