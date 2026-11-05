import { notFound } from "next/navigation";
import { getImagingViewerCommand, listImagingStudiesCommand } from "@/lib/application/imaging/commands";
import { applicationErrorCode } from "@/lib/application/errors";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireSession } from "@/lib/auth";
import { OperationsWorkspaceFrame } from "@/app/(app)/OperationsWorkspaceFrame";
import { ImagingLinkForm } from "./imaging-link-form";
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
    <OperationsWorkspaceFrame view="imaging" session={session}><div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{session.clinics.find(clinic => clinic.id === session.activeClinicId)?.name ?? "Các phòng khám được phép"}</p>
          <h2>Phim chụp theo bệnh nhân</h2>
          <p className={styles.lede}>
            Liên kết và mở phim chụp theo đúng bệnh nhân, trong phạm vi phòng khám được phép.
          </p>
        </div>
        <a className={styles.backLink} href="/journey">Về Journey</a>
      </header>
      {canPerformAction(session, "imaging.study.link") && <ImagingLinkForm />}

      {cards.length === 0 ? (
        <section className={styles.empty}>
          <h2>Chưa có phim chụp được liên kết</h2>
          <p>Phim đã liên kết với bệnh nhân sẽ xuất hiện tại đây.</p>
        </section>
      ) : (
        <section className={styles.grid} aria-label="Danh sách phim chụp">
          {cards.map(({ study, viewerUrl, viewerError }) => (
            <article className={styles.card} key={study.id}>
              <div className={styles.cardTopline}>
                <span className={styles.badge}>{study.modalities.join(" · ") || "Phim chụp"}</span>
                <span>{viewerError || study.availability !== "AVAILABLE" ? "Không khả dụng" : "Sẵn sàng"}</span>
              </div>
              <h2>{study.description || "Phim chụp chưa có mô tả"}</h2>
              <dl>
                <div><dt>Bệnh nhân</dt><dd>{study.patient.fullName}</dd></div>
                <div><dt>Phòng khám</dt><dd>{study.clinic.name}</dd></div>
                <div><dt>Ngày chụp</dt><dd>{formatDate(study.studyDate)}</dd></div>
                <div><dt>Mã phim</dt><dd>{study.externalStudyId}</dd></div>
              </dl>
              {viewerUrl ? (
                <a className={styles.openButton} href={viewerUrl} target="_blank" rel="noreferrer">
                  Mở phim chụp
                </a>
              ) : (
                <p className={styles.unavailable}>{viewerMessage(viewerError)}</p>
              )}
            </article>
          ))}
        </section>
      )}
    </div></OperationsWorkspaceFrame>
  );
}

function formatDate(value: Date | null) {
  return value
    ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }).format(value)
    : "Chưa có ngày";
}

function viewerMessage(error: string | null) {
  if (error === "orthanc-study-not-found") {
    return "Không tìm thấy phim tại nơi lưu trữ. Liên kết vẫn được giữ để kiểm tra lại.";
  }
  if (error === "orthanc-study-identity-mismatch") {
    return "Thông tin phim không khớp với bệnh nhân. Việc mở phim đã bị khóa để bảo vệ hồ sơ.";
  }
  if (error?.startsWith("orthanc-")) {
    return "Nơi lưu phim tạm thời không khả dụng. Liên kết phim vẫn được giữ an toàn.";
  }
  if (error === "imaging-viewer-access-not-configured") {
    return "Chưa thể mở phim an toàn. Liên hệ người quản lý để kiểm tra quyền truy cập.";
  }
  if (error === "imaging-connection-unavailable") {
    return "Kết nối đến nơi lưu phim hiện không hoạt động. Vui lòng thử lại sau.";
  }
  return "Chưa thể mở phim này. Liên hệ người quản lý phòng khám để được hỗ trợ.";
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
