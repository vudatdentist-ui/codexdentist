"use client";
import { useEffect, useState } from "react";
import { ChatwootPatientConversation } from "./ChatwootPatientConversation";
import { MedplumPatientExport } from "./MedplumPatientExport";
import { NovuNotificationPanel } from "./NovuNotificationPanel";
import styles from "./PayOSWorkspace.module.css";
type Workspace = { clinicId: string; canManage: boolean; services: Array<{ provider: string; allowed: boolean; enabled: boolean }> };
export function PatientIntegrationTools(props: { patientId: string; language: "vi" | "en" }) {
  return <PatientTools key={props.patientId} {...props} />;
}
function PatientTools({ patientId, language }: { patientId: string; language: "vi" | "en" }) {
  const vi = language === "vi", [open, setOpen] = useState(false), [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setError(false); setWorkspace(null);
    fetch(`/api/integrations/patient-workspace?${new URLSearchParams({ patientId })}`, {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<Workspace>; })
      .then(value => { if (!controller.signal.aborted) setWorkspace(value); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [patientId, open, refresh]);
  const active = (provider: string) => workspace?.services.some(service => service.provider === provider && service.allowed && service.enabled);
  return <section className={styles.payment} aria-label={vi ? "Dịch vụ kết nối của bệnh nhân" : "Patient integrations"}>
    <div className={styles.actions}><button className={styles.secondary} type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? (vi ? "Ẩn dịch vụ kết nối" : "Hide integrations") : (vi ? "Dịch vụ kết nối" : "Connected services")}</button></div>
    {open && <>
      {error && <p role="alert" className={styles.error}>{vi ? "Chưa tải được dịch vụ trong phạm vi hồ sơ này." : "Could not load services for this record."}</p>}
      {!workspace && !error && <p role="status">{vi ? "Đang kiểm tra kết nối…" : "Checking connections…"}</p>}
      {workspace && !workspace.services.some(service => service.allowed && service.enabled) && <p className={styles.note}>
        {vi ? "Chưa có dịch vụ nào được bật cho hồ sơ này trong phạm vi của bạn." : "No service is enabled for this record within your access."}
        {workspace.canManage && <> <a href="/settings?section=providers">{vi ? "Thiết lập dịch vụ tự host" : "Configure self-hosted services"}</a></>}</p>}
      {active("chatwoot") && <ChatwootPatientConversation patientId={patientId} language={language} />}
      {active("medplum") && <MedplumPatientExport patientId={patientId} language={language} />}
      {active("novu") && <NovuNotificationPanel clinicId={workspace!.clinicId} patientId={patientId} language={language} />}
      <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setRefresh(value => value + 1)}>{vi ? "Tải lại dịch vụ" : "Refresh services"}</button></div>
    </>}
  </section>;
}
