import { BookOpen, Clock3, Database, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { startDemoWorkspaceAction } from "@/app/demo/actions";
import styles from "@/app/marketing.module.css";

type DemoLandingProps = {
  enabled: boolean;
  error?: string;
  homeUrl: string;
};

export function DemoLanding({ enabled, error, homeUrl }: DemoLandingProps) {
  return (
    <main className={styles.publicShell}>
      <header className={styles.publicHeader}>
        <Link className={styles.wordmark} href={homeUrl}>
          <img src="/icons/codexmed-icon.svg" alt="" />
          <span>Codexdentist</span>
        </Link>
        <nav aria-label="Điều hướng demo">
          <Link href="/features">Tính năng & hướng dẫn</Link>
        </nav>
        <Link className={styles.textLink} href={homeUrl}>
          Trang chủ
        </Link>
      </header>

      <section className={styles.demoStage}>
        <div className={styles.demoIntro}>
          <p className={styles.kicker}>Môi trường trải nghiệm riêng</p>
          <h1>Thử toàn bộ quy trình phòng khám trong 24 giờ</h1>
          <p>
            Hệ thống tạo một phòng khám độc lập với lịch hẹn, bệnh nhân và dữ liệu
            nha khoa giả lập. Mọi thay đổi chỉ tồn tại trong workspace của bạn.
          </p>

          <div className={styles.demoFacts}>
            <span><Clock3 size={18} /> Tự xóa sau 24 giờ</span>
            <span><Database size={18} /> Có lưu thay đổi tạm thời</span>
            <span><ShieldCheck size={18} /> Không dùng chung dữ liệu</span>
          </div>

          {error && (
            <p className={styles.publicError}>{demoErrorText(error)}</p>
          )}

          <div className={styles.demoActions}>
            <form action={startDemoWorkspaceAction}>
              <button className={styles.primaryCta} type="submit" disabled={!enabled}>
                <Sparkles size={18} />
                {enabled ? "Tạo phòng khám demo" : "Demo đang tạm đóng"}
              </button>
            </form>
            <Link className={styles.secondaryCta} href="/features">
              <BookOpen size={18} />
              Xem hướng dẫn sử dụng
            </Link>
          </div>

          <p className={styles.demoSafety}>
            Chỉ sử dụng dữ liệu giả. Upload tệp và gửi thông báo ra ngoài bị tắt
            trong môi trường demo.
          </p>
        </div>

        <aside className={styles.demoChecklist} aria-label="Nội dung có thể trải nghiệm">
          <strong>Bạn có thể thử</strong>
          {[
            "Quản lý lịch hẹn và ghế điều trị",
            "Hồ sơ bệnh nhân và Journey",
            "Dịch vụ, thu tiền và hóa đơn",
            "Kho vật tư, thuốc và thiết bị",
            "Nhân sự, phân quyền và báo cáo",
          ].map((item, index) => (
            <div key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{item}</p>
            </div>
          ))}
        </aside>
      </section>
    </main>
  );
}

function demoErrorText(error: string) {
  if (error === "rate-limited") {
    return "Thiết bị này đã tạo quá nhiều workspace demo trong hôm nay.";
  }

  if (error === "session") {
    return "Workspace đã được tạo nhưng chưa mở được phiên đăng nhập.";
  }

  return "Chưa thể tạo workspace demo lúc này. Vui lòng thử lại sau.";
}
