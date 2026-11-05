"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppSidebar, AppTopbar } from "@/components/AppShell";
import { LanguageContext, type Language } from "@/components/AppLanguage";
import { uiText } from "@/components/suite-copy";
import { readBrowserStorage, writeBrowserStorage } from "@/shared/browser/storage";
import { languageStorageKey } from "@/shared/browser/preferences";
import { viewRoutes, type ViewKey } from "@/lib/permissions";

export function OperationsWorkspaceShell({ view, permittedViews, userName, organizationName, roleLabel, children }: {
  view: "imaging" | "lab" | "sterilization";
  permittedViews: ViewKey[];
  userName: string;
  organizationName: string;
  roleLabel: string;
  children: ReactNode;
}) {
  const [language, setLanguage] = useState<Language>("vi");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLanguage(readBrowserStorage("local", languageStorageKey) === "en" ? "en" : "vi");
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) writeBrowserStorage("local", languageStorageKey, language);
  }, [language, loaded]);
  const t = uiText[language];
  return <LanguageContext.Provider value={{ language, t }}>
    <div className="app-shell">
      <AppSidebar activeView={view} language={language} permittedViews={new Set(permittedViews)} />
      <main className="workspace">
        <AppTopbar activeLanguage={language} alertsLabel="Alerts" allChainsLabel={t.allChains}
          chainOptions={[]} chainScopeId="all" chainScopeLabel={t.chainScope}
          currentPath={viewRoutes[view]} eyebrow="" inboxLabel={t.inbox} languageLabel={t.language}
          onChainScopeChange={() => undefined} onLanguageChange={setLanguage}
          organizationName={organizationName} roleLabel={roleLabel}
          signOutLabel={t.signOut} title={t.titles[view]} userName={userName} />
        <div className="operations-workspace-content">{children}</div>
      </main>
    </div>
  </LanguageContext.Provider>;
}
