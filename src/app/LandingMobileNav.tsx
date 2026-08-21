"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";
import styles from "./landing.module.css";

type LandingMobileNavProps = {
  demoUrl: string;
  sourceUrl: string;
};

export function LandingMobileNav({ demoUrl, sourceUrl }: LandingMobileNavProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  function closeMenu() {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !detailsRef.current?.open) {
      return;
    }

    event.preventDefault();
    closeMenu();
    summaryRef.current?.focus();
  }

  return (
    <details
      className={styles.mobileMenu}
      data-qa="mobile-menu"
      ref={detailsRef}
      onKeyDown={handleKeyDown}
    >
      <summary ref={summaryRef} aria-label="Mở điều hướng">
        Menu
      </summary>
      <div className={styles.mobileMenuPanel}>
        <nav aria-label="Điều hướng trên di động">
          <a href="#san-pham" onClick={closeMenu}>
            Sản phẩm
          </a>
          <a href="#ma-nguon-mo" onClick={closeMenu}>
            Mã nguồn mở
          </a>
          <a href="#trien-khai" onClick={closeMenu}>
            Triển khai
          </a>
          <Link href="/docs" data-qa="docs-cta-mobile" onClick={closeMenu}>
            Tài liệu
          </Link>
          <a href={sourceUrl} onClick={closeMenu}>
            GitHub
          </a>
        </nav>
        <Link className={styles.headerCta} href={demoUrl} onClick={closeMenu}>
          Dùng thử 24 giờ
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </details>
  );
}
