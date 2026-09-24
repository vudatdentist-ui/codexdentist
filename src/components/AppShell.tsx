"use client";

import { Bell, ChevronDown, LogOut, Menu, Search, UserRound, MessageCircle } from "lucide-react";
import Link from "next/link";
import styles from "./AppShell.module.css";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { logoutAction } from "@/app/(app)/actions";
import { useAppLanguage } from "@/components/AppLanguage";
import { WorkspaceNotifications, useNotificationReadState } from "@/components/WorkspaceNotifications";
import { viewRoutes, type ViewKey } from "@/lib/permissions";
import type { TaskInboxWorkspace } from "@/lib/task-inbox-types";
import { WorkspaceDialog } from "@/shared/ui/WorkspaceDialog/WorkspaceDialog";
import { WorkspaceIcon } from "@/workspaces/WorkspaceIcon";
import { visibleWorkspaceNavigation, viewFromPath, workspaceChapters, workspaceStories, type StoryLanguage } from "@/workspaces/workspace-story";

export function AppSidebar({ activeView, language, permittedViews }: {
  activeView: ViewKey; language: StoryLanguage;
  permittedViews: Set<ViewKey>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const vi = language === "vi";
  const selected = activeView === "clinical" || activeView === "treatment" ? "journey" : activeView;
  const groups = visibleWorkspaceNavigation(permittedViews, language, query);
  const label = vi ? "Không gian làm việc" : "Workspace navigation";
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1101px)");
    const close = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);
  const navigation = <>
    <label className="workspace-nav-search"><Search size={17} aria-hidden="true" />
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={vi ? "Tìm công việc..." : "Find a workspace..."} aria-label={vi ? "Tìm trong menu" : "Search navigation"} />
    </label>
    <nav className="story-nav" aria-label={label}>{groups.map(group => <section className="story-nav-chapter" key={group.chapter}>
      <h2><span aria-hidden="true">{workspaceChapters[group.chapter].number}</span>{workspaceChapters[group.chapter].title[language]}</h2>
      {group.views.map(view => <Link key={view} href={viewRoutes[view]} className={`story-nav-link${selected === view ? " is-current" : ""}`} aria-current={selected === view ? "page" : undefined} onClick={() => { setOpen(false); setQuery(""); }}>
        <WorkspaceIcon view={view} /><span>{workspaceStories[view].label[language]}</span>
      </Link>)}
    </section>)}{groups.length === 0 && <p className="workspace-caption" role="status">{vi ? "Không tìm thấy. Thử một từ khác." : "No matches. Try another word."}</p>}</nav>
  </>;
  return <aside className="sidebar story-sidebar">
    <a className="workspace-skip" href="#workspace-content">{vi ? "Chuyển tới nội dung" : "Skip to content"}</a>
    <div className="workspace-brand"><img src="/icons/codexmed-icon.svg" width="38" height="38" alt="" aria-hidden="true" /><div><strong>Codexdentist</strong></div></div>
    <button className="workspace-menu-button" type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={vi ? "Mở menu công việc" : "Open workspace menu"} onClick={() => setOpen(true)}><Menu size={21} aria-hidden="true" /><span>Menu</span></button>
    <div className="workspace-desktop-navigation">{navigation}</div>
    <WorkspaceDialog open={open} onClose={() => setOpen(false)} title={label} closeLabel={vi ? "Đóng menu" : "Close menu"} className="workspace-menu-dialog">{navigation}</WorkspaceDialog>
  </aside>;
}

type TopbarProps = {
  activeLanguage: StoryLanguage; alertsLabel: string; allChainsLabel: string;
  chainOptions: { id: string; name: string }[]; chainScopeId: string; chainScopeLabel: string;
  children?: ReactNode; currentPath: string; eyebrow: string; inboxLabel: string; languageLabel: string;
  notificationWorkspace?: TaskInboxWorkspace | null;
  onChainScopeChange: (value: string) => void; onLanguageChange: (language: StoryLanguage) => void;
  organizationName: string; roleLabel: string; signOutLabel: string; title: string; userName: string;
};
export function AppTopbar({ activeLanguage, allChainsLabel, chainOptions, chainScopeId, chainScopeLabel,
  children, currentPath, languageLabel, notificationWorkspace, onChainScopeChange, onLanguageChange,
  organizationName, roleLabel, signOutLabel, title, userName }: TopbarProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { readIds, markRead } = useNotificationReadState();
  const unreadCount = (notificationWorkspace?.items ?? []).filter(item => !readIds.has(item.id)).length;
  const vi = activeLanguage === "vi";
  const view = viewFromPath(currentPath);
  const story = view ? workspaceStories[view] : undefined;
  const notificationLabel = vi ? "Thông báo và công việc" : "Notifications and tasks";
  useEffect(() => { document.documentElement.lang = activeLanguage; }, [activeLanguage]);
  return <header className="topbar story-topbar">
    <div className={`workspace-utility-bar ${styles.utilityBar}`}><span className={`workspace-organization ${styles.organization}`}>{organizationName}</span><div className="topbar-actions">
      <div className="segmented language-switch" role="group" aria-label={languageLabel}>{(["vi", "en"] as const).map(language => <button key={language} type="button" className={activeLanguage === language ? "active" : ""} aria-pressed={activeLanguage === language} onClick={() => onLanguageChange(language)}>{language.toUpperCase()}</button>)}</div>
      <div id="workspace-assistant-slot" className="workspace-assistant-slot" />
      <button className="icon-button" type="button" aria-label={notificationLabel} aria-haspopup="dialog" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(true)}><Bell size={19} aria-hidden="true" />{unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}</button>
      <details className="workspace-account"><summary aria-label={vi ? "Tài khoản của tôi" : "My account"}><UserRound size={18} aria-hidden="true" /><span>{userName}</span><ChevronDown size={14} aria-hidden="true" /></summary>
        <div className="workspace-account-menu"><strong>{userName}</strong><span>{roleLabel}</span><span>{organizationName}</span><form action={logoutAction}><button className="secondary-button" type="submit"><LogOut size={16} aria-hidden="true" />{signOutLabel}</button></form></div>
      </details>
    </div></div>
    <div className="workspace-page-heading">
      <h1 id="workspace-content" tabIndex={-1}>{story?.title[activeLanguage] ?? title}</h1>
    </div>
    <div className="workspace-context-controls">{chainOptions.length > 1 && <label className="select-field compact topbar-chain-field"><span>{chainScopeLabel}</span><select aria-label={chainScopeLabel} value={chainScopeId} onChange={event => onChainScopeChange(event.target.value)}><option value="all">{allChainsLabel}</option>{chainOptions.map(chain => <option value={chain.id} key={chain.id}>{chain.name}</option>)}</select></label>}{children}</div>
    <WorkspaceDialog open={notificationsOpen} onClose={() => setNotificationsOpen(false)} title={notificationLabel} closeLabel={vi ? "Đóng thông báo" : "Close notifications"} className="workspace-notifications-dialog"><WorkspaceNotifications readIds={readIds} markRead={markRead} currentPath={currentPath} language={activeLanguage} workspace={notificationWorkspace} onClose={() => setNotificationsOpen(false)} /></WorkspaceDialog>
  </header>;
}

export function ModuleAiFloatingShell({ children, closeLabel, isOpen, onClose, onOpen }: {
  children: ReactNode; closeLabel: string; isOpen: boolean; moduleTitle: string;
  onClose: () => void; onOpen: () => void; openLabel: string; routeTitle: string;
}) {
  const { language } = useAppLanguage();
  const title = language === "vi" ? "Trợ lý công việc" : "Workspace assistant";
  const [launcherTarget, setLauncherTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setLauncherTarget(document.getElementById("workspace-assistant-slot")); }, []);
  // Preserve each module's assistant state while keeping its launcher out of the work surface.
  const launcher = <button className="module-ai-bubble" type="button" title={title} aria-label={title} aria-haspopup="dialog" aria-expanded={isOpen} onClick={onOpen}><MessageCircle size={19} aria-hidden="true" /><span>{language === "vi" ? "Trợ lý" : "Assistant"}</span></button>;
  return <>
    {launcherTarget && createPortal(launcher, launcherTarget)}
    <WorkspaceDialog open={isOpen} onClose={onClose} title={title} closeLabel={closeLabel} className="workspace-assistant-dialog">{children}</WorkspaceDialog>
  </>;
}
