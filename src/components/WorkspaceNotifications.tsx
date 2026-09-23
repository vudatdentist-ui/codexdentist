"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createInAppNotificationAction } from "@/app/(app)/notifications/actions";
import type { TaskInboxWorkspace } from "@/lib/task-inbox-types";
import type { StoryLanguage } from "@/workspaces/workspace-story";

type Props = { currentPath: string; language: StoryLanguage; workspace?: TaskInboxWorkspace | null };
const roles = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST", "FRONT_DESK", "BILLING"] as const;
const roleNames = {
  vi: ["Chủ hệ thống", "Quản lý khu vực", "Quản lý phòng khám", "Bác sĩ", "Điều dưỡng", "Lễ tân", "Thu ngân"],
  en: ["Owner", "Area manager", "Clinic manager", "Dentist", "Hygienist", "Front desk", "Billing"],
};

export function NotificationComposer({ currentPath, language, workspace }: Props) {
  const vi = language === "vi";
  if (!workspace?.canMutate) return <p>{vi ? "Bạn không có quyền gửi thông báo." : "You cannot send notifications."}</p>;
  const groups = [
    { label: vi ? "Nhóm vai trò" : "Role groups", field: "targetRoles", items: roles.map((id, index) => ({ id, name: roleNames[language][index] })) },
    { label: vi ? "Chuỗi phòng khám" : "Clinic chains", field: "targetChainIds", items: workspace.chains },
    { label: vi ? "Phòng khám" : "Clinics", field: "targetClinicIds", items: workspace.clinics },
    { label: vi ? "Người nhận" : "Recipients", field: "targetUserIds", items: workspace.users.map(user => ({ id: user.id, name: user.fullName })) },
  ];
  return <form action={createInAppNotificationAction} className="notification-compose-form">
    <input name="redirectTo" type="hidden" value={currentPath} />
    <label><span>{vi ? "Tiêu đề" : "Subject"}</span><input name="subject" required /></label>
    <label><span>{vi ? "Nội dung" : "Message"}</span><textarea name="body" required rows={3} /></label>
    <div className="notification-compose-grid">
      <label><span>{vi ? "Mức ưu tiên" : "Priority"}</span><select name="priority" defaultValue="medium">
        <option value="high">{vi ? "Cao" : "High"}</option><option value="medium">{vi ? "Trung bình" : "Medium"}</option><option value="low">{vi ? "Thấp" : "Low"}</option>
      </select></label>
      <label><span>{vi ? "Liên kết công việc (không bắt buộc)" : "Action link (optional)"}</span><input name="actionUrl" placeholder="/schedule" /></label>
    </div>
    <fieldset className="notification-targets"><legend>{vi ? "Gửi tới" : "Send to"}</legend>
      <label className="notification-check"><input name="targetSystem" type="checkbox" value="true" /><span>{vi ? "Toàn hệ thống" : "Whole system"}</span></label>
      {groups.filter(group => group.items.length > 0).map(group => <details className="notification-target-section" key={group.field}>
        <summary>{group.label}</summary><div className="notification-check-grid">{group.items.map(item => <label className="notification-check" key={item.id}>
          <input name={group.field} type="checkbox" value={item.id} /><span>{item.name}</span>
        </label>)}</div>
      </details>)}
    </fieldset>
    <button type="submit" className="primary-button">{vi ? "Gửi thông báo" : "Send notification"}</button>
  </form>;
}

export function useNotificationReadState() {
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("codexmed.notification.readIds") ?? "[]");
      if (Array.isArray(saved)) setReadIds(new Set(saved.filter((value): value is string => typeof value === "string")));
    } catch { /* Read status is optional when storage is unavailable. */ }
  }, []);
  function markRead(ids: string[]) {
    const next = new Set([...readIds, ...ids]);
    setReadIds(next);
    try { localStorage.setItem("codexmed.notification.readIds", JSON.stringify([...next])); } catch { /* Retain session state. */ }
  }
  return { readIds, markRead };
}

export function WorkspaceNotifications({ currentPath, language, workspace, onClose, readIds, markRead }: Props & {
  onClose: () => void; readIds: ReadonlySet<string>; markRead: (ids: string[]) => void;
}) {
  const vi = language === "vi";
  const [filter, setFilter] = useState<"all" | "unread" | "action" | "system" | "send">("all");
  const items = workspace?.items ?? [];
  const visible = items.filter(item => filter === "unread" ? !readIds.has(item.id) : filter === "action" ? item.actionable || item.priority === "high" : filter === "system" ? item.kind === "notification" || item.status === "FAILED" : true);
  const filters = { all: vi ? "Tất cả" : "All", unread: vi ? "Chưa đọc" : "Unread", action: vi ? "Cần xử lý" : "To action", system: vi ? "Thông báo" : "Notices", send: vi ? "Gửi mới" : "Compose" };
  return <div className="story-notifications">
    <div className="notification-tabs" role="group" aria-label={vi ? "Lọc thông báo" : "Filter notifications"}>
      {(Object.keys(filters) as Array<keyof typeof filters>).filter(key => key !== "send" || workspace?.canMutate).map(key => <button type="button" key={key} className={filter === key ? "active" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{filters[key]}</button>)}
    </div>
    {filter === "send" ? <NotificationComposer currentPath={currentPath} language={language} workspace={workspace} /> : <>
      <div className="notification-list-toolbar"><span>{visible.length} {vi ? "mục" : "items"}</span>{items.length > 0 && <button type="button" onClick={() => markRead(items.map(item => item.id))}>{vi ? "Đánh dấu tất cả đã đọc" : "Mark all read"}</button>}</div>
      <div className="notification-list">{visible.map(item => <article className={`notification-row${readIds.has(item.id) ? " is-read" : ""}`} key={item.id}>
        <div className="notification-row-main"><strong>{item.title}</strong><p>{item.detail}</p><small>{[item.patientName, item.clinicName, item.dueAt ?? item.createdAt].filter(Boolean).join(" · ")}</small></div>
        <div className="notification-row-actions"><Link className="secondary-button compact-button" href={item.actionUrl ?? item.href} onClick={() => { markRead([item.id]); onClose(); }}>{vi ? "Xem" : "View"}</Link>
          {!readIds.has(item.id) && <button className="workspace-text-button" type="button" onClick={() => markRead([item.id])}>{vi ? "Đã đọc" : "Mark read"}</button>}
        </div>
      </article>)}{visible.length === 0 && <p className="empty-state">{vi ? "Chưa có thông báo phù hợp." : "No matching notifications."}</p>}</div>
    </>}
  </div>;
}
