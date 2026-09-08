import { notFound } from "next/navigation";
import { getImagingViewerCommand, listImagingStudiesCommand } from "@/lib/application/imaging/commands";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireSession } from "@/lib/auth";
import styles from "./imaging.module.css";

export default async function ImagingPage() {
  const session = await requireSession();
  if (!canPerformAction(session, "imaging.study.view")) notFound();

  const studies = await listImagingStudiesCommand(session);
  const cards = await Promise.all(
    studies.map(async (study) => {
      try {
        return { study, viewerUrl: (await getImagingViewerCommand(session, study.id)).viewerUrl };
      } catch {
        return { study, viewerUrl: null };
      }
    }),
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Codexdentist · Chẩn đoán hình ảnh</p>
          <h1>Hình ảnh học</h1>
          <p className={styles.lede}>
            Các study được liên kết theo bệnh nhân và phòng khám. Dữ liệu DICOM vẫn nằm trong PACS; Codexdentist chỉ giữ tham chiếu được cấp quyền.
          </p>
        </div>
        <a className={styles.backLink} href="/journey">Về Journey</a>
      </header>

      {cards.length === 0 ? (
        <section className={styles.empty}>
          <h2>Chưa có study được liên kết</h2>
          <p>Khi PACS được cấu hình, liên kết study qua API imaging để xuất hiện tại đây.</p>
        </section>
      ) : (
        <section className={styles.grid} aria-label="Danh sách study hình ảnh">
          {cards.map(({ study, viewerUrl }) => (
            <article className={styles.card} key={study.id}>
              <div className={styles.cardTopline}>
                <span className={styles.badge}>{study.modalities.join(" · ") || "Imaging"}</span>
                <span>{study.availability === "AVAILABLE" ? "Sẵn sàng" : "Không khả dụng"}</span>
              </div>
              <h2>{study.description || "Study không có mô tả"}</h2>
              <dl>
                <div><dt>Bệnh nhân</dt><dd>{study.patient.fullName}</dd></div>
                <div><dt>Phòng khám</dt><dd>{study.clinic.name}</dd></div>
                <div><dt>Ngày chụp</dt><dd>{formatDate(study.studyDate)}</dd></div>
                <div><dt>Mã study</dt><dd>{study.externalStudyId}</dd></div>
              </dl>
              {viewerUrl ? (
                <a className={styles.openButton} href={viewerUrl} target="_blank" rel="noreferrer">
                  Mở OHIF Viewer
                </a>
              ) : (
                <p className={styles.unavailable}>OHIF chưa được cấu hình cho kết nối này.</p>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function formatDate(value: Date | null) {
  return value
    ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }).format(value)
    : "Chưa có ngày";
}
