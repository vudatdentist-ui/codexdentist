"use client";

import { useMemo, useState } from "react";
import { createJourneyCommentAction } from "@/features/patient-360/server/journey-actions";
import {
  createPatientFileAction,
  updatePatientFileGovernanceAction,
} from "@/features/patient-360/server/patient-file-actions";
import { formatVnd, type Patient } from "@/lib/data";
import type { Patient360WorkspaceModel } from "./get-patient-360-workspace";
import native from "./patient-360-native.module.css";

type TimelineGroup = "ALL" | "SESSION" | "CLINICAL" | "TREATMENT" | "BILLING" | "FILES" | "CARE";

type TimelineEvent = {
  id: string;
  group: Exclude<TimelineGroup, "ALL">;
  title: string;
  detail: string;
  timestamp: string;
  timestampIso?: string | null;
  status?: string | null;
  fileUrl?: string | null;
};

const filters: Array<[TimelineGroup, string]> = [
  ["ALL", "Tất cả"],
  ["SESSION", "Lịch hẹn"],
  ["CLINICAL", "Lâm sàng"],
  ["TREATMENT", "Điều trị"],
  ["BILLING", "Tài chính"],
  ["FILES", "Tài liệu"],
  ["CARE", "Chăm sóc"],
];

export function PatientTimelineSection({
  model,
  patient,
}: {
  model: Patient360WorkspaceModel;
  patient: Patient;
}) {
  const [filter, setFilter] = useState<TimelineGroup>("ALL");
  const [fileOpen, setFileOpen] = useState(false);
  const canComment = Boolean(model.journeyRecordsWorkspace?.canMutate);
  const canFiles = Boolean(model.patientFilesWorkspace?.canMutate);
  const files = model.patientFilesWorkspace?.files.filter((file) => file.patientId === patient.id) ?? [];

  const events = useMemo<TimelineEvent[]>(() => {
    const appointments = model.scheduleWorkspace?.appointments
      .filter((appointment) => appointment.patientId === patient.id)
      .map((appointment) => ({
        id: `appointment-${appointment.id}`,
        group: "SESSION" as const,
        title: appointment.procedure,
        detail: `${appointment.provider} · ${appointment.room} · ${appointment.duration} phút`,
        timestamp: appointment.time,
        timestampIso: appointment.startsAt ?? null,
        status: appointment.status,
      })) ?? [];

    const clinical = model.clinicalWorkspace?.notes
      .filter((note) => note.patientId === patient.id && note.lockedAt)
      .map((note) => ({
        id: `clinical-${note.id}`,
        group: "CLINICAL" as const,
        title: note.assessment ?? note.prognosis ?? note.subjective ?? "Ghi chú lâm sàng",
        detail: [note.subjective, note.objective, note.prognosis, note.plan].filter(Boolean).join(" · "),
        timestamp: note.createdAt,
        timestampIso: note.createdAtIso,
        status: "Hoàn tất",
      })) ?? [];

    const plans = model.treatmentWorkspace?.plans
      .filter((plan) => plan.patientId === patient.id)
      .map((plan) => ({
        id: `plan-${plan.id}`,
        group: "TREATMENT" as const,
        title: plan.title,
        detail: `${plan.phase} · ${formatVnd(plan.patientShare)}`,
        timestamp: plan.createdAt ?? "",
        timestampIso: plan.createdAt ?? null,
        status: plan.status,
      })) ?? [];

    const progress = model.servicesWorkspace?.treatmentServices
      .filter((service) => service.patientId === patient.id)
      .flatMap((service) => service.progressEvents.map((event) => ({
        id: `progress-${event.id}`,
        group: "TREATMENT" as const,
        title: `${service.serviceCode} · ${service.serviceName}`,
        detail: [
          `${Math.round(event.fromProgressPercent)}% → ${Math.round(event.toProgressPercent)}%`,
          event.performedByName,
          event.note,
        ].filter(Boolean).join(" · "),
        timestamp: event.occurredAt,
        timestampIso: event.occurredAtIso,
        status: `${Math.round(event.toProgressPercent)}%`,
      }))) ?? [];

    const invoices = model.billingWorkspace?.invoices
      .filter((invoice) => invoice.patientId === patient.id)
      .map((invoice) => ({
        id: `invoice-${invoice.id}`,
        group: "BILLING" as const,
        title: `Hóa đơn ${invoice.id}`,
        detail: `${formatVnd(invoice.paidAmount ?? 0)} / ${formatVnd(invoice.amount)} · hạn ${invoice.due}`,
        timestamp: invoice.due,
        timestampIso: invoice.issuedAtMs ? new Date(invoice.issuedAtMs).toISOString() : null,
        status: invoice.status,
      })) ?? [];

    const receipts = model.billingWorkspace?.receipts
      .filter((receipt) => receipt.patientId === patient.id)
      .map((receipt) => ({
        id: `receipt-${receipt.id}`,
        group: "BILLING" as const,
        title: `Phiếu thu ${receipt.receiptNo}`,
        detail: `${formatVnd(receipt.amount)} · ${receipt.method}${receipt.reference ? ` · ${receipt.reference}` : ""}`,
        timestamp: receipt.receivedAt,
        timestampIso: receipt.receivedAtIso,
        status: receipt.unallocatedAmount > 0 ? "Còn tiền dư" : "Đã phân bổ",
      })) ?? [];

    const prescriptions = model.pharmacyWorkspace?.prescriptions
      .filter((prescription) => prescription.patientId === patient.id)
      .map((prescription) => ({
        id: `prescription-${prescription.id}`,
        group: "CLINICAL" as const,
        title: `Đơn thuốc ${prescription.prescriptionNo}`,
        detail: prescription.items.map((item) => `${item.drugName}: ${item.sig}`).join(" · ") || prescription.diagnosis || "Đơn thuốc",
        timestamp: prescription.createdAt,
        timestampIso: prescription.createdAtIso,
        status: prescription.status,
      })) ?? [];

    const patientForms = model.formsWorkspace?.patientForms
      .filter((form) => form.patientId === patient.id)
      .map((form) => ({
        id: `form-${form.id}`,
        group: "FILES" as const,
        title: `${form.formNo} · ${form.templateName}`,
        detail: form.responseText ?? `${form.templateType} · v${form.templateVersion}`,
        timestamp: form.completedAt ?? form.sentAt ?? form.createdAt,
        timestampIso: form.completedAtIso ?? form.sentAtIso ?? form.createdAtIso,
        status: form.status,
      })) ?? [];

    const patientFiles = files
      .filter((file) => file.category !== "TIMELINE_COMMENT")
      .map((file) => ({
        id: `file-${file.id}`,
        group: "FILES" as const,
        title: file.title,
        detail: [file.category, file.fileName, file.notes].filter(Boolean).join(" · "),
        timestamp: file.createdAt,
        timestampIso: file.createdAtIso,
        status: file.virusScanStatus,
        fileUrl: file.url,
      }));

    const care = model.crmWorkspace?.activities
      .filter((activity) => activity.patientId === patient.id)
      .map((activity) => ({
        id: `care-${activity.id}`,
        group: "CARE" as const,
        title: activity.subject,
        detail: [activity.type, activity.channel, activity.body].filter(Boolean).join(" · "),
        timestamp: activity.completedAt ?? activity.createdAt,
        timestampIso: activity.completedAtIso ?? activity.createdAtIso,
        status: activity.completedAt ? "Hoàn tất" : "Đang mở",
      })) ?? [];

    const comments = model.journeyRecordsWorkspace?.comments
      .filter((comment) => comment.patientId === patient.id)
      .map((comment) => ({
        id: `comment-${comment.id}`,
        group: comment.attachments.length > 0 ? ("FILES" as const) : ("CLINICAL" as const),
        title: comment.body,
        detail: `${comment.authorName}${comment.attachments.length > 0 ? ` · ${comment.attachments.map((attachment) => attachment.name).filter(Boolean).join(", ")}` : ""}`,
        timestamp: comment.createdAt,
        timestampIso: comment.createdAtIso,
        status: "Ghi chú",
        fileUrl: comment.attachments[0]?.url ?? comment.attachmentUrl,
      })) ?? [];

    return [
      ...appointments,
      ...clinical,
      ...plans,
      ...progress,
      ...invoices,
      ...receipts,
      ...prescriptions,
      ...patientForms,
      ...patientFiles,
      ...care,
      ...comments,
    ].sort((left, right) => eventTime(right) - eventTime(left));
  }, [files, model, patient.id]);

  const visibleEvents = filter === "ALL" ? events : events.filter((event) => event.group === filter);

  return (
    <section className={native.card} id="patient-timeline">
      <header className={native.cardHeader}>
        <div>
          <h2>Timeline bệnh án</h2>
          <p>Timeline được dẫn xuất từ lịch hẹn, lâm sàng, điều trị, thu chi, tài liệu và chăm sóc — không tạo bản sao dữ liệu.</p>
        </div>
        <span className={native.badge}>{events.length} sự kiện</span>
      </header>

      <div className={native.filterRow} role="group" aria-label="Lọc timeline">
        {filters.map(([value, label]) => (
          <button data-active={filter === value} key={value} onClick={() => setFilter(value)} type="button">{label}</button>
        ))}
      </div>

      {visibleEvents.length > 0 ? (
        <div className={native.timelineList}>
          {visibleEvents.map((event) => (
            <article className={native.timelineEvent} key={event.id}>
              <div className={native.timelineHeader}>
                <div>
                  <span className={native.meta}>{groupLabel(event.group)} · {event.timestamp || "Không rõ thời gian"}</span>
                  <strong style={{ display: "block", marginTop: 4 }}>{event.title}</strong>
                </div>
                {event.status ? <span className={native.badge}>{event.status}</span> : null}
              </div>
              {event.detail ? <p>{event.detail}</p> : null}
              {event.fileUrl ? <a href={event.fileUrl} target="_blank" rel="noreferrer">Mở tài liệu</a> : null}
            </article>
          ))}
        </div>
      ) : (
        <p className={native.empty}>Không có sự kiện trong bộ lọc này.</p>
      )}

      <div className={native.gridTwo} style={{ marginTop: 18 }}>
        <form action={createJourneyCommentAction} className={native.card}>
          <header className={native.cardHeader}><div><h3>Ghi chú nội bộ</h3><p>Đính kèm được lưu như Patient File bảo vệ.</p></div></header>
          <input name="patientId" type="hidden" value={patient.id} />
          <label className={native.field}>Nội dung<textarea name="body" disabled={!canComment} /></label>
          <label className={native.field} style={{ marginTop: 10 }}>Tệp đính kèm<input name="file" type="file" multiple disabled={!canComment} /></label>
          <div className={native.actions}><button className={native.button} disabled={!canComment} type="submit">Thêm vào timeline</button></div>
        </form>

        <section className={native.card}>
          <header className={native.cardHeader}><div><h3>Tài liệu bệnh nhân</h3><p>{files.length} tài liệu trong phạm vi được phép xem.</p></div><button className={native.buttonSecondary} disabled={!canFiles} onClick={() => setFileOpen((value) => !value)} type="button">{fileOpen ? "Đóng" : "Thêm tài liệu"}</button></header>
          {fileOpen ? (
            <form action={createPatientFileAction} className={native.formGrid}>
              <input name="patientId" type="hidden" value={patient.id} />
              <label>Tiêu đề<input name="title" required /></label>
              <label>Loại<select name="category" defaultValue="CLINICAL_IMAGE"><option value="CLINICAL_IMAGE">Ảnh lâm sàng</option><option value="RADIOGRAPH">X-quang</option><option value="DOCUMENT">Tài liệu</option><option value="LAB_RESULT">Kết quả labo</option></select></label>
              <label className={native.wide}>Tải file<input name="file" type="file" /></label>
              <label className={native.wide}>Hoặc URL ngoài<input name="url" type="url" /></label>
              <label className={native.wide}>Ghi chú<textarea name="notes" /></label>
              <div className={`${native.actions} ${native.wide}`}><button className={native.button} disabled={!canFiles} type="submit">Lưu tài liệu</button></div>
            </form>
          ) : null}

          {files.slice(0, 5).map((file) => (
            <details className={native.note} key={file.id} style={{ marginTop: 8 }}>
              <summary><strong>{file.title}</strong> · <span className={native.meta}>{file.virusScanStatus}</span></summary>
              <p>{[file.fileName, file.category, file.notes].filter(Boolean).join(" · ")}</p>
              <a href={file.url} target="_blank" rel="noreferrer">Mở tài liệu</a>
              <form action={updatePatientFileGovernanceAction} className={native.formGrid} style={{ marginTop: 10 }}>
                <input name="fileId" type="hidden" value={file.id} />
                <label>Trạng thái quét<select name="virusScanStatus" defaultValue={file.virusScanStatus} disabled={!canFiles}>{["NOT_SCANNED", "PENDING", "CLEAN", "QUARANTINED", "INFECTED", "EXTERNAL_URL"].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
                <label>Lưu đến<input name="retentionUntil" type="date" defaultValue={file.retentionUntilIso ?? ""} disabled={!canFiles} /></label>
                <div className={`${native.actions} ${native.wide}`}><button className={native.buttonSecondary} disabled={!canFiles} type="submit">Lưu kiểm soát</button></div>
              </form>
            </details>
          ))}
        </section>
      </div>
    </section>
  );
}

function eventTime(event: Pick<TimelineEvent, "timestamp" | "timestampIso">) {
  const parsed = Date.parse(event.timestampIso ?? event.timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function groupLabel(group: TimelineEvent["group"]) {
  return {
    SESSION: "Lịch hẹn",
    CLINICAL: "Lâm sàng",
    TREATMENT: "Điều trị",
    BILLING: "Tài chính",
    FILES: "Tài liệu",
    CARE: "Chăm sóc",
  }[group];
}
