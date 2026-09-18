import { notFound } from "next/navigation";
import { getImagingViewerCommand, listImagingStudiesCommand } from "@/lib/application/imaging/commands";
import { applicationErrorCode } from "@/lib/application/errors";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireSession } from "@/lib/auth";
import styles from "./imaging.module.css";

export default async function ImagingPage() {
  const session = await requireSession();
  if (!canPerformAction(session, "imaging.study.view")) notFound();

  const studies = await listImagingStudiesCommand(session);
  const cards = await mapWithConcurrency(studies, 8, async (study) => {
    try {
      return { study, viewerUrl: (await getImagingViewerCommand(session, study.id)).viewerUrl, viewerError: null };
    } catch (error) {
      return { study, viewerUrl: null, viewerError: applicationErrorCode(error, "imaging-viewer-failed") };
    }
  });

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
          {cards.map(({ study, viewerUrl, viewerError }) => (
            <article className={styles.card} key={study.id}>
              <div className={styles.cardTopline}>
                <span className={styles.badge}>{study.modalities.join(" · ") || "Imaging"}</span>
                <span>{viewerError || study.availability !== "AVAILABLE" ? "Không khả dụng" : "Sẵn sàng"}</span>
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
                <p className={styles.unavailable}>{viewerMessage(viewerError)}</p>
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

function viewerMessage(error: string | null) {
  if (error === "orthanc-study-not-found") {
    return "Study không còn tồn tại trong PACS; tham chiếu Codexdentist vẫn được giữ để đối soát.";
  }
  if (error === "orthanc-study-identity-mismatch") {
    return "PACS trả về định danh không khớp; viewer đã bị khóa để bảo vệ dữ liệu bệnh nhân.";
  }
  if (error?.startsWith("orthanc-")) {
    return "PACS hiện không khả dụng; tham chiếu study vẫn được giữ an toàn.";
  }
  if (error === "imaging-viewer-access-not-configured") {
    return "OHIF đang bị tắt vì chưa cấu hình private viewer access.";
  }
  if (error === "imaging-connection-unavailable") {
    return "Kết nối PACS hiện không hoạt động; hãy kiểm tra cấu hình tích hợp.";
  }
  return "OHIF chưa được cấu hình cho kết nối này.";
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
