import type { HTMLAttributes } from "react";
import styles from "../shared.module.css";
import { cx } from "../utils";

export type AvatarSize = "sm" | "md" | "lg";
export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> { alt?: string; initials?: string; size?: AvatarSize; src?: string | null; }
const sizeClass: Record<AvatarSize, string> = { sm: styles.avatarSm, md: styles.avatarMd, lg: styles.avatarLg };

export function Avatar({ alt = "", className, initials, size = "md", src, ...props }: AvatarProps) {
  return <span aria-label={!src && alt ? alt : undefined} className={cx(styles.avatar, sizeClass[size], className)} role={!src && alt ? "img" : undefined} {...props}>{src ? <img alt={alt} src={src} /> : <span aria-hidden={Boolean(alt)}>{initials?.slice(0, 2).toUpperCase() ?? ""}</span>}</span>;
}
