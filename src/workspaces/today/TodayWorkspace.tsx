import Link from "next/link";
import { WorkspaceChrome } from "@/components/workspace/WorkspaceChrome";
import type { AppSession } from "@/lib/session";
import type {
  TodayAppointmentRow,
  TodayAttentionRow,
  TodayWorkspaceModel,
} from "./get-today-workspace";
import styles from "./today-workspace.module.css";

export function TodayWorkspace({
  model,
  session,
}: {
  model: TodayWorkspaceModel;
  session: AppSession;
}) {
  return (
    <WorkspaceChrome activeWorkspace="today" session={session}>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <h1>Hôm nay</h1>
          <time>{model.dateLabel}</time>
        </header>

        {model.message && <p className={styles.notice}>{model.message}</p>}

        <TodayAppointmentSection
          empty="Không có bệnh nhân đang chờ hoặc đang điều trị."
          rows={model.activeAppointments}
          title="Đang diễn ra"
        />

        <TodayAttentionSection rows={model.attention} />

        <TodayAppointmentSection
          empty="Không còn lịch hẹn sắp tới trong hôm nay."
          rows={model.upcoming}
          title="Tiếp theo"
        />
      </div>
    </WorkspaceChrome>
  );
}

function TodayAppointmentSection({
  empty,
  rows,
  title,
}: {
  empty: string;
  rows: TodayAppointmentRow[];
  title: string;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <h2>{title}</h2>
        <span>{rows.length}</span>
      </div>
      {rows.length > 0 ? (
        <div className={styles.rows}>
          {rows.map((row) => (
            <article className={styles.appointmentRow} key={row.id}>
              <time className={styles.time}>{row.time}</time>
              <div className={styles.rowBody}>
                <strong>{row.patientName}</strong>
                <span>{row.detail}</span>
              </div>
              <span className={styles.meta}>{row.meta}</span>
              <Link className={styles.action} href={row.href}>
                {row.actionLabel} <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>{empty}</p>
      )}
    </section>
  );
}

function TodayAttentionSection({ rows }: { rows: TodayAttentionRow[] }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <h2>Cần xử lý</h2>
        <Link href="/work">Xem tất cả</Link>
      </div>
      {rows.length > 0 ? (
        <div className={styles.rows}>
          {rows.map((row) => (
            <article className={styles.attentionRow} key={row.id}>
              <span
                aria-label={`Ưu tiên ${row.priority}`}
                className={`${styles.priority} ${styles[row.priority]}`}
              />
              <div className={styles.rowBody}>
                <strong>{row.title}</strong>
                <span>{row.detail}</span>
              </div>
              <span className={styles.meta}>{row.meta}</span>
              <Link className={styles.action} href={row.href}>
                {row.actionLabel} <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>Không có việc cần xử lý.</p>
      )}
    </section>
  );
}
