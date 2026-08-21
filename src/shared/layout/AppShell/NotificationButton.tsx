"use client";

import { Bell, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/components/AppLanguage";
import type { AppShellNotification } from "./types";
import styles from "./AppShell.module.css";

const readStorageKey = "codexmed.notification.readIds";

const text = {
  vi: {
    close: "Đóng",
    empty: "Không có thông báo mới.",
    markAllRead: "Đánh dấu đã đọc",
    notifications: "Thông báo",
    open: "Mở",
  },
  en: {
    close: "Close",
    empty: "No new notifications.",
    markAllRead: "Mark all read",
    notifications: "Notifications",
    open: "Open",
  },
} satisfies Record<Language, Record<string, string>>;

export function NotificationButton({
  items,
  language,
}: {
  items: AppShellNotification[];
  language: Language;
}) {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const copy = text[language];

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(readStorageKey);
      setReadIds(new Set(raw ? JSON.parse(raw) : []));
    } catch {
      setReadIds(new Set());
    }
  }, []);

  const unreadItems = useMemo(
    () => items.filter((item) => !readIds.has(item.id)),
    [items, readIds],
  );

  const persistReadIds = (next: Set<string>) => {
    setReadIds(next);
    window.localStorage.setItem(readStorageKey, JSON.stringify(Array.from(next)));
  };

  const markRead = (id: string) => {
    const next = new Set(readIds);
    next.add(id);
    persistReadIds(next);
  };

  const markAllRead = () => {
    persistReadIds(new Set(items.map((item) => item.id)));
  };

  return (
    <div className={styles.notificationWrap}>
      <button
        aria-expanded={open}
        aria-label={copy.notifications}
        className={styles.iconButton}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Bell size={18} aria-hidden="true" />
        {unreadItems.length > 0 && (
          <span className={styles.badge}>{Math.min(unreadItems.length, 99)}</span>
        )}
      </button>

      {open && (
        <section className={styles.notificationPanel} role="dialog" aria-label={copy.notifications}>
          <div className={styles.notificationHeader}>
            <strong>{copy.notifications}</strong>
            <div className={styles.notificationHeaderActions}>
              {items.length > 0 && (
                <button type="button" onClick={markAllRead}>
                  {copy.markAllRead}
                </button>
              )}
              <button aria-label={copy.close} type="button" onClick={() => setOpen(false)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className={styles.notificationList}>
            {items.length > 0 ? (
              items.map((item) => {
                const read = readIds.has(item.id);

                return (
                  <article
                    className={`${styles.notificationRow} ${read ? styles.notificationRowRead : ""}`}
                    key={item.id}
                  >
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <span>{[item.clinicName, item.createdAt].filter(Boolean).join(" · ")}</span>
                    </div>
                    <Link
                      className={styles.notificationOpen}
                      href={item.href}
                      onClick={() => {
                        markRead(item.id);
                        setOpen(false);
                      }}
                    >
                      {copy.open}
                    </Link>
                  </article>
                );
              })
            ) : (
              <p className={styles.notificationEmpty}>{copy.empty}</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
