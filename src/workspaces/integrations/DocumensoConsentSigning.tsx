"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceDialog } from "@/shared/ui/WorkspaceDialog/WorkspaceDialog";
import { documensoSigningUrl, type DocumensoConsentWorkspace } from "@/features/integrations/documenso-workspace";
import styles from "./PayOSWorkspace.module.css";

export function DocumensoConsentSigning(props: { patientFormId: string; language: "vi" | "en" }) {
  return <ConsentSigning key={props.patientFormId} {...props} />;
}
function ConsentSigning({ patientFormId, language }: { patientFormId: string; language: "vi" | "en" }) {
  const vi = language === "vi", id = useId(), router = useRouter();
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [pending, setPending] = useState(false);
  const [workspace, setWorkspace] = useState<DocumensoConsentWorkspace | null>(null);
  const [source, setSource] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const busy = useRef(false), mounted = useRef(true), sequence = useRef(0), intent = useRef<string | null>(null);
  const lastStatus = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/integrations/documenso/signing-requests?${new URLSearchParams({ patientFormId })}`,
        { cache: "no-store", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("load");
      const data: DocumensoConsentWorkspace = await response.json();
      if (!mounted.current || current !== sequence.current) return;
      setWorkspace(data); setSource(data.sourcePatientFileId ?? "");
      if (data.request?.idempotencyKey) intent.current = data.request.idempotencyKey;
      if (data.status === "COMPLETED" && lastStatus.current !== "COMPLETED") router.refresh();
      lastStatus.current = data.status;
    } catch { if (mounted.current && current === sequence.current) setError(vi ? "Chưa tải được trạng thái ký. Vui lòng thử lại." : "Could not load signing status. Please retry."); }
    finally { if (mounted.current && current === sequence.current) setLoading(false); }
  }, [patientFormId, router, vi]);
  useEffect(() => { if (open && !busy.current) void load(); }, [open, load]);
  const request = workspace?.request;
  const signed = request?.status === "SIGNED" && !!workspace?.signedFileUrl;
  const completed = workspace?.status === "COMPLETED";
  const failed = request?.status === "FAILED";
  const sourceAttached = !!source && source === workspace?.sourcePatientFileId;
  const disabled = loading || pending || !workspace || workspace.isDemo;
  const canSend = !disabled && !!workspace?.canRequest && confirmed && sourceAttached;
  const signingUrl = documensoSigningUrl(request?.signingUrl);
  const signedFile = workspace?.signedFileUrl && /^\/patient-files\/[A-Za-z0-9_-]+$/.test(workspace.signedFileUrl) ? workspace.signedFileUrl : null;
  const state = signed ? (vi ? "Đã ký và lưu vào hồ sơ" : "Signed and stored in the patient record")
    : completed ? (vi ? "Biểu mẫu đã hoàn tất" : "Form completed")
      : failed ? (vi ? "Yêu cầu ký bị từ chối" : "Signing request rejected")
    : request?.status === "ERROR" || request?.status === "UNKNOWN" ? (vi ? "Cần kiểm tra phiên ký" : "Signing request needs attention")
      : request ? (vi ? "Đang chờ hoàn tất ký" : "Awaiting signing completion") : (vi ? "Chưa gửi yêu cầu ký" : "No signing request sent");
  async function update(action: "attach-source" | "send") {
    if (busy.current || disabled || (action === "send" && !canSend) || !source) return;
    busy.current = true; setPending(true); setError(""); setNotice("");
    try {
      if (action === "send" && !intent.current) intent.current = crypto.randomUUID();
      const response = await fetch("/api/integrations/documenso/signing-requests", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ patientFormId, sourcePatientFileId: source,
          ...(action === "attach-source" ? { action } : { idempotencyKey: intent.current }) }) });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        if (!mounted.current) return;
        setError(response.status === 403 ? (vi ? "Bạn chưa có quyền thực hiện yêu cầu này." : "You cannot perform this request.")
          : detail?.error === "documenso-patient-email-required" ? (vi ? "Cập nhật email bệnh nhân trước khi gửi ký." : "Update the patient’s email before sending.")
            : response.status === 409 ? (vi ? "Biểu mẫu hoặc phiên ký đã thay đổi. Tải lại trạng thái trước khi tiếp tục." : "The form or signing request changed. Refresh the status before continuing.")
              : (vi ? "Chưa xác nhận được yêu cầu. Tải lại trạng thái; thử lại sẽ tiếp tục cùng phiên ký." : "The request could not be confirmed. Refresh the status; retry continues the same signing request."));
        return;
      }
      if (!mounted.current) return;
      setNotice(action === "attach-source" ? (vi ? "Đã gắn bản PDF. Kiểm tra người nhận trước khi gửi ký." : "PDF attached. Check the recipient before sending.")
        : (vi ? "Đã gửi yêu cầu ký. Chờ nhận bản đã ký để hoàn tất đồng thuận." : "Signing request sent. Await the signed document to complete consent."));
      await load();
    } catch { if (mounted.current) setError(vi ? "Chưa nhận được xác nhận. Tải lại trạng thái trước khi thử lại cùng phiên ký." : "No confirmation received. Refresh the status before retrying the same signing request."); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  return <>
    <button type="button" className={styles.secondary} onClick={() => setOpen(true)}>{vi ? "Ký qua Documenso" : "Sign with Documenso"}</button>
    <WorkspaceDialog open={open} onClose={() => setOpen(false)} title={vi ? "Ký đồng thuận qua Documenso" : "Consent signing with Documenso"} closeLabel={vi ? "Đóng" : "Close"} className={styles.dialog}>
      <div className={styles.payment} aria-busy={loading || pending}>
        {loading && <p role="status">{vi ? "Đang tải trạng thái…" : "Loading status…"}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {notice && <p role="status" className={styles.success}>{notice}</p>}
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled={loading || pending} onClick={() => void load()}>{vi ? "Tải lại trạng thái" : "Refresh status"}</button></div>
        {workspace && <>
          <p className={styles.invoice}><span>{vi ? "Biểu mẫu" : "Form"}: <strong>{workspace.formNo}</strong></span><strong>{state}</strong></p>
          {workspace.isDemo && <p className={styles.note}>{vi ? "Tài khoản trải nghiệm không thể gửi tài liệu ra ngoài." : "Preview accounts cannot send documents externally."}</p>}
          {!workspace.configured && !signed && <p className={styles.note}>{vi ? "Chưa thiết lập kết nối ký cho phòng khám. " : "Signing is not configured for this clinic. "}<a href="/settings?section=providers#documenso">{vi ? "Thiết lập Documenso" : "Set up Documenso"}</a></p>}
          {request?.errorCode === "documenso-recipient-changed" && <p className={styles.error} role="alert">{vi ? "Thông tin bệnh nhân đã thay đổi so với người nhận của phiên ký bên dưới. Kiểm tra và xử lý phiên ký cũ trong Documenso trước khi gửi lại." : "The patient details differ from this signing request’s recipient below. Review and resolve the old request in Documenso before sending again."}</p>}
          {signedFile && <a href={signedFile} target="_blank" rel="noopener noreferrer">{vi ? "Mở bản PDF đã ký" : "Open the signed PDF"} ↗</a>}
          {!signed && !completed && <>
            <div className={styles.order}><strong>{vi ? "Người nhận ký" : "Signing recipient"}</strong><span>{workspace.recipient.name}</span><span>{workspace.recipient.email ?? (vi ? "Chưa có email. Cập nhật hồ sơ bệnh nhân trước khi gửi." : "No email. Update the patient record before sending.")}</span></div>
            <label className={styles.field} htmlFor={`${id}-source`}><span>{vi ? "Bản PDF cần ký" : "PDF to sign"}</span><select id={`${id}-source`} aria-label={vi ? "Bản PDF cần ký" : "PDF to sign"} value={source} disabled={disabled || !!request} onChange={event => { setSource(event.target.value); setConfirmed(false); setNotice(""); }}>
              <option value="">{vi ? "Chọn tài liệu trong hồ sơ bệnh nhân" : "Choose a document from the patient record"}</option>
              {workspace.sources.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}
            </select></label>
            {!workspace.sources.length && !request && <p className={styles.note}>{vi ? "Chưa có bản PDF đủ điều kiện. Tải tài liệu lên tại Hành trình điều trị rồi quay lại đây." : "No eligible PDF is available. Upload one in the patient Journey, then return here."}<br /><a href={`/journey?${new URLSearchParams({ patientId: workspace.patientId })}`}>{vi ? "Mở hồ sơ để tải tài liệu" : "Open the patient record to upload"}</a></p>}
            {!!source && <a href={`/patient-files/${encodeURIComponent(source)}`} target="_blank" rel="noopener noreferrer">{vi ? "Xem bản PDF trước khi gửi" : "Review the PDF before sending"} ↗</a>}
            {!sourceAttached && !!source && !request && <button className={styles.secondary} type="button" disabled={disabled} onClick={() => void update("attach-source")}>{vi ? "Gắn PDF vào biểu mẫu" : "Attach PDF to form"}</button>}
            {sourceAttached && (!request || request.canRetry) && <>
              <label><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)} /> {vi ? "Tôi đã kiểm tra bản PDF, người nhận và email ký." : "I checked the PDF, recipient and signing email."}</label>
              <button className={styles.primary} type="button" disabled={!canSend} onClick={() => void update("send")}>{request ? (vi ? "Tiếp tục cùng phiên ký" : "Resume this signing request") : (vi ? "Gửi yêu cầu ký" : "Send for signature")}</button>
            </>}
            {request && <p className={styles.note}>{failed
              ? (vi ? "Chưa gửi được tài liệu để ký. Kiểm tra kết nối trước khi thử lại; bạn vẫn có thể hoàn tất hoặc hủy biểu mẫu thủ công." : "The document was not sent for signature. Check the connection before retrying; manual completion or voiding remains available.")
              : (vi ? "Phiên ký đang giữ bản PDF này. Không hoàn tất thủ công hoặc đổi tài liệu trong lúc chờ kết quả." : "This PDF belongs to the signing request. Await its result before manually completing the form or replacing the document.")}</p>}
            {signingUrl && <a href={signingUrl} target="_blank" rel="noopener noreferrer">{vi ? "Mở trang ký của bệnh nhân" : "Open the patient’s signing page"} ↗</a>}
          </>}
        </>}
      </div>
    </WorkspaceDialog>
  </>;
}
