import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  HeartPulse,
  Monitor,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { LandingNav } from "./LandingNav";
import { DayPreview } from "./DayPreview";
import styles from "./landing.module.css";

const questions = [
  [
    "Thời gian dùng thử kéo dài bao lâu?",
    "Tài khoản dùng thử có hiệu lực trong 30 ngày kể từ lúc tạo. Đây là workspace riêng của phòng khám, không phải phiên demo 24 giờ.",
  ],
  [
    "Tôi có cần thẻ thanh toán để bắt đầu không?",
    "Không. Bạn có thể tạo tài khoản và dùng thử trước mà không cần nhập thông tin thẻ thanh toán.",
  ],
  [
    "Tôi có thể mời nhân sự cùng dùng thử không?",
    "Có. Chủ phòng khám có thể tạo tài khoản cho đội ngũ và phân quyền theo vai trò để thử quy trình làm việc thực tế.",
  ],
  [
    "Điều gì xảy ra sau 30 ngày?",
    "Workspace sẽ dừng truy cập khi thời gian dùng thử kết thúc cho đến khi được chuyển sang gói sử dụng phù hợp. Dữ liệu trial không bị xoá theo cơ chế demo 24 giờ.",
  ],
] as const;

export function LandingPage() {
  return (
    <div className={styles.landing} data-landing-page="true">
      <a className={styles.skipLink} href="#noi-dung">
        Đến nội dung chính
      </a>
      <LandingNav />

      <main id="noi-dung" tabIndex={-1}>
        <section
          className={`${styles.container} ${styles.hero}`}
          aria-labelledby="landing-title"
        >
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span /> Nền tảng vận hành phòng khám nha khoa
            </p>
            <h1 id="landing-title">
              Từ một lịch hẹn,
              <br />
              <em>đến cả hành trình</em> chăm sóc.
            </h1>
            <p className={styles.heroLead}>
              Lịch hẹn, hồ sơ điều trị, thu chi và vận hành ở cùng một nơi.
              Để lễ tân, bác sĩ và quản lý tiếp nối công việc mà không phải tìm
              lại thông tin ở nhiều hệ thống.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryCta} href="/signup">
                Dùng thử miễn phí 30 ngày
                <ArrowUpRight size={19} aria-hidden="true" />
              </Link>
              <a className={styles.textLink} href="#mot-ngay">
                Xem cách vận hành
                <ArrowDown size={17} aria-hidden="true" />
              </a>
            </div>
            <p className={styles.heroFootnote}>
              Không cần thẻ thanh toán · Workspace riêng cho phòng khám.
            </p>
          </div>

          <DayPreview />
        </section>

        <div
          className={`${styles.container} ${styles.principles}`}
          aria-label="Giá trị sản phẩm"
        >
          <p>
            Được thiết kế quanh nhịp vận hành nha khoa.
            <br />
            <strong>Một hệ thống để cả đội cùng làm việc.</strong>
          </p>
          <span>
            <UsersRound size={21} aria-hidden="true" />
            Cả đội trên một workspace
          </span>
          <span>
            <ShieldCheck size={21} aria-hidden="true" />
            Phân quyền theo vai trò
          </span>
          <span>
            <Smartphone size={21} aria-hidden="true" />
            Máy tính & điện thoại
          </span>
        </div>

        <section
          className={`${styles.container} ${styles.story}`}
          id="mot-ngay"
          aria-labelledby="story-title"
        >
          <div className={styles.sectionIntro}>
            <div>
              <p className={styles.eyebrow}>01 / Một ngày tại phòng khám</p>
              <h2 id="story-title">
                Nhiều việc cần làm.
                <br />
                <em>Không cần nhiều mảnh rời.</em>
              </h2>
            </div>
            <p>
              Bệnh nhân đi qua nhiều điểm chạm. Thông tin về họ nên đi cùng,
              không bắt đầu lại ở mỗi bước.
            </p>
          </div>

          <div className={styles.chapters}>
            <article className={styles.chapter}>
              <div className={styles.chapterTop}>
                <time>08:00</time>
                <CalendarDays size={24} aria-hidden="true" />
              </div>
              <p className={styles.chapterLabel}>Trước buổi khám</p>
              <h3>
                Đón đúng người.
                <br />
                Nắm đúng lịch.
              </h3>
              <p>
                Lễ tân nắm lịch bác sĩ, ghế điều trị và trạng thái cuộc hẹn.
                Cả đội bắt đầu ngày làm việc từ cùng một lịch.
              </p>
              <div className={styles.chapterFlow}>
                <span>Lịch hẹn</span>
                <ArrowRight size={15} aria-hidden="true" />
                <span>Đón tiếp</span>
              </div>
            </article>

            <article className={styles.chapter}>
              <div className={styles.chapterTop}>
                <time>10:30</time>
                <HeartPulse size={24} aria-hidden="true" />
              </div>
              <p className={styles.chapterLabel}>Trong buổi điều trị</p>
              <h3>
                Mở hồ sơ.
                <br />
                Tiếp nối chăm sóc.
              </h3>
              <p>
                Journey kết nối ghi chú, odontogram và tiến trình điều trị.
                Bác sĩ xem lại lịch sử trước khi ghi nhận bước tiếp theo.
              </p>
              <div className={styles.chapterFlow}>
                <span>Hồ sơ</span>
                <ArrowRight size={15} aria-hidden="true" />
                <span>Điều trị</span>
              </div>
            </article>

            <article className={styles.chapter}>
              <div className={styles.chapterTop}>
                <time>17:00</time>
                <ReceiptText size={24} aria-hidden="true" />
              </div>
              <p className={styles.chapterLabel}>Sau buổi khám</p>
              <h3>
                Rõ khoản thu.
                <br />
                Nhớ lần hẹn tới.
              </h3>
              <p>
                Kiểm tra dịch vụ, ghi nhận thu tiền, theo dõi hoá đơn và đặt
                lịch tái khám. Một buổi khám khép lại, hành trình vẫn tiếp tục.
              </p>
              <div className={styles.chapterFlow}>
                <span>Thu chi</span>
                <ArrowRight size={15} aria-hidden="true" />
                <span>Tái khám</span>
              </div>
            </article>
          </div>

          <div className={styles.storyFooter}>
            <p>
              Và phía sau mỗi buổi khám: kho, thuốc, nhân sự và báo cáo.
            </p>
            <Link className={styles.textLink} href="/features">
              Xem toàn bộ tính năng
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section
          className={styles.ownership}
          id="dung-thu"
          aria-labelledby="trial-title"
        >
          <div className={`${styles.container} ${styles.ownershipInner}`}>
            <div className={styles.ownershipCopy}>
              <p className={styles.eyebrow}>02 / Bắt đầu bằng trải nghiệm thật</p>
              <h2 id="trial-title">
                30 ngày để thử thật.
                <br />
                <em>Không chỉ xem demo.</em>
              </h2>
              <p>
                Tạo workspace cho chính phòng khám, mời đội ngũ vào dùng và
                đánh giá sản phẩm trên quy trình thực tế trước khi quyết định.
              </p>
              <Link className={styles.lightCta} href="/signup">
                Tạo tài khoản miễn phí
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
            </div>

            <div className={styles.ownershipDetails}>
              <article>
                <Monitor size={25} aria-hidden="true" />
                <div>
                  <h3>Workspace riêng cho phòng khám</h3>
                  <p>
                    Bắt đầu bằng dữ liệu và cấu hình của chính đội ngũ, không
                    dùng chung một môi trường demo công cộng.
                  </p>
                </div>
              </article>
              <article>
                <UsersRound size={25} aria-hidden="true" />
                <div>
                  <h3>Đủ thời gian để cả đội cùng thử</h3>
                  <p>
                    Lễ tân, bác sĩ và quản lý có 30 ngày để kiểm tra cách hệ
                    thống đi cùng quy trình thực tế.
                  </p>
                </div>
              </article>
              <article>
                <CheckCircle2 size={25} aria-hidden="true" />
                <div>
                  <h3>Không cần thẻ khi bắt đầu</h3>
                  <p>
                    Tạo tài khoản trước, trải nghiệm sản phẩm trước, rồi mới
                    quyết định bước tiếp theo.
                  </p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section
          className={`${styles.container} ${styles.faq}`}
          id="cau-hoi"
          aria-labelledby="faq-title"
        >
          <div>
            <p className={styles.eyebrow}>03 / Trước khi bắt đầu</p>
            <h2 id="faq-title">
              Một tháng để
              <br />
              <em>tự mình đánh giá.</em>
            </h2>
            <Link className={styles.textLink} href="/docs">
              <BookOpen size={18} aria-hidden="true" />
              Đọc thêm trong tài liệu
            </Link>
          </div>

          <div className={styles.questions}>
            {questions.map(([question, answer]) => (
              <details key={question} name="landing-faq">
                <summary>
                  {question}
                  <Sparkles size={20} aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          className={`${styles.container} ${styles.invitation}`}
          aria-labelledby="invitation-title"
        >
          <div>
            <p className={styles.eyebrow}>Bắt đầu khi phòng khám còn đang vận hành</p>
            <h2 id="invitation-title">
              Dùng thử 30 ngày.
              <br />
              <em>Không cần thẻ.</em>
            </h2>
            <p>
              Tạo workspace riêng và đi từ lịch hẹn đến hồ sơ, điều trị và thu
              chi cùng đội ngũ của bạn.
            </p>
            <Link className={styles.primaryCta} href="/signup">
              Tạo tài khoản dùng thử
              <ArrowUpRight size={19} aria-hidden="true" />
            </Link>
            <p className={styles.invitationNote}>
              Miễn phí 30 ngày kể từ lúc tạo tài khoản.
            </p>
          </div>

          <div className={styles.continuity} aria-hidden="true">
            <span className={styles.continuityRing} />
            <span className={styles.continuityIcon}>
              <img
                src="/icons/codexmed-icon.svg"
                width="66"
                height="66"
                alt=""
              />
            </span>
            <span className={styles.orbitTop}>
              <CalendarDays size={24} />
            </span>
            <span className={styles.orbitRight}>
              <HeartPulse size={24} />
            </span>
            <span className={styles.orbitBottom}>
              <ReceiptText size={24} />
            </span>
            <span className={styles.orbitLeft}>
              <ShieldCheck size={24} />
            </span>
          </div>
        </section>
      </main>

      <footer className={`${styles.container} ${styles.footer}`}>
        <div>
          <Link href="/" className={styles.brand}>
            <img src="/icons/codexmed-icon.svg" width="32" height="32" alt="" />
            <span>
              codexdentist<span className={styles.brandDot}>.</span>
            </span>
          </Link>
          <p>Nền tảng vận hành cho phòng khám nha khoa.</p>
        </div>

        <nav aria-label="Liên kết cuối trang">
          <Link href="/features">Tính năng</Link>
          <Link href="/docs">Tài liệu</Link>
          <Link href="/signup">Dùng thử 30 ngày</Link>
          <Link href="/login">Đăng nhập</Link>
        </nav>

        <p className={styles.footerBottom}>
          <span>Codexdentist</span>
          <span>Thiết kế quanh hành trình chăm sóc.</span>
        </p>
      </footer>
    </div>
  );
}
