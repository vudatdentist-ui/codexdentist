import type { HTMLAttributes, ReactNode } from "react";
import styles from "../shared.module.css";
import { cx } from "../utils";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  action?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}

export function EmptyState({ action, className, description, icon, title, ...props }: EmptyStateProps) {
  return (
    <div className={cx(styles.emptyState, className)} {...props}>
      {icon && <div aria-hidden="true" className={styles.emptyIcon}>{icon}</div>}
      <h3 className={styles.emptyTitle}>{title}</h3>
      {description && <p className={styles.emptyDescription}>{description}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}
