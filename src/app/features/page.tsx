import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileText,
  HeartPulse,
  MessageSquareText,
  Pill,
  Settings2,
  ShieldCheck,
  Stethoscope,
  UsersRound,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { appRootDomain } from "@/lib/env";
import styles from "../marketing.module.css";

export const metadata: Metadata = {
  title: "Tính năng và hướng dẫn sử dụng | Codexdentist",
  description:
    "Tổng quan từng module và hướng dẫn vận hành Codexdentist theo quy trình phòng khám nha khoa.",
};

const featureNavigation = [
  ["Tổng quan", "tong-quan"],
  ["Lịch hẹn", "lich-hen"],
  ["Bệnh nhân & điều trị", "benh-nhan"],
  ["Lâm sàng", "lam-sang"],
  ["Thanh toán", "thanh-toan"],
  ["Kho", "kho"],
  ["Nhân sự & quyền", "nhan-su"],
  ["CSKH & ứng dụng", "cskh"],
  ["Bắt đầu sử dụng", "bat-dau"],
];

export default function FeaturesPage() {
  const demoUrl = `https://demo.${appRootDomain()}`;

  return (
    <main className={styles.publicShell}>
      <header className={styles.publicHeader}>
        <Link className={styles.wordmark} href="/">
          <img src="/icons/codexmed-icon.svg" alt="" />
          <span>Codexdentist</span>
        </Link>
        <nav aria-label="Điều hướng hướng dẫn">
          <a href="#tong-quan">Tính năng</a>
          <a href="#bat-dau">Bắt đầu</a>
          <Link href="/docs">Cài đặt</Link>
        </nav>
        <Link className={styles.textLink} href="/">
          <ArrowLeft size={15} />
          Trang chủ
        </Link>
      </header>

      <section className={styles.guideHero}>
        <div>
          <p className={styles.kicker}>Product guide</p>
          <h1>Tính năng và hướng dẫn sử dụng</h1>
          <p>
            Đi từ lịch hẹn đến điều trị, thanh toán và chăm sóc sau khám trong một
            luồng dữ liệu thống nhất.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primaryCta} href={demoUrl}>
              Mở bản demo
              <ArrowRight size={18} />
            </a>
            <a className={styles.secondaryCta} href="#bat-dau">
              Xem quy trình bắt đầu
            </a>
          </div>
        </div>
      </section>

      <div className={styles.featureGuideLayout}>
        <aside className={styles.docsNav}>
          <strong>Mục lục</strong>
          {featureNavigation.map(([label, id]) => (
            <a href={`#${id}`} key={id}>{label}</a>
          ))}
        </aside>

        <article className={styles.featureGuide}>
          <section id="tong-quan" className={styles.featureSection}>
            <FeatureHeading
              icon={BarChart3}
              eyebrow="Điều hành"
              title="Dashboard và báo cáo"
              copy="Một màn hình theo dõi lịch hẹn, hiệu suất ghế, dòng tiền, công việc và các tín hiệu cần xử lý."
            />
            <div className={styles.guideColumns}>
              <GuideBlock title="Bạn theo dõi được">
                <li>Lượt hẹn và trạng thái bệnh nhân trong ngày.</li>
                <li>Doanh thu, công nợ, tồn kho thấp và consent còn thiếu.</li>
                <li>Hiệu suất theo phòng khám, ghế và bác sĩ.</li>
              </GuideBlock>
              <GuideBlock title="Cách sử dụng">
                <li>Mở <strong>Tổng quan</strong> vào đầu ca để xem việc ưu tiên.</li>
                <li>Mở từng tín hiệu để chuyển thẳng tới module cần xử lý.</li>
                <li>Dùng <strong>Báo cáo</strong> để lọc theo thời gian và chi nhánh.</li>
              </GuideBlock>
            </div>
          </section>

          <ScreenshotFigure
            src="/marketing/feature-schedule.png"
            alt="Màn hình lịch hẹn đa phòng khám của Codexdentist"
            caption="Lịch hẹn hiển thị bác sĩ, ghế, trạng thái và thao tác nhanh trên cùng màn hình."
          />

          <section id="lich-hen" className={styles.featureSection}>
            <FeatureHeading
              icon={CalendarDays}
              eyebrow="Tiếp đón"
              title="Lịch hẹn và vận hành ghế"
              copy="Sắp lịch theo bác sĩ, phòng khám và ghế điều trị; theo dõi bệnh nhân từ xác nhận đến hoàn tất."
            />
            <div className={styles.guideColumns}>
              <GuideBlock title="Luồng chuẩn">
                <li>Chọn <strong>Tạo lịch hẹn</strong> và tìm hoặc tạo bệnh nhân.</li>
                <li>Chọn dịch vụ, bác sĩ, ngày giờ, thời lượng và ghế.</li>
                <li>Cập nhật trạng thái: xác nhận, đã đến, đang điều trị, hoàn tất.</li>
              </GuideBlock>
              <GuideBlock title="Thao tác nhanh">
                <li>Dùng bộ lọc ngày, chi nhánh, bác sĩ và trạng thái.</li>
                <li>Mở <strong>Bệnh án</strong> để chuyển sang Journey.</li>
                <li>Mở <strong>Thanh toán</strong> khi bệnh nhân cần thu tiền.</li>
              </GuideBlock>
            </div>
          </section>

          <ScreenshotFigure
            src="/marketing/feature-patients.png"
            alt="Danh sách hồ sơ bệnh nhân 360 của Codexdentist"
            caption="Hồ sơ bệnh nhân tập trung lịch hẹn, điều trị, tài chính, consent và tệp liên quan."
          />

          <section id="benh-nhan" className={styles.featureSection}>
            <FeatureHeading
              icon={HeartPulse}
              eyebrow="Bệnh án"
              title="Hồ sơ bệnh nhân và hành trình điều trị"
              copy="Thông tin hành chính, lịch sử khám, odontogram, kế hoạch, tiến độ, chứng từ và ghi chú nằm trong cùng hồ sơ."
            />
            <div className={styles.guideColumns}>
              <GuideBlock title="Tạo và quản lý hồ sơ">
                <li>Vào <strong>Bệnh nhân</strong>, chọn <strong>Tạo bệnh nhân</strong>.</li>
                <li>Nhập thông tin liên hệ, tiền sử và consent cần thiết.</li>
                <li>Chọn bệnh nhân để xem toàn bộ lịch sử và công nợ.</li>
              </GuideBlock>
              <GuideBlock title="Ghi nhận điều trị">
                <li>Mở <strong>Hành trình điều trị</strong> từ lịch hẹn hoặc hồ sơ.</li>
                <li>Chọn răng, dịch vụ, bác sĩ và kế hoạch điều trị.</li>
                <li>Ghi tiến độ, giảm giá, ghi chú lâm sàng và hoàn tất dịch vụ.</li>
              </GuideBlock>
            </div>
          </section>

          <section id="lam-sang" className={styles.featureSection}>
            <FeatureHeading
              icon={Stethoscope}
              eyebrow="Lâm sàng"
              title="Dịch vụ, đơn thuốc và biểu mẫu"
              copy="Chuẩn hóa danh mục điều trị, toa thuốc và tài liệu chuyên môn để đội ngũ dùng cùng một quy trình."
            />
            <div className={styles.moduleMatrix}>
              <ModuleItem icon={ClipboardList} title="Quản lý dịch vụ">
                Thiết lập giá, bước điều trị, chuyên ngành và trạng thái sử dụng.
              </ModuleItem>
              <ModuleItem icon={Pill} title="Đơn thuốc">
                Lập toa từ thư viện thuốc, hướng dẫn liều dùng và in cho bệnh nhân.
              </ModuleItem>
              <ModuleItem icon={FileText} title="Biểu mẫu">
                Quản lý consent, phiếu điều trị và mẫu in dùng chung toàn hệ thống.
              </ModuleItem>
            </div>
            <div className={styles.guideCallout}>
              <ShieldCheck size={20} />
              <p>
                Chỉ người có quyền phù hợp được sửa danh mục hoặc hồ sơ lâm sàng.
                Dịch vụ đã có lịch sử tài chính sẽ được ngừng sử dụng thay vì xóa dữ liệu.
              </p>
            </div>
          </section>

          <section id="thanh-toan" className={styles.featureSection}>
            <FeatureHeading
              icon={CreditCard}
              eyebrow="Tài chính"
              title="Thanh toán, hóa đơn và kế toán"
              copy="Theo dõi tiền phải thu, tiền đã nhận, phân bổ theo dịch vụ và chi phí vận hành theo từng chi nhánh."
            />
            <div className={styles.guideColumns}>
              <GuideBlock title="Thu tiền bệnh nhân">
                <li>Chọn bệnh nhân trong <strong>Thanh toán</strong>.</li>
                <li>Ghi nhận số tiền, phương thức và nội dung phiếu thu.</li>
                <li>Phân bổ số dư vào dịch vụ hoặc hóa đơn tương ứng.</li>
              </GuideBlock>
              <GuideBlock title="Kiểm soát tài chính">
                <li>Phát hành và in hóa đơn sau khi đối soát dịch vụ.</li>
                <li>Dùng <strong>Kế toán</strong> để ghi thu, chi và đính kèm chứng từ.</li>
                <li>Kiểm tra báo cáo công nợ và doanh thu cuối ngày.</li>
              </GuideBlock>
            </div>
          </section>

          <ScreenshotFigure
            src="/marketing/feature-inventory.png"
            alt="Màn hình kho vật tư, thiết bị và bảo trì của Codexdentist"
            caption="Kho được tổ chức theo nhóm chính, tag chuyên ngành, lô, hạn dùng và thiết bị."
          />

          <section id="kho" className={styles.featureSection}>
            <FeatureHeading
              icon={Boxes}
              eyebrow="Vật tư"
              title="Kho, thuốc và thiết bị"
              copy="Quản lý vật tư tiêu hao, dụng cụ, thiết bị, thuốc, lô hàng, hạn dùng và biến động tồn."
            />
            <div className={styles.guideColumns}>
              <GuideBlock title="Thiết lập ban đầu">
                <li>Tạo nhóm chính, tag chuyên ngành và nhà cung cấp trong <strong>Cài đặt</strong>.</li>
                <li>Thêm vật tư với đơn vị, tồn tối thiểu và giá nhập.</li>
                <li>Thêm thiết bị cùng thông tin bảo trì khi cần theo dõi tài sản.</li>
              </GuideBlock>
              <GuideBlock title="Vận hành kho">
                <li>Dùng <strong>Nhập hàng</strong> để ghi nhận lô và hạn dùng.</li>
                <li>Dùng <strong>Biến động kho</strong> khi xuất, điều chỉnh hoặc chuyển tồn.</li>
                <li>Theo dõi khối sắp hết, lô cần theo dõi và bảo trì đến hạn.</li>
              </GuideBlock>
            </div>
          </section>

          <section id="nhan-su" className={styles.featureSection}>
            <FeatureHeading
              icon={UsersRound}
              eyebrow="Tổ chức"
              title="Nhân sự và phân quyền nhiều vai trò"
              copy="Một nhân sự có thể vừa là bác sĩ, vừa quản lý phòng khám hoặc chủ hệ thống, với phạm vi quyền riêng cho từng chi nhánh."
            />
            <div className={styles.guideColumns}>
              <GuideBlock title="Tạo nhân sự">
                <li>Vào <strong>Cài đặt → Nhân sự và quyền</strong>.</li>
                <li>Nhập hồ sơ, chức danh công việc và email đăng nhập.</li>
                <li>Gửi liên kết thiết lập mật khẩu dùng một lần.</li>
              </GuideBlock>
              <GuideBlock title="Gán quyền">
                <li>Chọn một hoặc nhiều vai trò truy cập.</li>
                <li>Chọn phạm vi toàn hệ thống hoặc từng phòng khám.</li>
                <li>Kiểm tra lại lịch bác sĩ và menu sau khi phân quyền.</li>
              </GuideBlock>
            </div>
          </section>

          <section id="cskh" className={styles.featureSection}>
            <FeatureHeading
              icon={MessageSquareText}
              eyebrow="Kết nối"
              title="CSKH, ứng dụng bệnh nhân và ứng dụng nhân viên"
              copy="Theo dõi recall, công việc nội bộ và cung cấp màn hình chuyên biệt cho bệnh nhân hoặc nhân viên."
            />
            <div className={styles.moduleMatrix}>
              <ModuleItem icon={MessageSquareText} title="CSKH">
                Quản lý recall, nhu cầu gọi lại, công việc và lịch sử chăm sóc.
              </ModuleItem>
              <ModuleItem icon={HeartPulse} title="Ứng dụng bệnh nhân">
                Bệnh nhân xem lịch hẹn, hồ sơ được phép, toa thuốc và thông tin thanh toán.
              </ModuleItem>
              <ModuleItem icon={UsersRound} title="Ứng dụng nhân viên">
                Nhân viên xem lịch làm việc, công việc, đào tạo và thông báo nội bộ.
              </ModuleItem>
            </div>
          </section>

          <section id="bat-dau" className={styles.featureSection}>
            <FeatureHeading
              icon={Settings2}
              eyebrow="Quick start"
              title="Bắt đầu vận hành phòng khám"
              copy="Thiết lập theo thứ tự dưới đây để các module dùng chung đúng dữ liệu ngay từ đầu."
            />
            <ol className={styles.startSteps}>
              <li><span>01</span><div><strong>Cài đặt hệ thống</strong><p>Làm theo tài liệu cài đặt, tạo tài khoản Chủ hệ thống và phòng khám đầu tiên.</p></div></li>
              <li><span>02</span><div><strong>Thiết lập danh mục</strong><p>Tạo chi nhánh, ghế, dịch vụ, biểu mẫu, nhóm kho và phương thức thanh toán.</p></div></li>
              <li><span>03</span><div><strong>Mời nhân sự</strong><p>Tạo tài khoản, gán nhiều vai trò và giới hạn phạm vi theo phòng khám.</p></div></li>
              <li><span>04</span><div><strong>Chạy một ca mẫu</strong><p>Tạo bệnh nhân, đặt lịch, ghi điều trị, thu tiền và phát hành hóa đơn.</p></div></li>
              <li><span>05</span><div><strong>Kiểm tra và sao lưu</strong><p>Đối soát Dashboard, chạy kiểm tra hệ thống và tạo bản backup đầu tiên.</p></div></li>
            </ol>
            <div className={styles.guideFinalActions}>
              <a className={styles.primaryCta} href={demoUrl}>
                Thử quy trình trên demo
                <ArrowRight size={18} />
              </a>
              <Link className={styles.secondaryCta} href="/docs">
                Đọc hướng dẫn cài đặt
              </Link>
            </div>
          </section>
        </article>
      </div>
    </main>
  );
}

type FeatureHeadingProps = {
  icon: typeof CalendarDays;
  eyebrow: string;
  title: string;
  copy: string;
};

function FeatureHeading({ icon: Icon, eyebrow, title, copy }: FeatureHeadingProps) {
  return (
    <header className={styles.featureHeading}>
      <span><Icon size={22} /></span>
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
        <div>{copy}</div>
      </div>
    </header>
  );
}

function GuideBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.guideBlock}>
      <strong>{title}</strong>
      <ol>{children}</ol>
    </div>
  );
}

function ModuleItem({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof CalendarDays;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.moduleItem}>
      <Icon size={21} />
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function ScreenshotFigure({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure className={styles.featureScreenshot}>
      <Image
        src={src}
        alt={alt}
        width={1920}
        height={1080}
        quality={92}
        sizes="(max-width: 900px) 100vw, 960px"
      />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
