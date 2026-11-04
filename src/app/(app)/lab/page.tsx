import { canPerformAction } from "@/lib/actions/permissions";
import { listLabCasesCommand } from "@/lib/application/lab/commands";
import { requireSession } from "@/lib/auth";
import { notFound } from "next/navigation";
import styles from "./lab.module.css";

const statusLabels: Record<string, string> = {
  DRAFT: "Nháp",
  SENT: "Đã gửi labo",
  IN_PROGRESS: "Đang thực hiện",
  READY: "Đã hoàn tất",
  DELIVERED: "Đã nhận",
  CANCELLED: "Đã hủy",
};

export default async function LabPage() {
  const session = await requireSession();
  if (!canPerformAction(session, "lab.case.view")) notFound();
  const cases = await listLabCasesCommand(session);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Codexdentist · Vận hành</p>
          <h1>Ca labo</h1>
          <p className={styles.lede}>Theo dõi phiếu gửi labo theo đúng bệnh nhân, phòng khám và dịch vụ điều trị.</p>
        </div>
        <a className={styles.backLink} href="/journey">Về Journey</a>
      </header>
      {cases.length === 0 ? (
        <section className={styles.empty}><h2>Chưa có ca labo</h2><p>Tạo ca labo từ API hoặc workflow điều trị để bắt đầu theo dõi.</p></section>
      ) : (
        <section className={styles.grid} aria-label="Danh sách ca labo">
          {cases.map((labCase) => (
            <article className={styles.card} key={labCase.id}>
              <div className={styles.topline}><strong>{labCase.caseNo}</strong><span>{statusLabels[labCase.status] ?? labCase.status}</span></div>
              <h2>{labCase.title}</h2>
              <p className={styles.meta}>{labCase.patient.fullName} · {labCase.clinic.name}</p>
              <dl>
                <div><dt>Loại phục hình</dt><dd>{labCase.workType}</dd></div>
                <div><dt>Labo</dt><dd>{labCase.laboratoryName || "Chưa chỉ định"}</dd></div>
                <div><dt>Hạn giao</dt><dd>{formatDate(labCase.dueAt)}</dd></div>
              </dl>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function formatDate(value: Date | null) {
  return value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }).format(value) : "Chưa có";
}
