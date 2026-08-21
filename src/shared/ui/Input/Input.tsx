import type { InputHTMLAttributes } from "react";
import styles from "../shared.module.css";
import { cx } from "../utils";
import type { ControlSize } from "../Button";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> { controlSize?: ControlSize; invalid?: boolean; }
const sizeClass: Record<ControlSize, string | undefined> = { sm: styles.fieldSm, md: undefined, lg: styles.fieldLg };

export function Input({ className, controlSize = "md", invalid = false, ...props }: InputProps) {
  return <input aria-invalid={invalid || props["aria-invalid"] || undefined} className={cx(styles.field, sizeClass[controlSize], invalid && styles.fieldInvalid, className)} {...props} />;
}
