"use client";

import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useRef } from "react";
import styles from "./landing.module.css";

const links = [
  ["#mot-ngay", "Cách vận hành"],
  ["#dung-thu", "Dùng thử 30 ngày"],
  ["/features", "Tính năng"],
] as const;

export function LandingNav() {
  const disclosure = useRef<HTMLDetailsElement>(null);

  function closeMenu(restoreFocus = false) {
    if (!disclosure.current) return;
    disclosure.current.open = false;

    if (restoreFocus) {
      disclosure.current.querySelector("summary")?.focus();
    }
  }

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.brand} aria-label="Codexdentist - Trang chủ">
          <img src="/icons/codexmed-icon.svg" width="34" height="34" alt="" />
          <span>codexdentist<span className={styles.brandDot}>.</span></span>
        </Link>

        <nav className={styles.desktopNav} aria-label="Điều hướng chính">
          {links.map(([href, label]) => (
            <Link key={href} href={href}>{label}</Link>
          ))}
        </nav>

        <div className={styles.headerActions}>
          <Link className={styles.loginLink} href="/login">Đăng nhập</Link>
          <Link className={styles.headerCta} href="/signup">
            Dùng thử miễn phí
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>

        <details
          ref={disclosure}
          className={styles.mobileMenu}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeMenu(true);
          }}
        >
          <summary aria-label="Mở hoặc đóng điều hướng">
            <Menu className={styles.menuOpen} size={22} aria-hidden="true" />
            <X className={styles.menuClose} size={22} aria-hidden="true" />
          </summary>
          <nav aria-label="Điều hướng di động" onClick={() => closeMenu()}>
            {links.map(([href, label]) => (
              <Link key={href} href={href}>
                {label}
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            ))}
            <Link href="/signup">
              Dùng thử miễn phí 30 ngày
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
            <Link href="/login">
              Đăng nhập
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
