import Link from "next/link";
import {
  cancelPatientAccessAppointmentAction,
  createPatientAccessAppointmentAction,
  transitionPatientAccessAppointmentAction,
} from "@/features/patient-access/server/actions";
import type {
  PatientAccessAppointmentRow,
  PatientAccessModel,
  PatientAccessStatus,
} from "@/features/patient-access/server/get-patient-access";
import { WorkspaceChrome } from "@/features/navigation/ui/WorkspaceChrome";
import type { AppSession } from "@/lib/session";
import styles from "./schedule-workspace.module.css";

export function ScheduleWorkspace({
  model,
  notice,
  session,
}: {
  model: PatientAccessModel;
  notice: string | null;
  session: AppSession;
}) {
  return (
    <WorkspaceChrome activeWorkspace="schedule" contextLabel={model.dateLabel} session={session}>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1>Lịch hẹn</h1>
            <span>{model.dateLabel}</span>
          </div>
          <div className={styles.headerActions}>
            <form className={styles.dateForm} method="get">
              <input aria-label="Ngày làm việc" defaultValue={model.date} name="date" type="date" />
              <button type="submit">Mở ngày</button>
            </form>
            <details className={styles.createDetails}>
              <summary>Tạo lịch hẹn</summary>
              <CreateAppointmentForm model={model} />
            </details>
          </div>
        </header>

        {(notice || model.exceptions.length > 0) && (
          <section className={styles.attention} aria-label="Cần chú ý">
            {notice ? <p className={styles.notice}>{noticeText(notice)}</p> : null}
            {model.exceptions.map((issue) => (
              <a className={styles.issue} href={`#appointment-${issue.appointmentId}`} key={`${issue.kind}-${issue.appointmentId}`}>
                <strong>{issue.label}</strong>
                <span>{issue.detail}</span>
              </a>
            ))}
          </section>
        )}

        <div className={styles.factLine} aria-label="Trạng thái ngày">
          <Fact label="Cần xác nhận" value={model.confirmation.length} />
          <Fact label="Đang vận hành" value={model.activeFlow.length} />
          <Fact label="Đã kết thúc" value={model.completed.length} />
          <Link href="/work">Công việc →</Link>
          <Link href="/care">Chăm sóc →</Link>
        </div>

        <AppointmentSection
          empty="Không có lịch cần xác nhận."
          model={model}
          rows={model.confirmation}
          title="Cần xác nhận"
        />
        <AppointmentSection
          empty="Không có bệnh nhân trong luồng vận hành."
          model={model}
          rows={model.activeFlow}
          title="Luồng trong ngày"
        />

        <details className={styles.history} open={model.activeFlow.length === 0 && model.confirmation.length === 0}>
          <summary>Đã kết thúc · {model.completed.length}</summary>
          <AppointmentRows model={model} rows={model.completed} />
        </details>

        <footer className={styles.footer}>
          <Link href="/schedule/legacy">Điều phối tài nguyên nâng cao</Link>
          <span>Ghế và trạng thái bác sĩ vẫn được giữ trong compatibility surface trong giai đoạn migration.</span>
        </footer>
      </main>
    </WorkspaceChrome>
  );
}

function AppointmentSection({
  empty,
  model,
  rows,
  title,
}: {
  empty: string;
  model: PatientAccessModel;
  rows: PatientAccessAppointmentRow[];
  title: string;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h2>{title}</h2>
        <span>{rows.length}</span>
      </header>
      {rows.length ? <AppointmentRows model={model} rows={rows} /> : <p className={styles.empty}>{empty}</p>}
    </section>
  );
}

function AppointmentRows({ model, rows }: { model: PatientAccessModel; rows: PatientAccessAppointmentRow[] }) {
  return (
    <div className={styles.rows} role="table" aria-label="Lịch hẹn">
      {rows.map((row) => (
        <article className={styles.row} id={`appointment-${row.id}`} key={row.id}>
          <div className={styles.time}>
            <strong>{row.timeLabel}</strong>
            <span>{statusLabel(row.status)}</span>
          </div>
          <div className={styles.patient}>
            <Link href={`/patients/${encodeURIComponent(row.patientId)}`}>{row.patientName}</Link>
            <span>{[row.patientPhone, row.reason].filter(Boolean).join(" · ")}</span>
          </div>
          <div className={styles.assignment}>
            <strong>{row.providerName}</strong>
            <span>{row.chairName ?? "Chưa vào ghế"} · {row.clinicName}</span>
          </div>
          <div className={styles.actions}>
            <AppointmentActions model={model} row={row} />
          </div>
        </article>
      ))}
    </div>
  );
}

function AppointmentActions({ model, row }: { model: PatientAccessModel; row: PatientAccessAppointmentRow }) {
  if (!model.canUpdate) return <Link href={`/patients/${encodeURIComponent(row.patientId)}`}>Mở hồ sơ →</Link>;

  return (
    <>
      {row.status === "REQUESTED" && <TransitionButton date={model.date} row={row} status="CONFIRMED">Xác nhận</TransitionButton>}
      {row.status === "CONFIRMED" && (
        <>
          <TransitionButton date={model.date} row={row} status="ARRIVED">Đã đến</TransitionButton>
          <TransitionButton date={model.date} row={row} status="NO_SHOW" tone="quiet">No-show</TransitionButton>
        </>
      )}
      {row.status === "ARRIVED" && (
        <form action={transitionPatientAccessAppointmentAction} className={styles.chairAction}>
          <input name="appointmentId" type="hidden" value={row.id} />
          <input name="date" type="hidden" value={model.date} />
          <input name="status" type="hidden" value="IN_CHAIR" />
          <select aria-label={`Ghế cho ${row.patientName}`} defaultValue={row.chairId ?? ""} name="chairId" required>
            <option value="">Chọn ghế</option>
            {model.chairs
              .filter((chair) => chair.clinicId === row.clinicId)
              .map((chair) => (
                <option disabled={chair.operationalStatus === "BUSY" && chair.id !== row.chairId} key={chair.id} value={chair.id}>
                  {chair.name}{chair.operationalStatus === "BUSY" ? " · bận" : ""}
                </option>
              ))}
          </select>
          <button type="submit">Vào ghế</button>
        </form>
      )}
      {row.status === "IN_CHAIR" && <TransitionButton date={model.date} row={row} status="COMPLETED">Hoàn tất</TransitionButton>}
      {["COMPLETED", "NO_SHOW", "CANCELLED"].includes(row.status) && (
        <Link href={`/patients/${encodeURIComponent(row.patientId)}`}>Patient 360 →</Link>
      )}
      {model.canCancel && ["REQUESTED", "CONFIRMED", "ARRIVED"].includes(row.status) && (
        <form action={cancelPatientAccessAppointmentAction}>
          <input name="appointmentId" type="hidden" value={row.id} />
          <input name="date" type="hidden" value={model.date} />
          <button className={styles.quietButton} type="submit">Hủy</button>
        </form>
      )}
    </>
  );
}

function TransitionButton({
  children,
  date,
  row,
  status,
  tone,
}: {
  children: React.ReactNode;
  date: string;
  row: PatientAccessAppointmentRow;
  status: PatientAccessStatus;
  tone?: "quiet";
}) {
  return (
    <form action={transitionPatientAccessAppointmentAction}>
      <input name="appointmentId" type="hidden" value={row.id} />
      <input name="date" type="hidden" value={date} />
      <input name="status" type="hidden" value={status} />
      <button className={tone === "quiet" ? styles.quietButton : undefined} type="submit">{children}</button>
    </form>
  );
}

function CreateAppointmentForm({ model }: { model: PatientAccessModel }) {
  return (
    <form action={createPatientAccessAppointmentAction} className={styles.createForm}>
      <input name="date" type="hidden" value={model.date} />
      <label>
        Phòng khám
        <select name="clinicId" required>
          {model.clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
        </select>
      </label>
      <label>
        Bệnh nhân
        <select name="patientId" required>
          <option value="">Chọn bệnh nhân</option>
          {model.patients.map((patient) => (
            <option key={patient.id} value={patient.id}>{patient.name}{patient.phone ? ` · ${patient.phone}` : ""}</option>
          ))}
        </select>
      </label>
      <label>
        Bác sĩ
        <select name="providerId" required>
          <option value="">Chọn bác sĩ</option>
          {model.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
        </select>
      </label>
      <label>
        Ghế
        <select name="chairId">
          <option value="">Chưa gán</option>
          {model.chairs.map((chair) => <option key={chair.id} value={chair.id}>{chair.name}</option>)}
        </select>
      </label>
      <label>
        Bắt đầu
        <input name="startTime" required type="time" />
      </label>
      <label>
        Phút
        <input defaultValue="30" max="240" min="15" name="duration" required step="5" type="number" />
      </label>
      <label className={styles.reasonField}>
        Lý do khám
        <input name="reason" required type="text" />
      </label>
      <button disabled={!model.canCreate} type="submit">Tạo lịch</button>
    </form>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return <span><strong>{value}</strong>{label}</span>;
}

function statusLabel(status: PatientAccessStatus) {
  const labels: Record<PatientAccessStatus, string> = {
    REQUESTED: "Cần xác nhận",
    CONFIRMED: "Đã xác nhận",
    ARRIVED: "Đã đến",
    IN_CHAIR: "Đang trên ghế",
    COMPLETED: "Hoàn tất",
    CANCELLED: "Đã hủy",
    NO_SHOW: "No-show",
  };
  return labels[status];
}

function noticeText(notice: string) {
  const labels: Record<string, string> = {
    created: "Đã tạo lịch hẹn.",
    updated: "Đã cập nhật trạng thái.",
    cancelled: "Đã hủy lịch hẹn.",
    denied: "Tài khoản này không có quyền thực hiện thao tác.",
    conflict: "Bác sĩ hoặc ghế đã có lịch trong khung giờ này.",
    "clinic-denied": "Phòng khám nằm ngoài phạm vi được phép.",
    "clinic-inactive": "Phòng khám không hoạt động.",
    "invalid-relation": "Bệnh nhân, bác sĩ hoặc ghế không thuộc cùng phạm vi.",
    "invalid-transition": "Không thể chuyển ngược hoặc mở lại trạng thái lịch hẹn này.",
    "past-appointment-locked": "Lịch hẹn ngày trước đã được khóa thay đổi.",
    "missing-chair": "Chọn ghế trước khi đưa bệnh nhân vào ghế.",
    "invalid-chair": "Ghế không thuộc phòng khám này.",
    "chair-busy": "Ghế đang có bệnh nhân khác.",
    "database-unavailable": "Chưa lưu được thay đổi.",
  };
  return labels[notice] ?? notice;
}
