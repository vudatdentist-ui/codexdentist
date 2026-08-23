import Link from "next/link";
import {
  completeCareActivityAction,
  recordNoShowRecoveryAction,
} from "@/features/patient-access/server/actions";
import type { CareOperationsModel } from "@/features/patient-access/server/get-care-operations";
import { WorkspaceChrome } from "@/features/navigation/ui/WorkspaceChrome";
import type { AppSession } from "@/lib/session";
import styles from "./care-workspace.module.css";

export function CareWorkspace({
  model,
  notice,
  selectedAppointmentId,
  session,
}: {
  model: CareOperationsModel;
  notice: string | null;
  selectedAppointmentId?: string | null;
  session: AppSession;
}) {
  const unresolvedNoShows = model.noShows.filter((item) => !item.resolved);

  return (
    <WorkspaceChrome activeWorkspace="care" contextLabel="Theo dõi bệnh nhân" session={session}>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1>Chăm sóc</h1>
            <span>No-show, follow-up và lead cần xử lý</span>
          </div>
          <div className={styles.headerActions}>
            <Link href="/schedule">Lịch hẹn</Link>
            <Link className={styles.primaryAction} href="/crm">CRM đầy đủ →</Link>
          </div>
        </header>

        {(notice || model.message) && <p className={styles.notice}>{careNotice(notice) ?? model.message}</p>}

        <div className={styles.factLine}>
          <Fact label="No-show chưa xử lý" value={unresolvedNoShows.length} />
          <Fact label="Follow-up đang mở" value={model.openActivities.length} />
          <Fact label="Lead" value={model.leads.length} />
          <Link href="/work">Công việc →</Link>
        </div>

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2>No-show cần phục hồi</h2>
            <span>{unresolvedNoShows.length}</span>
          </header>
          {unresolvedNoShows.length ? (
            <div className={styles.rows}>
              {unresolvedNoShows.map((item) => (
                <article
                  className={`${styles.row} ${selectedAppointmentId === item.appointmentId ? styles.selected : ""}`}
                  id={`no-show-${item.appointmentId}`}
                  key={item.appointmentId}
                >
                  <div className={styles.mainCell}>
                    <Link href={`/patients/${encodeURIComponent(item.patientId)}`}>{item.patientName}</Link>
                    <span>{[item.patientPhone, item.reason].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div className={styles.contextCell}>
                    <strong>{item.startsAtLabel}</strong>
                    <span>{item.providerName} · {item.clinicName}</span>
                  </div>
                  <form action={recordNoShowRecoveryAction} className={styles.recoveryForm}>
                    <input name="appointmentId" type="hidden" value={item.appointmentId} />
                    <select aria-label={`Kênh chăm sóc ${item.patientName}`} defaultValue="PHONE" name="channel">
                      <option value="PHONE">Điện thoại</option>
                      <option value="ZALO">Zalo</option>
                      <option value="SMS">SMS</option>
                      <option value="EMAIL">Email</option>
                      <option value="IN_APP">Trong app</option>
                    </select>
                    <input aria-label={`Kết quả chăm sóc ${item.patientName}`} name="note" placeholder="Kết quả / bước tiếp theo" type="text" />
                    <button disabled={!model.canMutate} type="submit">Ghi nhận đã liên hệ</button>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>Không có no-show chưa xử lý trong 14 ngày gần đây.</p>
          )}
        </section>

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2>Follow-up đang mở</h2>
            <span>{model.openActivities.length}</span>
          </header>
          {model.openActivities.length ? (
            <div className={styles.rows}>
              {model.openActivities.map((activity) => (
                <article className={styles.followUpRow} key={activity.id}>
                  <div className={styles.mainCell}>
                    {activity.patientId ? (
                      <Link href={`/patients/${encodeURIComponent(activity.patientId)}`}>{activity.patientName ?? "Bệnh nhân"}</Link>
                    ) : (
                      <strong>{activity.subject}</strong>
                    )}
                    <span>{activity.patientId ? activity.subject : [activity.type, activity.channel].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div className={styles.contextCell}>
                    <strong>{activity.dueAt ?? "Chưa đặt hạn"}</strong>
                    <span>{[activity.type, activity.channel].filter(Boolean).join(" · ")}</span>
                  </div>
                  <form action={completeCareActivityAction}>
                    <input name="activityId" type="hidden" value={activity.id} />
                    <button disabled={!model.canMutate} type="submit">Hoàn tất</button>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>Không có follow-up đang mở.</p>
          )}
        </section>

        <details className={styles.leads}>
          <summary>Lead gần đây · {model.leads.length}</summary>
          <div className={styles.leadRows}>
            {model.leads.slice(0, 30).map((lead) => (
              <div className={styles.leadRow} key={lead.id}>
                <div>
                  {lead.patientId ? <Link href={`/patients/${encodeURIComponent(lead.patientId)}`}>{lead.name}</Link> : <strong>{lead.name}</strong>}
                  <span>{lead.phone ?? "Chưa có SĐT"}</span>
                </div>
                <div>
                  <strong>{lead.status}</strong>
                  <span>{lead.nextFollowUpAt ?? ""}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      </main>
    </WorkspaceChrome>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return <span><strong>{value}</strong>{label}</span>;
}

function careNotice(notice: string | null) {
  if (!notice) return null;
  const labels: Record<string, string> = {
    "no-show-recovered": "Đã ghi nhận kết quả chăm sóc; Work signal tương ứng sẽ được gỡ.",
    "care-activity-completed": "Đã hoàn tất follow-up.",
    "no-show-not-found": "Không tìm thấy no-show trong phạm vi hiện tại.",
    "crm-denied": "Tài khoản này không có quyền cập nhật chăm sóc.",
    "crm-missing": "Thiếu dữ liệu bắt buộc.",
    "crm-database": "Chưa lưu được thay đổi.",
  };
  return labels[notice] ?? notice;
}
