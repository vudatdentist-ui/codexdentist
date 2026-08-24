import Link from "next/link";
import { WorkspaceChrome } from "@/features/navigation/ui/WorkspaceChrome";
import { formatVnd } from "@/lib/data";
import type { AppSession } from "@/lib/session";
import type {
  StaffOperationsIssue,
  UnifiedEarningsPerson,
  UnifiedEarningsWorkspaceModel,
} from "@/features/earnings/server/get-unified-earnings";
import styles from "./operations-workspace.module.css";

export function OperationsWorkspace({
  model,
  session,
}: {
  model: UnifiedEarningsWorkspaceModel;
  session: AppSession;
}) {
  return (
    <WorkspaceChrome activeWorkspace="operations" session={session}>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Vận hành</h1>
            <span>{model.periodLabel}</span>
          </div>
          <Link className={styles.primaryAction} href="/staff">
            Điều hành nhân sự <span aria-hidden="true">→</span>
          </Link>
        </header>

        <nav aria-label="Vận hành" className={styles.subnav}>
          <span aria-current="page">Nhân sự</span>
          <Link href="/accounting">Tài chính</Link>
          <Link href="/inventory">Kho</Link>
          <Link href="/reports">Báo cáo</Link>
        </nav>

        {model.message && <p className={styles.notice}>{model.message}</p>}

        <div className={styles.statusLine} aria-label="Tình trạng nhân sự">
          <StatusFact label="Nhân sự" value={`${model.summary.staffCount}`} />
          <StatusFact label="Đang vào ca" value={`${model.summary.clockedInCount}`} />
          <StatusFact label="Nghỉ chờ duyệt" value={`${model.summary.pendingLeaveCount}`} />
          <StatusFact label="Thu nhập tạm tính" value={formatVnd(model.summary.estimatedGross)} />
          <StatusFact label="Hoa hồng giới thiệu" value={formatVnd(model.summary.referralTotal)} />
        </div>

        <IssueSection issues={model.issues} />

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>Thu nhập tháng này</h2>
              <span>Tạm tính từ ngày công + dịch vụ + giới thiệu</span>
            </div>
            <strong>{formatVnd(model.summary.estimatedNet)} thực nhận dự kiến</strong>
          </div>

          {model.people.length > 0 ? (
            <div className={styles.earningsTable} role="table" aria-label="Thu nhập nhân sự">
              <div className={`${styles.earningsRow} ${styles.tableHeader}`} role="row">
                <span role="columnheader">Nhân sự</span>
                <span role="columnheader">Ngày công</span>
                <span role="columnheader">Lương cứng</span>
                <span role="columnheader">Dịch vụ</span>
                <span role="columnheader">Giới thiệu</span>
                <span role="columnheader">Tổng</span>
                <span role="columnheader">Kỳ lương</span>
              </div>
              {model.people.map((person) => (
                <EarningsRow key={person.staffProfileId} person={person} />
              ))}
            </div>
          ) : (
            <p className={styles.empty}>Chưa có nhân sự trong phạm vi hiện tại.</p>
          )}
        </section>

        <div className={styles.twoColumn}>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Đang vào ca</h2>
                <span>{model.openAttendance.length}</span>
              </div>
            </div>
            {model.openAttendance.length > 0 ? (
              <div className={styles.compactRows}>
                {model.openAttendance.slice(0, 8).map((log) => (
                  <div className={styles.compactRow} key={log.id}>
                    <div>
                      <strong>{log.staffName}</strong>
                      <span>{log.clinicName}</span>
                    </div>
                    <span>{log.clockInAt}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>Không có log chấm công đang mở.</p>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Nghỉ chờ duyệt</h2>
                <span>{model.pendingLeave.length}</span>
              </div>
            </div>
            {model.pendingLeave.length > 0 ? (
              <div className={styles.compactRows}>
                {model.pendingLeave.slice(0, 8).map((leave) => (
                  <div className={styles.compactRow} key={leave.id}>
                    <div>
                      <strong>{leave.staffName}</strong>
                      <span>{leave.leaveType}</span>
                    </div>
                    <span>{leave.startsAt} → {leave.endsAt}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>Không có đơn nghỉ đang chờ.</p>
            )}
          </section>
        </div>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>Kỳ lương gần đây</h2>
              <span>Thu nhập tạm tính và bảng lương đã duyệt là hai trạng thái khác nhau</span>
            </div>
            <Link href="/staff">Mở bảng lương</Link>
          </div>
          {model.recentPayrollRuns.length > 0 ? (
            <div className={styles.payrollRows}>
              {model.recentPayrollRuns.slice(0, 8).map((run) => (
                <div className={styles.payrollRow} key={run.id}>
                  <Status status={run.status} />
                  <div>
                    <strong>{run.clinicName ?? "Toàn hệ thống"}</strong>
                    <span>{run.period} · {run.lineCount} nhân sự</span>
                  </div>
                  <span>{formatVnd(run.grossAmount)}</span>
                  <strong>{formatVnd(run.netAmount)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>Chưa có bảng lương.</p>
          )}
        </section>
      </div>
    </WorkspaceChrome>
  );
}

function StatusFact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statusFact}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function IssueSection({ issues }: { issues: StaffOperationsIssue[] }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Cần xử lý</h2>
          <span>{issues.length}</span>
        </div>
        <Link href="/work">Mở Công việc</Link>
      </div>
      {issues.length > 0 ? (
        <div className={styles.issueRows}>
          {issues.slice(0, 10).map((issue) => (
            <article className={styles.issueRow} key={issue.id}>
              <span className={`${styles.priority} ${styles[issue.priority]}`} />
              <div>
                <strong>{issue.title}</strong>
                <span>{issue.detail}</span>
              </div>
              <span>{issue.clinicName ?? "Toàn hệ thống"}</span>
              <Link href={issue.href}>Xử lý →</Link>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>Không có việc nhân sự cần xử lý.</p>
      )}
    </section>
  );
}

function EarningsRow({ person }: { person: UnifiedEarningsPerson }) {
  return (
    <div className={styles.earningsRow} role="row">
      <div className={styles.person} role="cell">
        <strong>{person.fullName}</strong>
        <span>{person.employeeCode} · {person.clinicName ?? "Toàn hệ thống"}</span>
      </div>
      <span role="cell">{person.workedDays}/{person.standardWorkdays}</span>
      <span role="cell">{formatVnd(person.baseEstimated)}</span>
      <span role="cell">{formatVnd(person.serviceTotal)}</span>
      <span role="cell">{formatVnd(person.referralTotal)}</span>
      <strong role="cell">{formatVnd(person.grossEstimated)}</strong>
      <Status status={person.payrollStatus} />
    </div>
  );
}

function Status({ status }: { status: string }) {
  const labels: Record<string, string> = {
    NONE: "Chưa tạo",
    DRAFT: "Nháp",
    APPROVED: "Đã duyệt",
    PAID: "Đã trả",
    VOID: "Đã hủy",
  };
  return <span className={`${styles.status} ${styles[`status${status}`] ?? ""}`}>{labels[status] ?? status}</span>;
}
