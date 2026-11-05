import { canPerformAction } from "@/lib/actions/permissions";
import { listLabCasesCommand } from "@/lib/application/lab/commands";
import { requireSession } from "@/lib/auth";
import { notFound } from "next/navigation";
import { OperationsWorkspaceFrame } from "@/app/(app)/OperationsWorkspaceFrame";
import { CreateLabCaseForm, LabCaseStatusForm } from "./lab-forms";
import { labStatusLabels } from "./labels";
import styles from "./lab.module.css";


export default async function LabPage() {
  const session = await requireSession();
  if (!canPerformAction(session, "lab.case.view")) notFound();
  const cases = await listLabCasesCommand(session);

  return (
    <OperationsWorkspaceFrame view="lab" session={session}><div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{session.clinics.find(clinic => clinic.id === session.activeClinicId)?.name ?? "Các phòng khám được phép"}</p>
          <h2>Phiếu gửi và tiến độ labo</h2>
          <p className={styles.lede}>Theo dõi phiếu gửi labo theo đúng bệnh nhân, phòng khám và dịch vụ điều trị.</p>
        </div>
        <a className={styles.backLink} href="/journey">Về Journey</a>
      </header>
      {canPerformAction(session, "lab.case.create") && <CreateLabCaseForm />}
      {cases.length === 0 ? (
        <section className={styles.empty}><h2>Chưa có ca labo</h2><p>Các phiếu gửi labo và tiến độ thực hiện sẽ xuất hiện tại đây.</p></section>
      ) : (
        <section className={styles.grid} aria-label="Danh sách ca labo">
          {cases.map((labCase) => (
            <article className={styles.card} key={labCase.id}>
              <div className={styles.topline}><strong>{labCase.caseNo}</strong><span>{labStatusLabels[labCase.status] ?? labCase.status}</span></div>
              <h2>{labCase.title}</h2>
              <p className={styles.meta}>{labCase.patient.fullName} · {labCase.clinic.name}</p>
              <dl>
                <div><dt>Loại phục hình</dt><dd>{labCase.workType}</dd></div>
                <div><dt>Labo</dt><dd>{labCase.laboratoryName || "Chưa chỉ định"}</dd></div>
                <div><dt>Hạn giao</dt><dd>{formatDate(labCase.dueAt)}</dd></div>
              </dl>
              {canPerformAction(session, "lab.case.update") && <LabCaseStatusForm id={labCase.id} status={labCase.status} />}
            </article>
          ))}
        </section>
      )}
    </div></OperationsWorkspaceFrame>
  );
}

function formatDate(value: Date | null) {
  return value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }).format(value) : "Chưa có";
}
