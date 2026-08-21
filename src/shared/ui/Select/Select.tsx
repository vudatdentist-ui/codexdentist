import type { SelectHTMLAttributes } from "react";
import styles from "../shared.module.css";
import { cx } from "../utils";
import type { ControlSize } from "../Button";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { controlSize?: ControlSize; invalid?: boolean; }
const sizeClass: Record<ControlSize, string | undefined> = { sm: styles.fieldSm, md: undefined, lg: styles.fieldLg };

export function Select({ className, controlSize = "md", invalid = false, ...props }: SelectProps) {
  return <select aria-invalid={invalid || props["aria-invalid"] || undefined} className={cx(styles.field, styles.select, sizeClass[controlSize], invalid && styles.fieldInvalid, className)} {...props} />;
}
