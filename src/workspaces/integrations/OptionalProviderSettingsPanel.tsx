"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useAppLanguage } from "@/components/AppLanguage";
import type { OptionalProvider, OptionalProviderWorkspace } from "@/features/integrations/optional-provider";
import styles from "./PayOSWorkspace.module.css";
import { NovuNotificationPanel } from "./NovuNotificationPanel";

export function OptionalProviderSettingsPanel({ provider }: { provider: OptionalProvider }) {
  const { language } = useAppLanguage(), vi = language === "vi", id = useId();
  const [workspace, setWorkspace] = useState<OptionalProviderWorkspace | null>(null);
  const [scope, setScope] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(true), busy = useRef(false);
  const endpoint = `/api/integrations/optional-providers/${provider}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<OptionalProviderWorkspace>; })
      .then(data => { if (controller.signal.aborted) return; setWorkspace(data);
        setScope(current => data.clinics.some(clinic => clinic.id === current) ? current : data.canManageOrganization ? "" : data.clinics[0]?.id ?? ""); })
      .catch(() => { if (!controller.signal.aborted) setError(vi ? "Chưa tải được kết nối. Hãy kiểm tra quyền truy cập và thử lại." : "Could not load connection. Check access and retry."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, refresh, vi]);
  const connection = workspace?.connections.find(row => row.clinicId === (scope || null));
  const disabled = loading || pending || !workspace || workspace.isDemo || (!workspace.canManageOrganization && !workspace.clinics.length);
  async function change(action: "save" | "verify" | "disable" | "rotate") {
    if (busy.current || disabled) return;
    busy.current = true; setPending(true); setNotice(""); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60000), body: JSON.stringify({ action, clinicId: scope || null,
          ...(["save", "rotate"].includes(action) ? { credentials: Object.fromEntries(workspace!.definition.fields.map(field =>
            [field.key, fields[field.key] ?? field.defaultValue ?? ""])) } : {}) }) });
      const result = await response.json().catch(() => null) as (OptionalProviderWorkspace & { error?: string }) | null;
      if (!mounted.current) return;
      if (!response.ok || !result?.definition) {
        const code = result?.error;
        setError(code === "integration-use-credential-rotation" || code === "integration-account-binding-mismatch"
          ? (vi ? "Kết nối đã có dữ liệu liên kết. Chỉ thay khóa cho cùng máy chủ và tài khoản đã xác minh." : "Linked data exists. Rotate keys only for the same verified server and account.")
          : code === "integration-account-owned-by-other-organization"
            ? (vi ? "Tài khoản dịch vụ này đã thuộc tổ chức khác. Dùng tài khoản riêng của phòng khám." : "This service account belongs to another organization. Use your clinic's own account.")
          : code === "integration-origin-not-allowed"
            ? (vi ? "Địa chỉ dịch vụ chưa được quản trị hệ thống cho phép. Kiểm tra địa chỉ máy chủ tự host." : "This service address is not approved by the system operator. Check your self-hosted server.")
            : code === "integration-configuration-changed"
              ? (vi ? "Kết nối vừa thay đổi. Tải lại trạng thái trước khi xác minh tiếp." : "Connection changed. Refresh its status before verifying again.")
              : (vi ? "Chưa xác nhận được thay đổi. Kiểm tra thông tin kết nối và thử lại." : "Could not confirm the change. Check the connection details and retry."));
        return;
      }
      setWorkspace(result); setFields({});
      setNotice(action === "save" ? (vi ? "Đã lưu. Kết nối đang tắt; kiểm tra kết nối để bật sử dụng." : "Saved and disabled. Verify the connection to enable it.")
        : action === "disable" ? (vi ? "Đã tắt kết nối." : "Connection disabled.")
          : (vi ? "Đã xác minh đúng tài khoản và bật kết nối." : "Account verified and connection enabled."));
    } catch { if (mounted.current) setError(vi ? "Chưa nhận được kết quả. Tải lại trạng thái trước khi thử tiếp." : "Result not received. Refresh status before retrying."); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  return <section id={provider} aria-label={workspace?.definition.name ?? provider} className={styles.panel}>
    <div className={styles.heading}><div><p className={styles.eyebrow}>{vi ? "Dịch vụ mã nguồn mở tự host" : "Self-hosted open-source service"}</p>
      <h3>{workspace?.definition.name ?? provider}</h3></div>
      <span className={`${styles.badge} ${connection?.verified && connection.status === "ACTIVE" ? styles.good : styles.neutral}`}>
        {connection?.verified && connection.status === "ACTIVE" ? (vi ? "Đã bật và xác minh" : "Enabled and verified")
          : connection?.configured ? (vi ? "Đã lưu — đang tắt" : "Saved — disabled") : (vi ? "Chưa thiết lập" : "Not configured")}</span></div>
    <p className={styles.description}>{workspace?.definition.description}</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {workspace?.isDemo && <p className={styles.note}>{vi ? "Không thay đổi hoặc gửi dữ liệu ra dịch vụ ngoài trong bản dùng thử." : "External service changes and exports are unavailable in demo workspaces."}</p>}
    <label className={styles.field} htmlFor={`${id}-scope`}>{vi ? "Phạm vi sử dụng" : "Scope"}
      <select id={`${id}-scope`} aria-label={vi ? "Phạm vi sử dụng" : "Scope"} disabled={disabled} value={scope} onChange={event => { setScope(event.target.value); setFields({}); setError(""); setNotice(""); }}>
        {workspace?.canManageOrganization && <option value="">{vi ? "Toàn tổ chức" : "Organization"}</option>}
        {workspace?.clinics.map(clinic => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
      </select></label>
    <fieldset className={styles.credentials} disabled={disabled}><legend>{vi ? "Thông tin kết nối" : "Connection details"}</legend>
      <p className={styles.description}>{vi ? "Thông tin được mã hóa và không hiển thị lại. Lưu thông tin chưa đồng nghĩa với kết nối đã hoạt động." : "Details are encrypted and never read back. Saving does not mean the service is operational."}</p>
      <div className={styles.fields}>{workspace?.definition.fields.map(field => <label key={field.key} className={styles.field} htmlFor={`${id}-${field.key}`}>{field.label}
        {field.options ? <select id={`${id}-${field.key}`} aria-label={field.label} value={fields[field.key] ?? field.defaultValue ?? ""}
          onChange={event => setFields(current => ({ ...current, [field.key]: event.target.value }))}>
          {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : <input id={`${id}-${field.key}`} type={field.secret ? "password" : "text"} value={fields[field.key] ?? field.defaultValue ?? ""} autoComplete="off" spellCheck={false}
            maxLength={4096} required={field.required} onChange={event => setFields(current => ({ ...current, [field.key]: event.target.value }))} />}
      </label>)}</div>
      <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => change(connection?.hasReferences ? "rotate" : "save")}>
        {pending ? (vi ? "Đang xử lý…" : "Working…") : connection?.hasReferences ? (vi ? "Xác minh và thay khóa cùng tài khoản" : "Verify and rotate same-account keys") : (vi ? "Lưu kết nối" : "Save connection")}</button></div>
    </fieldset>
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={disabled || !connection?.configured} onClick={() => change("verify")}>{vi ? "Kiểm tra kết nối và bật" : "Verify and enable"}</button>
      <button type="button" className={styles.secondary} disabled={disabled || connection?.status !== "ACTIVE"} onClick={() => change("disable")}>{vi ? "Tắt kết nối" : "Disable"}</button>
      <button type="button" className={styles.secondary} disabled={pending} onClick={() => setRefresh(value => value + 1)}>{vi ? "Tải lại trạng thái" : "Refresh status"}</button></div>
    {connection?.verifiedAt && <p className={styles.description}>{vi ? "Xác minh lần cuối: " : "Last verified: "}{new Date(connection.verifiedAt).toLocaleString(vi ? "vi-VN" : "en-GB")}</p>}
    {provider === "novu" && connection?.status === "ACTIVE" && connection.verified && (scope || workspace?.clinics[0]?.id) &&
      <NovuNotificationPanel key={connection.id} clinicId={scope || workspace!.clinics[0].id} language={language} />}
  </section>;
}
