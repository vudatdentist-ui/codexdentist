"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LanguageContext, type Language } from "@/components/AppLanguage";
import { roleLabels, viewRoutes, type ViewKey } from "@/lib/permissions";
import { migrationCompatibilityNavigation } from "./navigation";
import { NotificationButton } from "./NotificationButton";
import type { AppShellContext, AppShellNotification } from "./types";
import styles from "./AppShell.module.css";

const languageStorageKey = "nhavista.language";

const shellText = {
  vi: {
    allClinics: "Tất cả phòng khám",
    clinicScope: "Phạm vi phòng khám",
    signOut: "Đăng xuất",
    eyebrow: "Codexdentist",
  },
  en: {
    allClinics: "All clinics",
    clinicScope: "Clinic scope",
    signOut: "Sign out",
    eyebrow: "Codexdentist",
  },
} satisfies Record<Language, Record<string, string>>;

export type AppShellV2Props = {
  activeView: ViewKey;
  allowedViews: ViewKey[];
  children: ReactNode;
  context: AppShellContext;
  notifications: AppShellNotification[];
  signOutAction: () => Promise<void>;
  title: Record<Language, string>;
};

export function AppShellV2({
  activeView,
  allowedViews,
  children,
  context,
  notifications,
  signOutAction,
  title,
}: AppShellV2Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [language, setLanguage] = useState<Language>("vi");
  const allowedViewSet = useMemo(() => new Set(allowedViews), [allowedViews]);
  const text = shellText[language];
  const requestedClinicId = searchParams.get("clinicId");
  const selectedClinicId =
    requestedClinicId && context.clinics.some((clinic) => clinic.id === requestedClinicId)
      ? requestedClinicId
      : "all";

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
              <span>{context.organizationName}</span>
            </div>
          </div>

          <nav className={styles.nav}>
            {migrationCompatibilityNavigation.map((group) => {
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
              {context.clinics.length > 1 && (
                <select
                  aria-label={text.clinicScope}
                  className={styles.select}
                  onChange={(event) => updateClinicScope(event.target.value)}
                  value={selectedClinicId}
                >
                  <option value="all">{text.allClinics}</option>
                  {context.clinics.map((clinic) => (
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

              <NotificationButton items={notifications} language={language} />

              <div className={styles.identity}>
                <strong>{context.fullName}</strong>
                <span>{roleLabels[context.role]}</span>
              </div>

              <form action={signOutAction}>
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
