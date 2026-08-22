import Link from "next/link";
import {
  completeWorkItemAction,
  createWorkItemAction,
  retryFailedNotificationAction,
} from "@/app/(app)/dashboard/actions";
import { WorkspaceChrome } from "@/components/workspace/WorkspaceChrome";
import type { AppSession } from "@/lib/session";
import type {
  TaskInboxItemSummary,
  TaskInboxPriority,
  TaskInboxWorkspace,
} from "@/lib/task-inbox-types";
import styles from "./work-workspace.module.css";

export function WorkWorkspace({
  session,
  workspace,
}: {
  session: AppSession;
  workspace: TaskInboxWorkspace;
}) {
  const items = workspace.items.filter((item) => item.kind !== "learning");
  const urgent = items.filter((item) => item.priority === "high");
  const today = items.filter((item) => item.priority === "medium");
  const later = items.filter((item) => item.priority === "low");

  return (
    <WorkspaceChrome activeWorkspace="work" session={session}>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Công việc</h1>
            <span>{items.length}</span>
          </div>
          {workspace.canMutate && <CreateWorkItem workspace={workspace} />}
        </header>

        {workspace.message && <p className={styles.notice}>{workspace.message}</p>}

        <WorkGroup items={urgent} title="Cần ngay" />
        <WorkGroup items={today} title="Hôm nay" />
        <WorkGroup items={later} title="Sau" />
      </div>
    </WorkspaceChrome>
  );
}

function WorkGroup({
  items,
  title,
}: {
  items: TaskInboxItemSummary[];
  title: string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <h2>{title}</h2>
        <span>{items.length}</span>
      </div>
      <div className={styles.rows}>
        {items.map((item) => (
          <WorkRow item={item} key={item.id} />
        ))}
      </div>
    </section>
  );
}

function WorkRow({ item }: { item: TaskInboxItemSummary }) {
  const isManualWorkItem = item.id.startsWith("work-") && Boolean(item.sourceId);
  const canRetryNotification =
    item.kind === "notification" && item.status === "FAILED" && Boolean(item.sourceId);
  const href = item.actionUrl ?? item.href;
  const safeHref = href === "/dashboard" ? "/work" : href;
  const meta = [item.patientName, item.clinicName, item.dueAt, item.assignedToName]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className={styles.row}>
      <span
        aria-label={`Ưu tiên ${item.priority}`}
        className={`${styles.priority} ${styles[item.priority]}`}
      />
      <div className={styles.rowBody}>
        <strong>{item.title}</strong>
        <span>{item.detail}</span>
      </div>
      <span className={styles.meta}>{meta}</span>
      <div className={styles.rowActions}>
        {canRetryNotification && item.sourceId ? (
          <form action={retryFailedNotificationAction}>
            <input name="notificationId" type="hidden" value={item.sourceId} />
            <input name="redirectTo" type="hidden" value="/work" />
            <button type="submit">Thử lại →</button>
          </form>
        ) : isManualWorkItem && item.sourceId ? (
          <form action={completeWorkItemAction}>
            <input name="workItemId" type="hidden" value={item.sourceId} />
            <input name="redirectTo" type="hidden" value="/work" />
            <button type="submit">Hoàn tất</button>
          </form>
        ) : (
          <Link href={safeHref}>{actionLabel(item)} →</Link>
        )}
      </div>
    </article>
  );
}

function CreateWorkItem({ workspace }: { workspace: TaskInboxWorkspace }) {
  return (
    <details className={styles.createWork}>
      <summary>Tạo công việc</summary>
      <div className={styles.createPopover}>
        <form action={createWorkItemAction}>
          <input name="redirectTo" type="hidden" value="/work" />
          <label>
            <span>Tiêu đề</span>
            <input autoComplete="off" name="title" required />
          </label>
          <label>
            <span>Ghi chú</span>
            <textarea name="detail" rows={3} />
          </label>
          <div className={styles.formGrid}>
            <label>
              <span>Ưu tiên</span>
              <select defaultValue="medium" name="priority">
                <option value="high">Cao</option>
                <option value="medium">Bình thường</option>
                <option value="low">Thấp</option>
              </select>
            </label>
            <label>
              <span>Hạn</span>
              <input name="dueAt" type="date" />
            </label>
          </div>
          <details className={styles.contextFields}>
            <summary>Thêm ngữ cảnh</summary>
            <div className={styles.formGrid}>
              <label>
                <span>Phòng khám</span>
                <select defaultValue="" name="clinicId">
                  <option value="">Theo phạm vi hiện tại</option>
                  {workspace.clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Người phụ trách</span>
                <select defaultValue="" name="assignedToId">
                  <option value="">Chưa giao</option>
                  {workspace.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>Bệnh nhân</span>
              <select defaultValue="" name="patientId">
                <option value="">Không gắn bệnh nhân</option>
                {workspace.patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.name} · {patient.phone}
                  </option>
                ))}
              </select>
            </label>
          </details>
          <button className={styles.submit} type="submit">
            Tạo
          </button>
        </form>
      </div>
    </details>
  );
}

function actionLabel(item: TaskInboxItemSummary) {
  switch (item.kind) {
    case "crm":
      return "Liên hệ";
    case "billing":
      return "Xem";
    case "inventory":
      return "Xử lý";
    case "hr":
      return "Xem";
    case "schedule":
      return "Mở lịch";
    default:
      return "Mở";
  }
}

export function workPriorityLabel(priority: TaskInboxPriority) {
  if (priority === "high") return "Cao";
  if (priority === "low") return "Thấp";
  return "Bình thường";
}
