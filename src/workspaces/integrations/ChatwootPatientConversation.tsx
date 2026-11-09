"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { safeChatwootLink, type ChatwootPatientWorkspace } from "@/features/integrations/chatwoot-workspace";
import styles from "./ChatwootPatientConversation.module.css";

export function ChatwootPatientConversation(props: { patientId: string; language: "vi" | "en" }) {
  return <PatientConversation key={props.patientId} {...props} />;
}
function PatientConversation({ patientId, language }: { patientId: string; language: "vi" | "en" }) {
  const vi = language === "vi", id = useId();
  const [view, setView] = useState<ChatwootPatientWorkspace | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [contactId, setContactId] = useState(""), [conversationId, setConversationId] = useState("");
  const mounted = useRef(true), sequence = useRef(0), mutation = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  const load = useCallback(async (action?: "ensure" | "recover" | "link" | "prepare", link?: { contactId?: string; conversationId?: string }) => {
    if (mutation.current) return;
    if (action) mutation.current = true;
    const current = ++sequence.current;
    setBusy(true); setError(false);
    try {
      const response = await fetch(`/api/integrations/chatwoot/patient-conversations${action ? "" : `?${new URLSearchParams({ patientId })}`}`, {
        method: action ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(30_000),
        ...(action ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, action, ...link }) } : {}),
      });
      if (!mounted.current || current !== sequence.current) return;
      if (response.status === 403) {
        setView({ patientId, state: "PERMISSION", canManage: false, opaqueIdentifier: null, contactId: null, conversations: [] });
        return;
      }
      if (!response.ok) throw new Error();
      const data: ChatwootPatientWorkspace = await response.json();
      if (mounted.current && current === sequence.current) { setView(data); setConfirmed(false); }
    } catch {
      if (mounted.current && current === sequence.current) { setError(true); if (action) setView(previous => previous ? { ...previous, state: "UNKNOWN", conversations: [] } : null); }
    } finally {
      if (action) mutation.current = false;
      if (mounted.current && current === sequence.current) setBusy(false);
    }
  }, [patientId]);
  useEffect(() => { void load(); }, [load]);
  const status = view?.state;
  const enabled = !!view?.canManage && status !== "DISABLED" && status !== "PERMISSION";
  const states = {
    EMPTY: vi ? "Chưa liên kết hội thoại" : "No conversation linked",
    SAVED: vi ? "Đã lưu liên kết" : "Link saved",
    UNKNOWN: vi ? "Chưa xác nhận được kết quả" : "Result not yet confirmed",
    DISABLED: vi ? "Chatwoot chưa được bật cho phòng khám này" : "Chatwoot is disabled for this clinic",
    PERMISSION: vi ? "Chỉ chủ phòng khám và lễ tân có quyền quản lý hội thoại" : "Only owners and front desk staff can manage conversations",
  };
  return <section className={styles.panel} aria-labelledby={`${id}-title`} aria-busy={busy}>
    <div className={styles.heading}><h3 id={`${id}-title`}>{vi ? "Hội thoại bệnh nhân" : "Patient conversations"}</h3><span>Chatwoot</span></div>
    <p role="status">{status ? states[status] : busy ? (vi ? "Đang tải…" : "Loading…") : (vi ? "Chưa tải được trạng thái" : "Status unavailable")}</p>
    {error && <p role="alert">{vi ? "Chưa nhận được xác nhận. Tải lại trạng thái trước khi tiếp tục." : "No confirmation received. Refresh the status before continuing."}</p>}
    {view?.contactId && <p>{vi ? "Mã liên hệ Chatwoot:" : "Chatwoot contact ID:"} <strong>{view.contactId}</strong></p>}
    {!!view?.conversations.length && <ul className={styles.list}>{view.conversations.map(row => {
      const url = safeChatwootLink(row.url);
      const label = row.status === "open" ? (vi ? "Đang mở" : "Open") : row.status === "resolved" ? (vi ? "Đã xử lý" : "Resolved")
        : row.status === "pending" ? (vi ? "Đang chờ" : "Pending") : row.status === "snoozed" ? (vi ? "Tạm hoãn" : "Snoozed") : (vi ? "Chưa rõ trạng thái" : "Status unknown");
      return <li key={row.id}><span>#{row.id} · {label}</span>{url && <a href={url} target="_blank" rel="noopener noreferrer">{vi ? "Mở trong Chatwoot" : "Open in Chatwoot"} ↗</a>}</li>;
    })}</ul>}
    {status === "UNKNOWN" && <p>{vi ? "Kiểm tra lại cùng liên kết; yêu cầu chưa rõ kết quả sẽ không tự tạo thêm liên hệ hay hội thoại." : "Check this same link. An unconfirmed request will not automatically create another contact or conversation."}</p>}
    {enabled && status !== "SAVED" && <>
      <p>{vi ? "Thao tác này chỉ chia sẻ mã liên kết ẩn danh. Không gửi tên, email, số điện thoại, hồ sơ điều trị hoặc tin nhắn." : "This shares only an opaque link identifier. It does not send a name, email, phone number, clinical record or message."}</p>
      <label className={styles.confirm}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{vi ? "Tôi muốn liên kết bệnh nhân này với Chatwoot" : "I want to link this patient with Chatwoot"}</label>
      <button type="button" disabled={busy || !confirmed} onClick={() => void load("ensure")}>{vi ? "Tạo hoặc tiếp tục liên kết" : "Create or continue link"}</button>
      {!view?.opaqueIdentifier && <button type="button" disabled={busy || !confirmed} onClick={() => void load("prepare")}>{vi ? "Chuẩn bị liên kết liên hệ có sẵn" : "Prepare link to an existing contact"}</button>}
      {view?.opaqueIdentifier && <details><summary>{vi ? "Liên kết bằng mã đã kiểm tra" : "Link using verified IDs"}</summary>
        <p>{vi ? "Mã nhận diện phải trùng khớp chính xác trong Chatwoot:" : "The identifier in Chatwoot must match exactly:"} <code className={styles.identifier}>{view.opaqueIdentifier}</code></p>
        <label htmlFor={`${id}-contact`}>{vi ? "Mã liên hệ Chatwoot" : "Chatwoot contact ID"}</label>
        <input id={`${id}-contact`} inputMode="numeric" value={contactId} onChange={event => setContactId(event.target.value)} disabled={busy} />
        <label htmlFor={`${id}-conversation`}>{vi ? "Mã hội thoại (không bắt buộc)" : "Conversation ID (optional)"}</label>
        <input id={`${id}-conversation`} inputMode="numeric" value={conversationId} onChange={event => setConversationId(event.target.value)} disabled={busy} />
        <button type="button" disabled={busy || !confirmed || !/^[1-9][0-9]{0,14}$/.test(contactId) || (!!conversationId && !/^[1-9][0-9]{0,14}$/.test(conversationId))}
          onClick={() => void load("link", { contactId, ...(conversationId ? { conversationId } : {}) })}>{vi ? "Kiểm tra và lưu liên kết" : "Verify and save link"}</button>
      </details>}
    </>}
    <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void load()}>{vi ? "Tải lại trạng thái" : "Refresh status"}</button>
      {enabled && status === "UNKNOWN" && <button type="button" disabled={busy} onClick={() => void load("recover")}>{vi ? "Kiểm tra kết quả trong Chatwoot" : "Check result in Chatwoot"}</button>}</div>
  </section>;
}
