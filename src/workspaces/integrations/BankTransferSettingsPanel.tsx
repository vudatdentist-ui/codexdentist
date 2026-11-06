"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { BankTransferSettings } from "@/features/integrations/bank-transfer";
import styles from "./PayOSWorkspace.module.css";

export function BankTransferSettingsPanel({ language = "vi" }: { language?: "vi" | "en" } = {}) {
  const vi = language === "vi", id = useId(), mounted = useRef(true), generation = useRef(0), inFlight = useRef(false);
  const [data, setData] = useState<BankTransferSettings | null>(null);
  const [clinic, setClinic] = useState("");
  const [bankBin, setBankBin] = useState(""), [accountNumber, setAccountNumber] = useState(""), [recipientName, setRecipientName] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false), [saved, setSaved] = useState(false);
  const clear = () => { setBankBin(""); setAccountNumber(""); setRecipientName(""); setConfirmed(false); setSaved(false); setError(false); };
  useEffect(() => {
    mounted.current = true;
    const version = ++generation.current;
    fetch("/api/integrations/bank-transfer/settings", { cache: "no-store", signal: AbortSignal.timeout(15000) })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<BankTransferSettings>; })
      .then(value => { if (mounted.current && generation.current === version) { setData(value); setClinic(value.canManageOrganization ? "organization" : value.clinics[0]?.id ?? ""); } })
      .catch(() => { if (mounted.current && generation.current === version) setError(true); });
    return () => { mounted.current = false; generation.current++; };
  }, []);
  const clinicId = clinic === "organization" ? null : clinic;
  const connection = data?.connections.find(c => c.clinicId === clinicId);
  const disabled = busy || !data || data.isDemo || !clinic;
  async function update(action: "save" | "enable" | "disable") {
    if (inFlight.current) return;
    inFlight.current = true; generation.current++;
    setBusy(true); setError(false); setSaved(false);
    try {
      const response = await fetch("/api/integrations/bank-transfer/settings", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, clinicId, ...(action === "save" ? { bankBin, accountNumber, recipientName, accountConfirmed: confirmed } : {}) }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (mounted.current) { setData(value); clear(); setSaved(true); }
    } catch { if (mounted.current) setError(true); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  return <section id="bank-transfer" aria-label={vi ? "Chuyển khoản ngân hàng" : "Bank transfer"} className={styles.panel}>
    <div className={styles.heading}><h3>{vi ? "Chuyển khoản ngân hàng" : "Bank transfer"}</h3></div>
    <p className={styles.description}>{vi ? "Tạo QR ngay tại phòng khám, không cần tài khoản cổng thanh toán. Thông tin tài khoản đã lưu không hiển thị lại tại đây." : "Generate QR codes locally, without a payment gateway account. Saved account details are not displayed here."}</p>
    {error && <p role="alert" className={styles.error}>{vi ? "Chưa tải hoặc lưu được. Kiểm tra quyền truy cập, thông tin tài khoản và thử lại." : "Unable to load or save. Check access and account details, then retry."}</p>}
    {saved && <p role="status" className={styles.success}>{vi ? "Đã lưu. Tài khoản ngân hàng chưa được xác minh tự động." : "Saved. Bank account not automatically verified."}</p>}
    {data && <>
      <label className={styles.field} htmlFor={`${id}-clinic`}>{vi ? "Phạm vi áp dụng" : "Scope"}<select id={`${id}-clinic`} value={clinic} disabled={busy || data.isDemo} onChange={e => { setClinic(e.target.value); clear(); }}>
        {data.canManageOrganization && <option value="organization">{vi ? "Toàn bộ phòng khám" : "Entire organization"}</option>}
        {data.clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      {connection?.configured && <p className={styles.note}>{vi ? "Đã lưu tài khoản; chưa xác minh tự động. " : "Account saved; not automatically verified. "}{connection.enabled ? (vi ? "Đang dùng để tạo hướng dẫn chuyển khoản." : "Enabled for transfer instructions.") : (vi ? "Đã tắt." : "Disabled.")}</p>}
      <fieldset disabled={disabled} className={styles.credentials}><legend>{vi ? "Tài khoản nhận tiền thực tế" : "Actual receiving account"}</legend>
        <label className={styles.field} htmlFor={`${id}-bin`}>{vi ? "Mã BIN ngân hàng (6 chữ số)" : "Bank BIN (6 digits)"}<input id={`${id}-bin`} value={bankBin} onChange={e => setBankBin(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="off" /></label>
        <label className={styles.field} htmlFor={`${id}-account`}>{vi ? "Số tài khoản" : "Account number"}<input id={`${id}-account`} value={accountNumber} onChange={e => setAccountNumber(e.target.value)} inputMode="numeric" maxLength={19} autoComplete="off" /></label>
        <label className={styles.field} htmlFor={`${id}-name`}>{vi ? "Tên người nhận theo ngân hàng" : "Recipient name registered with bank"}<input id={`${id}-name`} value={recipientName} onChange={e => setRecipientName(e.target.value)} maxLength={100} autoComplete="off" /></label>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> {vi ? "Tôi đã đối chiếu mã ngân hàng, số tài khoản và tên người nhận trên ứng dụng ngân hàng." : "I checked the bank BIN, account number and recipient name in the banking app."}</label>
        <div className={styles.actions}><button className={styles.primary} disabled={disabled || !confirmed || !bankBin || !accountNumber || !recipientName} onClick={() => void update("save")} type="button">{vi ? "Lưu tài khoản" : "Save account"}</button></div>
      </fieldset>
      {connection?.configured && <button type="button" className={styles.secondary} disabled={disabled} onClick={() => void update(connection.enabled ? "disable" : "enable")}>{connection.enabled ? (vi ? "Tắt hướng dẫn chuyển khoản" : "Disable transfer instructions") : (vi ? "Bật hướng dẫn chuyển khoản" : "Enable transfer instructions")}</button>}
      <p className={styles.note}>{vi ? "QR chỉ là hướng dẫn thanh toán. Chỉ ghi phiếu thu sau khi nhân viên xác nhận tiền đã vào tài khoản. Kiểm tra lại người nhận trước mỗi lần chuyển." : "QR is payment instructions. Record a receipt only after staff confirms the transfer reached the account. Check the recipient before each transfer."}</p>
    </>}
  </section>;
}
