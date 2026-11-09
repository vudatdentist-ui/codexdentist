"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./PayOSWorkspace.module.css";
import type { MedplumPatientWorkspace } from "@/features/integrations/medplum";

export function MedplumPatientExport({ patientId, language }: { patientId: string; language: "vi" | "en" }) {
  return <PatientExport key={patientId} patientId={patientId} language={language} />;
}
function PatientExport({ patientId, language }: { patientId: string; language: "vi" | "en" }) {
  const vi = language === "vi";
  const [data, setData] = useState<MedplumPatientWorkspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const version = ++generation.current;
    setData(null); setError(false); setBusy(true);
    fetch(`/api/integrations/medplum/patients/${encodeURIComponent(patientId)}`, { cache: "no-store", signal: AbortSignal.timeout(30000) })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(value => { if (version === generation.current) setData(value); })
      .catch(() => { if (version === generation.current) setError(true); })
      .finally(() => { if (version === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [patientId, refresh]);
  async function send() {
    const version = generation.current;
    setBusy(true); setError(false);
    try {
      const response = await fetch(`/api/integrations/medplum/patients/${encodeURIComponent(patientId)}`, { method: "POST", signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (version === generation.current) setData(value);
    } catch { if (version === generation.current) setError(true); }
    finally { if (version === generation.current) setBusy(false); }
  }
  const labels = vi ? { NEVER: "Chưa gửi", PENDING: "Đang gửi — hãy kiểm tra lại sau", RETRY: "Chưa xác minh — có thể thử lại", VERIFIED: "Đã xác minh bản hiện tại", SOURCE_CHANGED: "Hồ sơ đã thay đổi — cần gửi lại" }
    : { NEVER: "Not sent", PENDING: "Sending — check again shortly", RETRY: "Unverified — retry available", VERIFIED: "Current record verified", SOURCE_CHANGED: "Record changed — export again" };
  return <section aria-label="Medplum" className={styles.panel}>
    <div className={styles.heading}><h3>Medplum</h3></div>
    <p className={styles.description}>{vi ? "Gửi thông tin hành chính của người bệnh đến Medplum. Hồ sơ tại phòng khám vẫn là bản chính." : "Send patient demographics to Medplum. The clinic record remains the source of truth."}</p>
    {(data || busy) && <p role="status" aria-live="polite" className={styles.note}>{data ? labels[data.status] : (vi ? "Đang kiểm tra…" : "Checking…")}</p>}
    {data?.lastVerifiedAt && <p className={styles.description}>{vi ? "Xác minh lần cuối: " : "Last verified: "}{new Date(data.lastVerifiedAt).toLocaleString(vi ? "vi-VN" : "en-GB")}</p>}
    {data && <p className={styles.description}>{vi ? "Số lần gửi: " : "Attempts: "}{data.attempts}</p>}
    {error && <p role="alert" className={styles.error}>{vi ? "Không thể kiểm tra hoặc gửi. Kiểm tra quyền truy cập và kết nối Medplum trong Cài đặt." : "Unable to check or send. Check access and the Medplum connection in Settings."}</p>}
    <div className={styles.actions}><button type="button" disabled={busy || !data} onClick={send} className={styles.primary}>{busy ? (vi ? "Đang xử lý…" : "Working…") : data?.attempts ? (vi ? "Gửi lại bản hiện tại" : "Export current record again") : (vi ? "Gửi đến Medplum" : "Export to Medplum")}</button>
    <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)} className={styles.secondary}>{vi ? "Kiểm tra lại" : "Refresh status"}</button></div>
  </section>;
}
