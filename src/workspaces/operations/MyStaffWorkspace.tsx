import { WorkspaceChrome } from "@/features/navigation/ui/WorkspaceChrome";
import type { UnifiedEarningsWorkspaceModel } from "@/features/earnings/server/get-unified-earnings";
import {
  clockInSelfAction,
  clockOutSelfAction,
  requestLeaveSelfAction,
} from "@/features/staff-self-service/server/actions";
import { formatVnd } from "@/lib/data";
import type { AppSession } from "@/lib/session";
import styles from "./my-staff-workspace.module.css";

export function MyStaffWorkspace({
  model,
  notice,
  session,
}: {
  model: UnifiedEarningsWorkspaceModel;
  notice: string | null;
  session: AppSession;
}) {
  const person = model.people.find((candidate) => candidate.userId === session.userId) ?? null;
  const openAttendance = model.openAttendance[0] ?? null;

  return (
    <WorkspaceChrome activeWorkspace="today" contextLabel="Hồ sơ của tôi" session={session}>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Hồ sơ của tôi</h1>
            <span>{model.periodLabel}</span>
          </div>
          {person && <span className={styles.employeeCode}>{person.employeeCode}</span>}
        </header>

        {(model.message || notice) && <p className={styles.notice}>{notice ?? model.message}</p>}

        {person ? (
          <>
            <section className={styles.identity}>
              <div>
                <strong>{person.fullName}</strong>
                <span>{person.clinicName ?? session.organizationName}</span>
              </div>
              <Status status={person.payrollStatus} />
            </section>

            <div className={styles.statusLine} aria-label="Thu nhập tạm tính">
              <Fact label="Tổng thu nhập" value={formatVnd(person.grossEstimated)} />
              <Fact label="Lương cứng" value={formatVnd(person.baseEstimated)} />
              <Fact label="Dịch vụ" value={formatVnd(person.serviceTotal)} />
              <Fact label="Giới thiệu" value={formatVnd(person.referralTotal)} />
              <Fact label="Thực nhận dự kiến" value={formatVnd(person.netEstimated)} />
            </div>

            <div className={styles.twoColumn}>
              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div>
                    <h2>Chấm công</h2>
                    <span>{person.workedDays}/{person.standardWorkdays} ngày công</span>
                  </div>
                  <Status status={openAttendance ? "OPEN" : "CLOSED"} />
                </div>

                {openAttendance ? (
                  <div className={styles.actionBlock}>
                    <div>
                      <strong>Đang trong ca</strong>
                      <span>{openAttendance.clockInAt} · {openAttendance.clinicName}</span>
                    </div>
                    <form action={clockOutSelfAction}>
                      <input name="outStatus" type="hidden" value="NORMAL" />
                      <button className={styles.primaryButton} type="submit">Ra ca</button>
                    </form>
                  </div>
                ) : (
                  <form action={clockInSelfAction} className={styles.actionBlock}>
                    <div>
                      <strong>Chưa vào ca</strong>
                      <span>{person.clinicName ?? session.organizationName}</span>
                    </div>
                    <button className={styles.primaryButton} type="submit">Vào ca</button>
                  </form>
                )}
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div>
                    <h2>Ca sắp tới</h2>
                    <span>{model.upcomingShifts.length}</span>
                  </div>
                </div>
                {model.upcomingShifts.length > 0 ? (
                  <div className={styles.compactRows}>
                    {model.upcomingShifts.slice(0, 6).map((shift) => (
                      <div className={styles.compactRow} key={shift.id}>
                        <div>
                          <strong>{shift.startsAt}</strong>
                          <span>{shift.clinicName}</span>
                        </div>
                        <span>{shift.status}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.empty}>Chưa có ca sắp tới.</p>
                )}
              </section>
            </div>

            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div>
                  <h2>Thu nhập phát sinh</h2>
                  <span>{person.events.length}</span>
                </div>
                <strong>{formatVnd(person.grossEstimated)}</strong>
              </div>
              {person.events.length > 0 ? (
                <div className={styles.earningRows}>
                  {person.events.slice(0, 24).map((event) => (
                    <div className={styles.earningRow} key={event.id}>
                      <Kind kind={event.kind} />
                      <div>
                        <strong>{event.title}</strong>
                        <span>{event.detail}</span>
                      </div>
                      <Status status={event.state} />
                      <strong>{formatVnd(event.amount)}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.empty}>Chưa có thu nhập phát sinh trong tháng.</p>
              )}
            </section>

            <div className={styles.twoColumn}>
              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div>
                    <h2>Nghỉ phép</h2>
                    <span>{model.pendingLeave.length} chờ duyệt</span>
                  </div>
                </div>
                {model.pendingLeave.length > 0 && (
                  <div className={styles.compactRows}>
                    {model.pendingLeave.slice(0, 5).map((leave) => (
                      <div className={styles.compactRow} key={leave.id}>
                        <div>
                          <strong>{leave.leaveType}</strong>
                          <span>{leave.startsAt} → {leave.endsAt}</span>
                        </div>
                        <Status status="REQUESTED" />
                      </div>
                    ))}
                  </div>
                )}
                <details className={styles.requestLeave}>
                  <summary>Gửi đơn nghỉ</summary>
                  <form action={requestLeaveSelfAction}>
                    <label>
                      <span>Loại nghỉ</span>
                      <select name="leaveType" defaultValue="ANNUAL">
                        <option value="ANNUAL">Nghỉ phép</option>
                        <option value="SICK">Nghỉ bệnh</option>
                        <option value="UNPAID">Không lương</option>
                        <option value="TRAINING">Đào tạo</option>
                      </select>
                    </label>
                    <div className={styles.formGrid}>
                      <label>
                        <span>Từ ngày</span>
                        <input name="startsAt" required type="date" />
                      </label>
                      <label>
                        <span>Đến ngày</span>
                        <input name="endsAt" required type="date" />
                      </label>
                    </div>
                    <label>
                      <span>Số giờ</span>
                      <input inputMode="decimal" name="hours" />
                    </label>
                    <label>
                      <span>Lý do</span>
                      <textarea name="reason" rows={3} />
                    </label>
                    <button className={styles.primaryButton} type="submit">Gửi đơn</button>
                  </form>
                </details>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div>
                    <h2>Kỳ lương</h2>
                    <span>Thu nhập tạm tính ≠ bảng lương đã duyệt</span>
                  </div>
                </div>
                {person.payrollStatus === "NONE" ? (
                  <p className={styles.empty}>Chưa có bảng lương cho kỳ hiện tại.</p>
                ) : (
                  <div className={styles.payrollState}>
                    <Status status={person.payrollStatus} />
                    <div>
                      <span>Tổng trên bảng lương</span>
                      <strong>{formatVnd(person.payrollGross ?? 0)}</strong>
                    </div>
                    <div>
                      <span>Thực nhận trên bảng lương</span>
                      <strong>{formatVnd(person.payrollNet ?? 0)}</strong>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </>
        ) : (
          <p className={styles.empty}>Tài khoản này chưa có hồ sơ nhân sự.</p>
        )}
      </div>
    </WorkspaceChrome>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Kind({ kind }: { kind: string }) {
  const labels: Record<string, string> = {
    BASE: "Lương cứng",
    SERVICE: "Dịch vụ",
    REFERRAL: "Giới thiệu",
  };
  return <span className={styles.kind}>{labels[kind] ?? kind}</span>;
}

function Status({ status }: { status: string }) {
  const labels: Record<string, string> = {
    NONE: "Chưa tạo",
    OPEN: "Đang mở",
    CLOSED: "Sẵn sàng",
    ESTIMATED: "Tạm tính",
    EARNED: "Đã phát sinh",
    REQUESTED: "Chờ duyệt",
    DRAFT: "Nháp",
    APPROVED: "Đã duyệt",
    PAID: "Đã trả",
    VOID: "Đã hủy",
  };
  return <span className={`${styles.status} ${styles[`status${status}`] ?? ""}`}>{labels[status] ?? status}</span>;
}
