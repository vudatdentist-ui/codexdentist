"use client";

import { Bell, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { logoutAction } from "@/app/(app)/actions";
import { LanguageContext, type Language } from "@/components/AppLanguage";
import { roleLabels, viewRoutes, type ViewKey } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";
import { appShellNavigation } from "./navigation";
import styles from "./AppShell.module.css";

const languageStorageKey = "nhavista.language";

const shellText = {
  vi: {
    allClinics: "Tất cả phòng khám",
    clinicScope: "Phạm vi phòng khám",
    notifications: "Thông báo",
    signOut: "Đăng xuất",
    eyebrow: "Codexdentist",
  },
  en: {
    allClinics: "All clinics",
    clinicScope: "Clinic scope",
    notifications: "Notifications",
    signOut: "Sign out",
    eyebrow: "Codexdentist",
  },
} satisfies Record<Language, Record<string, string>>;

export type AppShellV2Props = {
  activeView: ViewKey;
  allowedViews: ViewKey[];
  children: ReactNode;
  notificationCount?: number;
  session: AppSession;
  title: Record<Language, string>;
};

export function AppShellV2({
  activeView,
  allowedViews,
  children,
  notificationCount = 0,
  session,
  title,
}: AppShellV2Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [language, setLanguage] = useState<Language>("vi");
  const allowedViewSet = useMemo(() => new Set(allowedViews), [allowedViews]);
  const text = shellText[language];
  const selectedClinicId = searchParams.get("clinicId") ?? "all";

  useEffect(() => {
    const storedLanguage = window.localStorage.getItem(languageStorageKey);
    setLanguage(storedLanguage === "en" ? "en" : "vi");
  }, []);

  const updateLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage);
    window.localStorage.setItem(languageStorageKey, nextLanguage);
  };

  const updateClinicScope = (clinicId: string) => {
    const params = new URLSearchParams(searchParams.toString());

    if (clinicId === "all") {
      params.delete("clinicId");
    } else {
      params.set("clinicId", clinicId);
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <LanguageContext.Provider value={{ language, t: {} }}>
      <div className={styles.shell}>
        <aside className={styles.sidebar} aria-label="Main navigation">
          <div className={styles.brand}>
            <div className={styles.brandMark}>
              <img src="/icons/codexmed-icon.svg" alt="" aria-hidden="true" />
            </div>
            <div className={styles.brandText}>
              <strong>Codexdentist</strong>
              <span>{session.organizationName}</span>
            </div>
          </div>

          <nav className={styles.nav}>
            {appShellNavigation.map((group) => {
              const visibleItems = group.items.filter((item) => allowedViewSet.has(item.key));

              if (visibleItems.length === 0) {
                return null;
              }

              return (
                <section className={styles.navGroup} key={group.label.en}>
                  <span className={styles.navGroupTitle}>{group.label[language]}</span>
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const active = item.key === activeView;

                    return (
                      <Link
                        className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                        href={viewRoutes[item.key]}
                        key={item.key}
                      >
                        <Icon size={17} aria-hidden="true" />
                        <span>{item.label[language]}</span>
                      </Link>
                    );
                  })}
                </section>
              );
            })}
          </nav>
        </aside>

        <div className={styles.workspace}>
          <header className={styles.topbar}>
            <div className={styles.titleBlock}>
              <p className={styles.eyebrow}>{text.eyebrow}</p>
              <h1 className={styles.title}>{title[language]}</h1>
            </div>

            <div className={styles.actions}>
              {session.clinics.length > 1 && (
                <select
                  aria-label={text.clinicScope}
                  className={styles.select}
                  onChange={(event) => updateClinicScope(event.target.value)}
                  value={selectedClinicId}
                >
                  <option value="all">{text.allClinics}</option>
                  {session.clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </select>
              )}

              <button
                aria-label="VI"
                className={styles.button}
                disabled={language === "vi"}
                onClick={() => updateLanguage("vi")}
                type="button"
              >
                VI
              </button>
              <button
                aria-label="EN"
                className={styles.button}
                disabled={language === "en"}
                onClick={() => updateLanguage("en")}
                type="button"
              >
                EN
              </button>

              <Link
                aria-label={text.notifications}
                className={styles.iconButton}
                href="/dashboard"
              >
                <Bell size={18} aria-hidden="true" />
                {notificationCount > 0 && (
                  <span className={styles.badge}>{Math.min(notificationCount, 99)}</span>
                )}
              </Link>

              <div className={styles.identity}>
                <strong>{session.fullName}</strong>
                <span>{roleLabels[session.role]}</span>
              </div>

              <form action={logoutAction}>
                <button className={styles.button} type="submit" aria-label={text.signOut}>
                  <LogOut size={16} aria-hidden="true" />
                </button>
              </form>
            </div>
          </header>

          <main className={styles.content}>{children}</main>
        </div>
      </div>
    </LanguageContext.Provider>
  );
}
