import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, DatabaseBackup, GitFork, HeartPulse, Monitor, Plus, ReceiptText, ShieldCheck, Smartphone, UsersRound } from "lucide-react";
import { LandingNav } from "./LandingNav";
import { DayPreview } from "./DayPreview";
import styles from "./landing.module.css";

type Props = { demoUrl: string; sourceUrl: string };
const questions = [
  ["Tôi có cần nhập dữ liệu bệnh nhân để dùng thử?", "Không. Môi trường trải nghiệm có sẵn dữ liệu giả lập và không gian riêng trong 24 giờ. Chỉ sử dụng dữ liệu giả; tải tệp và gửi thông báo ra ngoài được tắt trong bản demo."],
  ["Phòng khám có bắt buộc dùng cloud?", "Không. Bạn có thể tự triển khai trên máy tại phòng khám hoặc máy chủ riêng. Với cài đặt nội bộ, các thiết bị truy cập qua mạng LAN; các dịch vụ bên ngoài vẫn cần kết nối Internet."],
  ["Tôi có thể sử dụng trên điện thoại?", "Có. Giao diện web có thể truy cập từ máy tính, máy tính bảng và điện thoại. Thiết bị cần kết nối được với máy chủ của phòng khám."],
  ["Nên bắt đầu triển khai như thế nào?", "Thử luồng làm việc trước, sau đó đọc hướng dẫn cài đặt và kiểm tra yêu cầu hạ tầng. Trước khi sử dụng hồ sơ bệnh nhân, cần thiết lập phân quyền, sao lưu và thử khôi phục."],
] as const;

export function LandingPage({ demoUrl, sourceUrl }: Props) {
  return (
    <div className={styles.landing} data-landing-page="true">
      <a className={styles.skipLink} href="#noi-dung">Đến nội dung chính</a>
      <LandingNav demoUrl={demoUrl} />
      <main id="noi-dung" tabIndex={-1}>
        <section className={`${styles.container} ${styles.hero}`} aria-labelledby="landing-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span /> Phần mềm nha khoa mã nguồn mở</p>
            <h1 id="landing-title">Từ một lịch hẹn,<br /><em>đến cả hành trình</em> chăm sóc.</h1>
            <p className={styles.heroLead}>Lịch hẹn, hồ sơ điều trị và thu chi ở cùng một nơi. Để lễ tân, bác sĩ và quản lý tiếp nối công việc, không phải tìm lại thông tin.</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryCta} href={demoUrl}>Trải nghiệm 24 giờ <ArrowUpRight size={19} aria-hidden="true" /></Link>
              <a className={styles.textLink} href="#mot-ngay">Khám phá một ngày <ArrowDown size={17} aria-hidden="true" /></a>
            </div>
            <p className={styles.heroFootnote}>Không gian thử riêng. Chỉ dùng dữ liệu giả.</p>
          </div>
          <DayPreview />
        </section>

        <div className={`${styles.container} ${styles.principles}`} aria-label="Định hướng sản phẩm">
          <p>Dành cho nha khoa Việt Nam.<br /><strong>Vừa vặn với phòng khám của bạn.</strong></p>
          <span><GitFork size={21} aria-hidden="true" />Mã nguồn mở</span>
          <span><Monitor size={21} aria-hidden="true" />Có thể tự triển khai</span>
          <span><Smartphone size={21} aria-hidden="true" />Máy tính & điện thoại</span>
        </div>

        <section className={`${styles.container} ${styles.story}`} id="mot-ngay" aria-labelledby="story-title">
          <div className={styles.sectionIntro}>
            <div><p className={styles.eyebrow}>01 / Một ngày tại phòng khám</p><h2 id="story-title">Nhiều việc cần làm.<br /><em>Không cần nhiều mảnh rời.</em></h2></div>
            <p>Bệnh nhân đi qua nhiều điểm chạm. Thông tin về họ nên đi cùng, không bắt đầu lại ở mỗi bước.</p>
          </div>
          <div className={styles.chapters}>
            <article className={styles.chapter}>
              <div className={styles.chapterTop}><time>08:00</time><CalendarDays size={24} aria-hidden="true" /></div>
              <p className={styles.chapterLabel}>Trước buổi khám</p>
              <h3>Đón đúng người.<br />Nắm đúng lịch.</h3>
              <p>Lễ tân nắm lịch bác sĩ, ghế điều trị và trạng thái cuộc hẹn. Cả đội bắt đầu ngày làm việc từ cùng một lịch.</p>
              <div className={styles.chapterFlow}><span>Lịch hẹn</span><ArrowRight size={15} aria-hidden="true" /><span>Đón tiếp</span></div>
            </article>
            <article className={styles.chapter}>
              <div className={styles.chapterTop}><time>10:30</time><HeartPulse size={24} aria-hidden="true" /></div>
              <p className={styles.chapterLabel}>Trong buổi điều trị</p>
              <h3>Mở hồ sơ.<br />Tiếp nối chăm sóc.</h3>
              <p>Journey kết nối ghi chú, odontogram và tiến trình điều trị. Bác sĩ xem lại lịch sử trước khi ghi nhận bước tiếp theo.</p>
              <div className={styles.chapterFlow}><span>Hồ sơ</span><ArrowRight size={15} aria-hidden="true" /><span>Điều trị</span></div>
            </article>
            <article className={styles.chapter}>
              <div className={styles.chapterTop}><time>17:00</time><ReceiptText size={24} aria-hidden="true" /></div>
              <p className={styles.chapterLabel}>Sau buổi khám</p>
              <h3>Rõ khoản thu.<br />Nhớ lần hẹn tới.</h3>
              <p>Kiểm tra dịch vụ, ghi nhận thu tiền, theo dõi hoá đơn và đặt lịch tái khám. Một buổi khám khép lại, hành trình vẫn tiếp tục.</p>
              <div className={styles.chapterFlow}><span>Thu chi</span><ArrowRight size={15} aria-hidden="true" /><span>Tái khám</span></div>
            </article>
          </div>
          <div className={styles.storyFooter}><p>Và phía sau mỗi buổi khám: kho, thuốc, nhân sự và báo cáo.</p><Link className={styles.textLink} href="/features">Xem tính năng & hướng dẫn <ArrowUpRight size={17} aria-hidden="true" /></Link></div>
        </section>

        <section className={styles.ownership} id="du-lieu" aria-labelledby="ownership-title">
          <div className={`${styles.container} ${styles.ownershipInner}`}>
            <div className={styles.ownershipCopy}>
              <p className={styles.eyebrow}>02 / Chủ động từ nền tảng</p>
              <h2 id="ownership-title">Phòng khám của bạn.<br /><em>Dữ liệu do bạn chủ động.</em></h2>
              <p>Chọn hạ tầng phù hợp, phân quyền cho đội ngũ và chủ động sao lưu. Mã nguồn mở để bạn có thể kiểm tra và tự triển khai.</p>
              <Link className={styles.lightCta} href="/docs#quick-start">Tìm hiểu cách cài đặt <ArrowUpRight size={18} aria-hidden="true" /></Link>
            </div>
            <div className={styles.ownershipDetails}>
              {[
                { icon: Monitor, title: "Chạy trên hạ tầng bạn chọn", copy: "Máy tại phòng khám hoặc máy chủ riêng. Không bắt buộc cloud." },
                { icon: UsersRound, title: "Đúng người, đúng phạm vi", copy: "Phân quyền theo vai trò và phòng khám; hồ sơ bệnh nhân có kiểm soát truy cập." },
                { icon: DatabaseBackup, title: "Chủ động sao lưu, thử khôi phục", copy: "Thiết lập quy trình sao lưu trước khi bắt đầu vận hành." },
              ].map(({ icon: Icon, title, copy }) => <article key={title}><Icon size={25} aria-hidden="true" /><div><h3>{title}</h3><p>{copy}</p></div></article>)}
              <a className={styles.sourceLink} href={sourceUrl}><GitFork size={18} aria-hidden="true" /> Khám phá mã nguồn <ArrowUpRight size={17} aria-hidden="true" /></a>
            </div>
          </div>
        </section>

        <section className={`${styles.container} ${styles.faq}`} id="cau-hoi" aria-labelledby="faq-title">
          <div><p className={styles.eyebrow}>03 / Trước khi bắt đầu</p><h2 id="faq-title">Bạn có thể<br /><em>đang tự hỏi.</em></h2><Link className={styles.textLink} href="/docs"><BookOpen size={18} aria-hidden="true" /> Đọc thêm trong tài liệu</Link></div>
          <div className={styles.questions}>{questions.map(([question, answer]) => <details key={question} name="landing-faq"><summary>{question}<Plus size={20} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div>
        </section>

        <section className={`${styles.container} ${styles.invitation}`} aria-labelledby="invitation-title">
          <div><p className={styles.eyebrow}>Câu chuyện tiếp theo là của bạn</p><h2 id="invitation-title">Thử một ngày.<br /><em>Tự mình cảm nhận.</em></h2><p>Đi từ lịch hẹn đến hồ sơ và thu chi trong một không gian trải nghiệm riêng.</p><Link className={styles.primaryCta} href={demoUrl}>Bắt đầu trải nghiệm <ArrowUpRight size={19} aria-hidden="true" /></Link><p className={styles.invitationNote}>Dữ liệu giả lập. Tự xoá sau 24 giờ.</p></div>
          <div className={styles.continuity} aria-hidden="true"><span className={styles.continuityRing} /><span className={styles.continuityIcon}><img src="/icons/codexmed-icon.svg" width="66" height="66" alt="" /></span><span className={styles.orbitTop}><CalendarDays size={24} /></span><span className={styles.orbitRight}><HeartPulse size={24} /></span><span className={styles.orbitBottom}><ReceiptText size={24} /></span><span className={styles.orbitLeft}><ShieldCheck size={24} /></span></div>
        </section>
      </main>
      <footer className={`${styles.container} ${styles.footer}`}>
        <div><Link href="/" className={styles.brand}><img src="/icons/codexmed-icon.svg" width="32" height="32" alt="" /><span>codexdentist<span className={styles.brandDot}>.</span></span></Link><p>Mã nguồn mở cho nha khoa Việt Nam.</p></div>
        <nav aria-label="Liên kết cuối trang"><Link href="/features">Tính năng</Link><Link href="/docs">Tài liệu</Link><a href={sourceUrl}>Mã nguồn <ArrowUpRight size={14} aria-hidden="true" /></a><Link href="/login">Đăng nhập</Link></nav>
        <p className={styles.footerBottom}><span>Codexdentist</span><span>Thiết kế quanh hành trình chăm sóc.</span></p>
      </footer>
    </div>
  );
}
