"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAppLanguage } from "@/components/AppLanguage";
import type { PayOSSettingsWorkspace } from "@/features/integrations/payos-workspace";
import styles from "./PayOSWorkspace.module.css";

export function PayOSSettingsPanel() {
  const { language } = useAppLanguage();
  const vi = language === "vi";
  const id = useId();
  const [workspace, setWorkspace] = useState<PayOSSettingsWorkspace | null>(null);
  const [scope, setScope] = useState("");
  const [credentials, setCredentials] = useState({ clientId: "", apiKey: "", checksumKey: "" });
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/integrations/payos/settings", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      .then(async response => {
        if (!response.ok) throw new Error(String(response.status));
        const data: PayOSSettingsWorkspace = await response.json();
        if (controller.signal.aborted) return;
        setWorkspace(data);
        setScope(current => data.clinics.some(clinic => clinic.id === current) ? current : data.canManageOrganization ? "" : data.clinics[0]?.id ?? "");
      })
      .catch(() => { if (!controller.signal.aborted) setError(vi ? "Chưa tải được kết nối. Vui lòng thử lại." : "Could not load the connection. Please retry."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload, vi]);

  const connection = workspace?.connections.find(item => item.clinicId === (scope || null));
  const canChoose = !!workspace && (workspace.canManageOrganization || workspace.clinics.length > 0);
  const disabled = loading || pending || !canChoose || !!workspace?.isDemo;
  const ready = !!connection?.enabled && connection.configured && connection.verified;
  const state = !connection?.configured ? (vi ? "Chưa thiết lập" : "Not set up")
    : !connection.enabled ? (vi ? "Đã tắt" : "Disabled")
    : connection.verified ? (vi ? "Đã xác minh" : "Verified") : (vi ? "Chưa xác minh" : "Not verified");

  async function update(action: "save" | "verify" | "disable" | "enable") {
    if (busy.current || disabled) return;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/integrations/payos/settings", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ action, clinicId: scope || null, ...(action === "save" ? { credentials } : {}) }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        if (detail?.error === "payos-orders-unresolved") {
          setError(vi ? "Còn yêu cầu thanh toán chưa được đối soát. Kiểm tra các yêu cầu trước khi thay thông tin hoặc tắt kết nối."
            : "Payment requests still need reconciliation. Review them before replacing details or disabling the connection.");
          return;
        }
        setError(response.status === 403
          ? (vi ? "Bạn chưa có quyền thay đổi kết nối này." : "You do not have permission to change this connection.")
          : response.status === 400 || response.status === 422
            ? (vi ? "Vui lòng kiểm tra thông tin payOS rồi thử lại." : "Check your payOS details and retry.")
            : (vi ? "Chưa hoàn tất thay đổi. Vui lòng tải lại trạng thái trước khi thử lại." : "The change could not be confirmed. Reload the status before retrying."));
        return;
      }
      const data: PayOSSettingsWorkspace = await response.json();
      if (!mounted.current) return;
      setWorkspace(data);
      if (action === "save") setCredentials({ clientId: "", apiKey: "", checksumKey: "" });
      setNotice(action === "save" ? (vi ? "Đã lưu. Xác minh kết nối để nhận thanh toán." : "Saved. Verify the connection to accept payments.")
        : action === "verify" ? (vi ? "Đã kiểm tra trạng thái kết nối." : "Connection status checked.")
          : action === "disable" ? (vi ? "Đã tắt kết nối." : "Connection disabled.") : (vi ? "Đã bật kết nối." : "Connection enabled."));
    } catch {
      if (mounted.current) setError(vi ? "Chưa xác nhận được thay đổi. Hãy tải lại trạng thái kết nối." : "The change could not be confirmed. Reload the connection status.");
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function copyWebhook() {
    if (!connection?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(connection.webhookUrl);
      setNotice(vi ? "Đã sao chép địa chỉ nhận thông báo." : "Notification address copied.");
    } catch { setError(vi ? "Chưa sao chép được. Hãy chọn và sao chép địa chỉ bên dưới." : "Could not copy. Select and copy the address below."); }
  }

  return <section id="payos" className={styles.panel} aria-labelledby={`${id}-title`} aria-busy={loading || pending}>
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>{vi ? "Thanh toán trực tuyến" : "Online payments"}</p><h3 id={`${id}-title`}>payOS</h3></div>
      {workspace && <span className={`${styles.badge} ${ready ? styles.good : styles.neutral}`}>{state}</span>}
    </header>
    <p className={styles.description}>{vi ? "Kết nối payOS để tạo mã thanh toán cho hóa đơn." : "Connect payOS to create payment codes for invoices."}</p>
    {loading && <p role="status">{vi ? "Đang tải kết nối…" : "Loading connection…"}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.success} role="status">{notice}</p>}
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={loading || pending} onClick={() => { setNotice(""); setReload(value => value + 1); }}>{vi ? "Tải lại trạng thái" : "Reload status"}</button></div>
    {workspace && <>
      {workspace.isDemo && <p className={styles.note}>{vi ? "Tài khoản trải nghiệm không thể thay đổi kết nối thanh toán." : "Payment connection changes are unavailable in this preview account."}</p>}
      {!canChoose && <p className={styles.note}>{vi ? "Chưa có phòng khám để thiết lập kết nối." : "No clinic is available to set up a connection."}</p>}
      <label className={styles.field} htmlFor={`${id}-clinic`}><span>{vi ? "Phạm vi kết nối" : "Connection scope"}</span>
        <select id={`${id}-clinic`} value={scope} disabled={disabled} onChange={event => { setScope(event.target.value); setCredentials({ clientId: "", apiKey: "", checksumKey: "" }); setError(""); setNotice(""); }}>
          {workspace.canManageOrganization && <option value="">{vi ? "Toàn bộ tổ chức" : "Organization"}</option>}
          {workspace.clinics.map(clinic => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
        </select>
      </label>
      <div className={styles.readiness}>
        <strong>{ready ? (vi ? "Sẵn sàng nhận thanh toán" : "Ready to accept payments") : (vi ? "Chưa sẵn sàng nhận thanh toán" : "Not ready to accept payments")}</strong>
        <p>{!connection?.configured ? (vi ? "Nhập thông tin kết nối, lưu rồi xác minh." : "Enter your connection details, save, then verify.")
          : !connection.enabled ? (vi ? "Bật kết nối để tiếp tục." : "Enable the connection to continue.")
            : !connection.verified ? (vi ? "Xác minh kết nối trước khi tạo mã thanh toán." : "Verify the connection before creating payment codes.")
              : (vi ? "Thanh toán được ghi nhận khi nhận được xác nhận hợp lệ." : "Payments are recorded after a valid confirmation is received.")}</p>
      </div>
      <fieldset className={styles.credentials} disabled={disabled}>
        <legend>{connection?.configured ? (vi ? "Thay thông tin kết nối" : "Replace connection details") : (vi ? "Thông tin kết nối" : "Connection details")}</legend>
        <p className={styles.description}><a href="https://my.payos.vn" target="_blank" rel="noopener noreferrer">{vi ? "Lấy thông tin tại payOS" : "Get your details from payOS"} ↗</a></p>
        <div className={styles.fields}>
          {([{ key: "clientId", label: "Client ID" }, { key: "apiKey", label: "API Key" }, { key: "checksumKey", label: "Checksum Key" }] as const).map(field =>
            <label key={field.key} className={styles.field} htmlFor={`${id}-${field.key}`}><span>{field.label}</span>
              <input id={`${id}-${field.key}`} type="password" autoComplete="new-password" spellCheck={false} value={credentials[field.key]} onChange={event => setCredentials(current => ({ ...current, [field.key]: event.target.value }))} />
            </label>)}
        </div>
        <p className={styles.description}>{vi ? "Thông tin đã lưu được giữ kín. Nhập đủ ba mục khi thay mới." : "Saved details stay private. Enter all three fields to replace them."}</p>
        <button type="button" className={styles.primary} disabled={disabled || Object.values(credentials).some(value => !value.trim())} onClick={() => void update("save")}>{pending ? (vi ? "Đang xử lý…" : "Working…") : (vi ? "Lưu kết nối" : "Save connection")}</button>
      </fieldset>
      {connection?.configured && <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={disabled || !connection.enabled} onClick={() => void update("verify")}>{vi ? "Xác minh kết nối" : "Verify connection"}</button>
        <button type="button" className={styles.secondary} disabled={disabled} onClick={() => void update(connection.enabled ? "disable" : "enable")}>{connection.enabled ? (vi ? "Tắt kết nối" : "Disable connection") : (vi ? "Bật kết nối" : "Enable connection")}</button>
      </div>}
      {connection?.webhookUrl && <div className={styles.webhook}>
        <label className={styles.field} htmlFor={`${id}-webhook`}><span>{vi ? "Địa chỉ nhận thông báo thanh toán" : "Payment notification address"}</span>
          <textarea id={`${id}-webhook`} readOnly rows={3} value={connection.webhookUrl} />
        </label>
        <button type="button" className={styles.secondary} onClick={() => void copyWebhook()}>{vi ? "Sao chép địa chỉ" : "Copy address"}</button>
      </div>}
    </>}
  </section>;
}
