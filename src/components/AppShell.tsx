"use client";

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bell,
  LockKeyhole,
  LogOut,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { logoutAction } from "@/app/(app)/actions";
import { createInAppNotificationAction } from "@/app/(app)/notifications/actions";
import { viewRoutes, type ViewKey } from "@/lib/permissions";
import type { TaskInboxItemSummary, TaskInboxWorkspace } from "@/lib/task-inbox-types";

type AppShellLanguage = "vi" | "en";

export type AppShellNavGroup = {
  title: Record<AppShellLanguage, string>;
  items: {
    key: ViewKey;
    icon: LucideIcon;
  }[];
};

export function AppSidebar({
  activeView,
  language,
  navGroups,
  navLabels,
  permittedViews,
}: {
  activeView: ViewKey;
  language: AppShellLanguage;
  navGroups: AppShellNavGroup[];
  navLabels: Record<ViewKey, string>;
  permittedViews: Set<ViewKey>;
}) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand">
        <div className="brand-mark">
          <img src="/icons/codexmed-icon.svg" alt="" aria-hidden="true" />
        </div>
        <div>
          <strong>Codexdentist</strong>
          <span>SMART DENTAL SOLUTIONS</span>
        </div>
      </div>

      <nav className="nav-list">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter((item) =>
            permittedViews.has(item.key),
          );

          if (visibleItems.length === 0) {
            return null;
          }

          return (
            <section className="nav-group" key={group.title.en}>
              <span className="nav-group-title">{group.title[language]}</span>
              {visibleItems.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    className={
                      activeView === item.key ? "nav-item active" : "nav-item"
                    }
                    key={item.key}
                    href={viewRoutes[item.key]}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{navLabels[item.key]}</span>
                  </Link>
                );
              })}
            </section>
          );
        })}
      </nav>
    </aside>
  );
}

export function AppTopbar({
  activeLanguage,
  alertsLabel,
  allChainsLabel,
  chainOptions,
  chainScopeId,
  chainScopeLabel,
  children,
  currentPath,
  eyebrow,
  inboxLabel,
  languageLabel,
  notificationWorkspace,
  onChainScopeChange,
  onLanguageChange,
  organizationName,
  roleLabel,
  signOutLabel,
  title,
  userName,
}: {
  activeLanguage: AppShellLanguage;
  alertsLabel: string;
  allChainsLabel: string;
  chainOptions: { id: string; name: string }[];
  chainScopeId: string;
  chainScopeLabel: string;
  children?: ReactNode;
  currentPath: string;
  eyebrow: string;
  inboxLabel: string;
  languageLabel: string;
  notificationWorkspace?: TaskInboxWorkspace | null;
  onChainScopeChange: (value: string) => void;
  onLanguageChange: (language: AppShellLanguage) => void;
  organizationName: string;
  roleLabel: string;
  signOutLabel: string;
  title: string;
  userName: string;
}) {
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const notificationItems = notificationWorkspace?.items ?? [];
  const unreadItems = notificationItems.filter((item) => !readIds.has(item.id));

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("codexmed.notification.readIds");
      setReadIds(new Set(raw ? JSON.parse(raw) : []));
    } catch {
      setReadIds(new Set());
    }
  }, []);

  const markNotificationRead = (id: string) => {
    setReadIds((current) => {
      const next = new Set(current);
      next.add(id);
      window.localStorage.setItem("codexmed.notification.readIds", JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const markAllNotificationsRead = () => {
    const next = new Set(notificationItems.map((item) => item.id));
    setReadIds(next);
    window.localStorage.setItem("codexmed.notification.readIds", JSON.stringify(Array.from(next)));
  };

  return (
    <header className="topbar">
      <div className="topbar-main">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>

        <div className="topbar-actions">
          {chainOptions.length > 1 && (
            <label className="select-field compact topbar-chain-field">
              <span>{chainScopeLabel}</span>
              <select
                aria-label={chainScopeLabel}
                value={chainScopeId}
                onChange={(event) => onChainScopeChange(event.target.value)}
              >
                <option value="all">{allChainsLabel}</option>
                {chainOptions.map((chain) => (
                  <option value={chain.id} key={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="context-badge">
            <LockKeyhole size={16} aria-hidden="true" />
            <span>{roleLabel}</span>
          </div>

          <div className="segmented language-switch" role="group" aria-label={languageLabel}>
            <button
              className={activeLanguage === "vi" ? "active" : ""}
              type="button"
              onClick={() => onLanguageChange("vi")}
            >
              VI
            </button>
            <button
              className={activeLanguage === "en" ? "active" : ""}
              type="button"
              onClick={() => onLanguageChange("en")}
            >
              EN
            </button>
          </div>

          <div className="user-chip">
            <strong>{userName}</strong>
            <span>{organizationName}</span>
          </div>

          <div className="notification-bell-wrap">
            <button
              className="icon-button notification-bell-button"
              type="button"
              aria-expanded={notificationOpen}
              aria-label={`${alertsLabel} / ${inboxLabel}`}
              onClick={() => setNotificationOpen((value) => !value)}
            >
              <Bell size={18} />
              {unreadItems.length > 0 && (
                <span className="notification-badge">{Math.min(unreadItems.length, 99)}</span>
              )}
            </button>
            {notificationOpen && (
              <NotificationCenterPanel
                currentPath={currentPath}
                language={activeLanguage}
                onClose={() => setNotificationOpen(false)}
                onMarkAllRead={markAllNotificationsRead}
                onMarkRead={markNotificationRead}
                readIds={readIds}
                workspace={notificationWorkspace}
              />
            )}
          </div>
          <form action={logoutAction}>
            <button className="secondary-button topbar-signout-button" type="submit" aria-label={signOutLabel}>
              <LogOut size={16} aria-hidden="true" />
              <span>{signOutLabel}</span>
            </button>
          </form>
        </div>
      </div>

      {children}
    </header>
  );
}

function NotificationCenterPanel({
  currentPath,
  language,
  onClose,
  onMarkAllRead,
  onMarkRead,
  readIds,
  workspace,
}: {
  currentPath: string;
  language: AppShellLanguage;
  onClose: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  readIds: Set<string>;
  workspace?: TaskInboxWorkspace | null;
}) {
  const [tab, setTab] = useState<"all" | "unread" | "action" | "system" | "send">("all");
  const items = workspace?.items ?? [];
  const text = notificationText[language];
  const filteredItems = useMemo(() => {
    if (tab === "unread") {
      return items.filter((item) => !readIds.has(item.id));
    }

    if (tab === "action") {
      return items.filter((item) => item.actionable || item.priority === "high");
    }

    if (tab === "system") {
      return items.filter((item) => item.kind === "notification" || item.status === "FAILED");
    }

    return items;
  }, [items, readIds, tab]);

  return (
    <section className="notification-panel" role="dialog" aria-label={text.title}>
      <div className="notification-panel-header">
        <div>
          <strong>{text.title}</strong>
          <span>{text.subtitle}</span>
        </div>
        <button className="icon-button small" type="button" aria-label={text.close} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="notification-tabs" role="tablist" aria-label={text.filter}>
        {(["all", "unread", "action", "system", "send"] as const).map((key) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            type="button"
            onClick={() => setTab(key)}
          >
            {text.tabs[key]}
          </button>
        ))}
      </div>

      {tab === "send" ? (
        <NotificationComposer currentPath={currentPath} language={language} workspace={workspace} />
      ) : (
        <>
          <div className="notification-list-toolbar">
            <span>{filteredItems.length} {text.items}</span>
            {items.length > 0 && (
              <button type="button" onClick={onMarkAllRead}>
                {text.markAllRead}
              </button>
            )}
          </div>
          <div className="notification-list">
            {filteredItems.length > 0 ? (
              filteredItems.map((item) => (
                <NotificationRow
                  item={item}
                  key={item.id}
                  language={language}
                  onMarkRead={onMarkRead}
                  read={readIds.has(item.id)}
                />
              ))
            ) : (
              <p className="notification-empty">{text.empty}</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function NotificationRow({
  item,
  language,
  onMarkRead,
  read,
}: {
  item: TaskInboxItemSummary;
  language: AppShellLanguage;
  onMarkRead: (id: string) => void;
  read: boolean;
}) {
  const text = notificationText[language];
  const href = item.actionUrl ?? item.href;

  return (
    <article className={`notification-row ${read ? "is-read" : ""} priority-${item.priority}`}>
      <div className="notification-row-main">
        <div className="notification-row-title">
          <span>{item.title}</span>
          {!read && <i aria-label={text.unread} />}
        </div>
        <p>{item.detail}</p>
        <div className="notification-row-meta">
          <span>{text.kind[item.kind] ?? item.kind}</span>
          {item.clinicName && <span>{item.clinicName}</span>}
          {item.patientName && <span>{item.patientName}</span>}
          {(item.dueAt ?? item.createdAt) && <span>{item.dueAt ?? item.createdAt}</span>}
        </div>
      </div>
      <div className="notification-row-actions">
        {href && (
          <Link className="secondary-button compact-button" href={href} onClick={() => onMarkRead(item.id)}>
            {text.open}
          </Link>
        )}
        {!read && (
          <button className="icon-button small" type="button" aria-label={text.markRead} onClick={() => onMarkRead(item.id)}>
            <span aria-hidden="true">✓</span>
          </button>
        )}
      </div>
    </article>
  );
}

function NotificationComposer({
  currentPath,
  language,
  workspace,
}: {
  currentPath: string;
  language: AppShellLanguage;
  workspace?: TaskInboxWorkspace | null;
}) {
  const text = notificationText[language];
  const roles = [
    "OWNER",
    "AREA_MANAGER",
    "CLINIC_MANAGER",
    "DENTIST",
    "HYGIENIST",
    "FRONT_DESK",
    "BILLING",
  ];

  if (!workspace?.canMutate) {
    return <p className="notification-empty">{text.noPermission}</p>;
  }

  return (
    <form action={createInAppNotificationAction} className="notification-compose-form">
      <input name="redirectTo" type="hidden" value={currentPath} />
      <label>
        <span>{text.subject}</span>
        <input name="subject" required placeholder={text.subjectPlaceholder} />
      </label>
      <label>
        <span>{text.body}</span>
        <textarea name="body" required rows={3} placeholder={text.bodyPlaceholder} />
      </label>
      <div className="notification-compose-grid">
        <label>
          <span>{text.priority}</span>
          <select name="priority" defaultValue="medium">
            <option value="high">{text.high}</option>
            <option value="medium">{text.medium}</option>
            <option value="low">{text.low}</option>
          </select>
        </label>
        <label>
          <span>{text.actionUrl}</span>
          <input name="actionUrl" placeholder="/schedule" />
        </label>
      </div>
      <div className="notification-targets">
        <div className="notification-targets-title">{text.targets}</div>
        <label className="notification-check">
          <input name="targetSystem" type="checkbox" value="true" />
          <span>{text.allSystem}</span>
        </label>
        <details className="notification-target-section" open>
          <summary>{text.roles}</summary>
          <div className="notification-check-grid">
            {roles.map((role) => (
              <label className="notification-check" key={role}>
                <input name="targetRoles" type="checkbox" value={role} />
                <span>{text.roleLabels[role as keyof typeof text.roleLabels] ?? role}</span>
              </label>
            ))}
          </div>
        </details>
        {workspace.chains.length > 0 && (
          <details className="notification-target-section" open>
            <summary>{text.chains}</summary>
            <div className="notification-check-grid">
              {workspace.chains.map((chain) => (
                <label className="notification-check" key={chain.id}>
                  <input name="targetChainIds" type="checkbox" value={chain.id} />
                  <span>{chain.name}</span>
                </label>
              ))}
            </div>
          </details>
        )}
        <details className="notification-target-section" open>
          <summary>{text.clinics}</summary>
          <div className="notification-check-grid">
            {workspace.clinics.map((clinic) => (
              <label className="notification-check" key={clinic.id}>
                <input name="targetClinicIds" type="checkbox" value={clinic.id} />
                <span>{clinic.name}</span>
              </label>
            ))}
          </div>
        </details>
        <details className="notification-target-section" open>
          <summary>{text.users}</summary>
          <div className="notification-check-grid">
            {workspace.users.map((user) => (
              <label className="notification-check" key={user.id}>
                <input name="targetUserIds" type="checkbox" value={user.id} />
                <span>{user.fullName}</span>
              </label>
            ))}
          </div>
        </details>
      </div>
      <button className="primary-button" type="submit">
        {text.send}
      </button>
    </form>
  );
}

const notificationText = {
  vi: {
    actionUrl: "Link hành động",
    allSystem: "Toàn hệ thống",
    body: "Nội dung",
    bodyPlaceholder: "Viết nội dung cần thông báo hoặc việc cần xử lý.",
    chains: "Chuỗi",
    clinics: "Chi nhánh",
    close: "Đóng",
    empty: "Chưa có thông báo phù hợp.",
    filter: "Lọc thông báo",
    high: "Cao",
    items: "mục",
    kind: {
      billing: "Thanh toán",
      crm: "CSKH",
      hr: "Nhân sự",
      inventory: "Kho",
      learning: "Đào tạo",
      notification: "Thông báo",
      schedule: "Lịch hẹn",
    },
    low: "Thấp",
    markAllRead: "Đánh dấu đã đọc",
    markRead: "Đã đọc",
    medium: "Vừa",
    noPermission: "Chỉ owner/quản lý được gửi thông báo nội bộ.",
    open: "Mở",
    priority: "Ưu tiên",
    roleLabels: {
      AREA_MANAGER: "Quản lý khu vực",
      BILLING: "Thu ngân",
      CLINIC_MANAGER: "Quản lý chi nhánh",
      DENTIST: "Bác sĩ",
      FRONT_DESK: "Lễ tân",
      HYGIENIST: "Điều dưỡng",
      OWNER: "Chủ hệ thống",
    },
    roles: "Nhóm vai trò",
    send: "Gửi thông báo",
    subject: "Tiêu đề",
    subjectPlaceholder: "Ví dụ: Họp giao ban cuối ngày",
    subtitle: "Thông báo và việc cần xử lý theo người nhận",
    targets: "Gửi tới",
    tabs: {
      action: "Cần xử lý",
      all: "Tất cả",
      send: "Gửi mới",
      system: "Hệ thống",
      unread: "Chưa đọc",
    },
    title: "Thông báo",
    unread: "Chưa đọc",
    users: "Người nhận cụ thể",
  },
  en: {
    actionUrl: "Action link",
    allSystem: "Whole system",
    body: "Body",
    bodyPlaceholder: "Write the announcement or work item.",
    chains: "Chains",
    clinics: "Branches",
    close: "Close",
    empty: "No matching notifications.",
    filter: "Notification filter",
    high: "High",
    items: "items",
    kind: {
      billing: "Billing",
      crm: "CRM",
      hr: "HR",
      inventory: "Inventory",
      learning: "Learning",
      notification: "Notification",
      schedule: "Schedule",
    },
    low: "Low",
    markAllRead: "Mark all read",
    markRead: "Mark read",
    medium: "Medium",
    noPermission: "Only owners/managers can send internal notifications.",
    open: "Open",
    priority: "Priority",
    roleLabels: {
      AREA_MANAGER: "Area manager",
      BILLING: "Billing",
      CLINIC_MANAGER: "Clinic manager",
      DENTIST: "Dentist",
      FRONT_DESK: "Front desk",
      HYGIENIST: "Hygienist",
      OWNER: "Owner",
    },
    roles: "Role groups",
    send: "Send notification",
    subject: "Subject",
    subjectPlaceholder: "Example: End-of-day huddle",
    subtitle: "Notifications and actionable work by recipient",
    targets: "Send to",
    tabs: {
      action: "Action",
      all: "All",
      send: "Send",
      system: "System",
      unread: "Unread",
    },
    title: "Notifications",
    unread: "Unread",
    users: "Specific recipients",
  },
} satisfies Record<AppShellLanguage, {
  actionUrl: string;
  allSystem: string;
  body: string;
  bodyPlaceholder: string;
  chains: string;
  clinics: string;
  close: string;
  empty: string;
  filter: string;
  high: string;
  items: string;
  kind: Record<TaskInboxItemSummary["kind"], string>;
  low: string;
  markAllRead: string;
  markRead: string;
  medium: string;
  noPermission: string;
  open: string;
  priority: string;
  roleLabels: Record<string, string>;
  roles: string;
  send: string;
  subject: string;
  subjectPlaceholder: string;
  subtitle: string;
  targets: string;
  tabs: Record<"all" | "unread" | "action" | "system" | "send", string>;
  title: string;
  unread: string;
  users: string;
}>;

export function ModuleAiFloatingShell({
  children,
  closeLabel,
  isOpen,
  moduleTitle,
  onClose,
  onOpen,
  openLabel,
  routeTitle,
}: {
  children: ReactNode;
  closeLabel: string;
  isOpen: boolean;
  moduleTitle: string;
  onClose: () => void;
  onOpen: () => void;
  openLabel: string;
  routeTitle: string;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="module-ai-floating">
      {!isOpen && (
        <button
          className="module-ai-bubble"
          type="button"
          aria-label={openLabel}
          onClick={onOpen}
        >
          <Activity size={22} aria-hidden="true" />
        </button>
      )}
      {isOpen && (
      <section
        className="module-ai-chat-panel"
        role="dialog"
        aria-modal="false"
        aria-label={moduleTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="progress-modal-header">
          <div>
            <span>{routeTitle}</span>
            <h3>{moduleTitle}</h3>
          </div>
          <button
            className="icon-button small"
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </section>
      )}
    </div>
  );
}
