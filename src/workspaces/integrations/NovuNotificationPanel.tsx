"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { NovuOperatorWorkspace, NovuDeliveryState } from "@/features/integrations/novu-workspace";
import styles from "./PayOSWorkspace.module.css";

// Mount in optional integration settings with clinicId, or in a patient
// workspace with both clinicId and the explicitly selected patientId.
export function NovuNotificationPanel({ clinicId, patientId, language }: {
  clinicId: string; patientId?: string; language: "vi" | "en";
}) {
  const vi = language === "vi", headingId = useId(), busy = useRef(false);
  const [workspace, setWorkspace] = useState<NovuOperatorWorkspace | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const scope = `${clinicId}:${patientId ?? ""}`;
  const activeScope = useRef(scope); activeScope.current = scope;
  useEffect(() => {
    const controller = new AbortController();
    activeScope.current = scope; setPending(false);
    setWorkspace(null); setError(""); setNotice("");
    fetch(`/api/integrations/novu/operator?${new URLSearchParams({ clinicId, ...(patientId ? { patientId } : {}) })}`,
      { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      .then(async response => {
        if (!response.ok) throw new Error("load");
        const data: NovuOperatorWorkspace = await response.json();
        if (!controller.signal.aborted) setWorkspace(data);
      }).catch(() => { if (!controller.signal.aborted) setError(vi ? "Chưa tải được trạng thái. Kiểm tra kết nối Novu rồi thử lại." : "Could not load status. Check the Novu connection and retry."); });
    return () => controller.abort();
  }, [clinicId, patientId, reload, vi]);
  useEffect(() => () => { activeScope.current = "unmounted"; }, []);
  async function command(action: string, deliveryId?: string) {
    if (busy.current || !workspace) return;
    const requestedScope = scope;
    busy.current = true; setPending(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/integrations/novu/operator", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ action, clinicId, ...(patientId ? { patientId } : {}), ...(deliveryId ? { deliveryId } : {}) }) });
      if (!response.ok) throw new Error("operation");
      const data: NovuOperatorWorkspace = await response.json();
      if (activeScope.current !== requestedScope) return;
      setWorkspace(data);
      setNotice(vi ? "Đã kiểm tra trạng thái. Chỉ mục đã gửi mới được xác nhận hoàn tất." : "Status checked. Only sent messages are confirmed complete.");
    } catch { if (activeScope.current === requestedScope) setError(vi ? "Chưa xác nhận được thao tác. Tải lại và kiểm tra trạng thái trước khi tiếp tục." : "Could not confirm the operation. Reload and check status before continuing."); }
    finally { busy.current = false; if (activeScope.current === requestedScope) setPending(false); }
  }
  const stateLabel = (state: NovuDeliveryState) => ({ RESERVED: vi ? "Đang kiểm tra" : "Checking",
    ACCEPTED: vi ? "Đang chờ gửi" : "Awaiting delivery", UNCERTAIN: vi ? "Cần đối soát" : "Needs reconciliation",
    REJECTED: vi ? "Không được chấp nhận" : "Rejected", SENT: vi ? "Đã gửi" : "Sent" })[state];
  return <section className={styles.panel} aria-labelledby={headingId} aria-busy={pending}>
    <header className={styles.heading}><div><p className={styles.eyebrow}>{vi ? "Thông báo" : "Notifications"}</p><h3 id={headingId}>Novu</h3></div>
      <button type="button" className={styles.secondary} disabled={pending} onClick={() => setReload(value => value + 1)}>{vi ? "Tải lại" : "Reload"}</button></header>
    <p className={styles.description}>{patientId
      ? (vi ? "Liên kết người nhận cho bệnh nhân đang mở. Tạo người nhận trong Novu bằng mã dưới đây, sau đó xác minh địa chỉ email." : "Link a recipient for the selected patient. Create the Novu subscriber using the ID below, then verify its email address.")
      : (vi ? "Kiểm tra luồng thông báo bằng người nhận thử nghiệm đã thiết lập. Không dùng thông tin bệnh nhân cho lần thử này." : "Check the configured workflow with its synthetic recipient. This test uses no patient information.")}</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {!workspace && !error && <p role="status">{vi ? "Đang tải…" : "Loading…"}</p>}
    {workspace && <>
      {patientId ? <>
        {workspace.subscriber && <div className={styles.readiness}><p style={{ overflowWrap: "anywhere" }}>{workspace.subscriber.subscriberId}</p>
          <p>{workspace.subscriber.verified ? (vi ? "Đã xác minh người nhận" : "Recipient verified") : (vi ? "Chờ xác minh người nhận" : "Recipient verification pending")}</p></div>}
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled={pending || Boolean(workspace.subscriber)} onClick={() => command("allocate-subscriber")}>{vi ? "Tạo mã người nhận" : "Create recipient ID"}</button>
          <button type="button" className={styles.primary} disabled={pending || !workspace.subscriber} onClick={() => command("verify-subscriber")}>{vi ? "Xác minh người nhận" : "Verify recipient"}</button></div>
      </> : <div className={styles.actions}><button type="button" className={styles.primary} disabled={pending || workspace.deliveries.length > 0} onClick={() => command("test")}>{vi ? "Gửi thử nghiệm" : "Send synthetic test"}</button></div>}
      <p className={styles.note}>{vi ? "Thông báo được chấp nhận vẫn cần xác nhận gửi. Mục chưa rõ kết quả sẽ không được gửi lại tự động." : "Accepted requests still need delivery confirmation. Requests with uncertain results are never sent again automatically."}</p>
      <ul className={styles.history}>{workspace.deliveries.map(item => <li className={styles.order} key={item.id}><div className={styles.orderTop}>
        <span>{item.synthetic ? (vi ? "Lần thử nghiệm" : "Synthetic test") : (vi ? "Thông báo" : "Notification")}</span><span className={`${styles.badge} ${item.state === "SENT" ? styles.good : styles.neutral}`}>{stateLabel(item.state)}</span></div>
        {item.state !== "SENT" && item.state !== "REJECTED" && <button type="button" className={styles.secondary} disabled={pending} onClick={() => command("reconcile", item.id)}>{vi ? "Kiểm tra kết quả gửi" : "Check delivery result"}</button>}
      </li>)}</ul>
    </>}
  </section>;
}
