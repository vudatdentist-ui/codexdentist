"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAppLanguage } from "@/components/AppLanguage";
import type { DocumensoSettingsWorkspace } from "@/features/integrations/documenso-workspace";
import styles from "./PayOSWorkspace.module.css";

export function DocumensoSettingsPanel() {
  const { language } = useAppLanguage();
  const vi = language === "vi", id = useId();
  const [workspace, setWorkspace] = useState<DocumensoSettingsWorkspace | null>(null);
  const [scope, setScope] = useState("");
  const [credentials, setCredentials] = useState({ apiToken: "", webhookSecret: "" });
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const busy = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/integrations/documenso/settings", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      .then(async response => {
        if (!response.ok) throw new Error("load");
        const data: DocumensoSettingsWorkspace = await response.json();
        if (controller.signal.aborted) return;
        setWorkspace(data);
        setScope(current => data.clinics.some(clinic => clinic.id === current) ? current : data.canManageOrganization ? "" : data.clinics[0]?.id ?? "");
      })
      .catch(() => { if (!controller.signal.aborted) setError(vi ? "Chưa tải được kết nối ký tài liệu. Vui lòng thử lại." : "Could not load the signing connection. Please retry."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload, vi]);
  const connection = workspace?.connections.find(item => item.clinicId === (scope || null));
  const disabled = loading || pending || !workspace || workspace.isDemo || (!workspace.canManageOrganization && !workspace.clinics.length);
  async function update(action: "save" | "enable" | "disable") {
    if (busy.current || disabled) return;
    busy.current = true; setPending(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/integrations/documenso/settings", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ action, clinicId: scope || null, ...(action === "save" ? { credentials } : {}) }) });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        if (!mounted.current) return;
        setError(detail?.error === "documenso-ceremonies-unresolved"
          ? (vi ? "Còn tài liệu đang chờ ký hoặc nhận kết quả. Kiểm tra các phiên ký trước khi thay thông tin hay tắt kết nối." : "Documents still await signing or import. Review those requests before changing or disabling the connection.")
          : response.status === 403 ? (vi ? "Bạn chưa có quyền thay đổi kết nối này." : "You cannot change this connection.")
            : (vi ? "Chưa xác nhận được thay đổi. Kiểm tra thông tin và tải lại trạng thái." : "The change could not be confirmed. Check the details and reload the status."));
        return;
      }
      const data: DocumensoSettingsWorkspace = await response.json();
      if (!mounted.current) return;
      setWorkspace(data);
      if (action === "save") setCredentials({ apiToken: "", webhookSecret: "" });
      setNotice(action === "save" ? (vi ? "Đã lưu. Thiết lập thông báo kết quả trong Documenso trước khi gửi tài liệu." : "Saved. Configure result notifications in Documenso before sending documents.")
        : action === "disable" ? (vi ? "Đã tắt kết nối ký tài liệu." : "Signing connection disabled.") : (vi ? "Đã bật kết nối ký tài liệu." : "Signing connection enabled."));
    } catch { if (mounted.current) setError(vi ? "Chưa xác nhận được thay đổi. Vui lòng tải lại trạng thái." : "Could not confirm the change. Please reload the status."); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function copyAddress() {
    if (!connection) return;
    try { await navigator.clipboard.writeText(connection.webhookUrl); setNotice(vi ? "Đã sao chép địa chỉ nhận kết quả." : "Result address copied."); }
    catch { setError(vi ? "Hãy chọn và sao chép địa chỉ bên dưới." : "Select and copy the address below."); }
  }
  return <section id="documenso" className={styles.panel} aria-labelledby={`${id}-title`} aria-busy={loading || pending}>
    <header className={styles.heading}><div><p className={styles.eyebrow}>{vi ? "Ký tài liệu" : "Document signing"}</p><h3 id={`${id}-title`}>Documenso</h3></div>
      {workspace && <span className={`${styles.badge} ${styles.neutral}`}>{!connection?.configured ? (vi ? "Chưa thiết lập" : "Not set up") : !connection.enabled ? (vi ? "Đã tắt" : "Disabled") : (vi ? "Đã lưu thông tin" : "Details saved")}</span>}
    </header>
    <p className={styles.description}>{vi ? "Gửi bản PDF đồng thuận để bệnh nhân xem và ký. Bản đã ký được lưu vào hồ sơ bệnh nhân." : "Send consent PDFs for patients to review and sign. Signed copies are stored in the patient record."}</p>
    {loading && <p role="status">{vi ? "Đang tải kết nối…" : "Loading connection…"}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    <div className={styles.actions}><button className={styles.secondary} type="button" disabled={loading || pending} onClick={() => { setNotice(""); setReload(value => value + 1); }}>{vi ? "Tải lại trạng thái" : "Reload status"}</button></div>
    {workspace && <>
      {workspace.isDemo && <p className={styles.note}>{vi ? "Tài khoản trải nghiệm không thể gửi tài liệu ra ngoài hoặc thay kết nối ký." : "Preview accounts cannot send documents externally or change the signing connection."}</p>}
      <label className={styles.field} htmlFor={`${id}-clinic`}><span>{vi ? "Phạm vi kết nối" : "Connection scope"}</span>
        <select id={`${id}-clinic`} value={scope} disabled={disabled} onChange={event => { setScope(event.target.value); setCredentials({ apiToken: "", webhookSecret: "" }); setError(""); setNotice(""); }}>
          {workspace.canManageOrganization && <option value="">{vi ? "Toàn bộ tổ chức" : "Organization"}</option>}
          {workspace.clinics.map(clinic => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
        </select>
      </label>
      <fieldset className={styles.credentials} disabled={disabled}>
        <legend>{vi ? "Thông tin kết nối" : "Connection details"}</legend>
        <label className={styles.field} htmlFor={`${id}-token`}><span>API Token</span><input id={`${id}-token`} type="password" autoComplete="new-password" value={credentials.apiToken} onChange={event => setCredentials(current => ({ ...current, apiToken: event.target.value }))} /></label>
        <label className={styles.field} htmlFor={`${id}-secret`}><span>Webhook Secret</span><input id={`${id}-secret`} type="password" autoComplete="new-password" value={credentials.webhookSecret} onChange={event => setCredentials(current => ({ ...current, webhookSecret: event.target.value }))} /></label>
        <p className={styles.description}>{vi ? "Nhập thông tin từ tài khoản Documenso của phòng khám. Thông tin đã lưu không hiển thị lại." : "Use your clinic’s Documenso account details. Saved credentials are never displayed again."}</p>
        <button className={styles.primary} type="button" disabled={disabled || Object.values(credentials).some(value => !value.trim())} onClick={() => void update("save")}>{vi ? "Lưu kết nối" : "Save connection"}</button>
      </fieldset>
      {connection?.configured && <>
        <div className={styles.actions}><button className={styles.secondary} type="button" disabled={disabled} onClick={() => void update(connection.enabled ? "disable" : "enable")}>{connection.enabled ? (vi ? "Tắt kết nối" : "Disable connection") : (vi ? "Bật kết nối" : "Enable connection")}</button></div>
        <div className={styles.webhook}>
          <p className={styles.note}>{vi ? "Trong Documenso, thêm địa chỉ nhận kết quả bên dưới và dùng cùng Webhook Secret. Chọn thông báo khi tài liệu hoàn tất. Chỉ kết quả hợp lệ mới hoàn tất đồng thuận trên app." : "In Documenso, add this result address with the same Webhook Secret and enable document completion events. Only valid results complete the consent in this app."}</p>
          <label className={styles.field} htmlFor={`${id}-webhook`}><span>{vi ? "Địa chỉ nhận kết quả ký" : "Signing result address"}</span><textarea id={`${id}-webhook`} readOnly rows={3} value={connection.webhookUrl} /></label>
          <button className={styles.secondary} type="button" onClick={() => void copyAddress()}>{vi ? "Sao chép địa chỉ" : "Copy address"}</button>
          <p className={styles.description}>{connection.verifiedAt ? (vi ? "Đã nhận thông báo hợp lệ từ Documenso." : "A valid Documenso notification has been received.") : (vi ? "Chưa nhận thông báo ký hợp lệ. Việc lưu thông tin chưa xác nhận kết nối hoạt động." : "No valid signing notification has been received. Saving details does not verify the connection.")}</p>
        </div>
      </>}
    </>}
  </section>;
}
