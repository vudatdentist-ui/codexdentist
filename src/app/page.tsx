import {
  ArrowRight,
  Building2,
  DatabaseBackup,
  GitFork,
  Server,
  ShieldCheck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DemoLanding } from "@/components/DemoLanding";
import { PublicOdontogram } from "@/components/PublicOdontogram";
import { appRootDomain, demoWorkspaceEnabled } from "@/lib/env";
import {
  currentHostname,
  isLocalHostname,
  systemSubdomainFromHostname,
  tenantSlugFromHostname,
} from "@/lib/tenant";
import styles from "./landing.module.css";

const marketingMetadata: Metadata = {
  title: "Dental OS - Hệ điều hành cho phòng khám nha khoa",
  description:
    "Kết nối lịch hẹn, hồ sơ điều trị, thanh toán, kho và nhân sự trong một hệ thống nha khoa mã nguồn mở có thể tự host.",
};

const odontogramMetadata: Metadata = {
  title: "Odontogram 5 mặt | Codexdentist",
  description:
    "Mô hình odontogram FDI tương tác với năm mặt răng Mesial, Distal, Buccal, Lingual và Occlusal hoặc Incisal.",
};

const breadth = [
  {
    title: "Lịch hẹn và vận hành trong ngày",
    copy: "Theo dõi lịch bác sĩ, ghế điều trị, trạng thái bệnh nhân và các công việc cần xử lý.",
  },
  {
    title: "Hồ sơ bệnh nhân và điều trị",
    copy: "Patient Journey, odontogram, dịch vụ, ghi chú, biểu mẫu và tệp bệnh nhân dùng chung một ngữ cảnh.",
  },
  {
    title: "Thanh toán và kế toán",
    copy: "Theo dõi thu tiền, phân bổ, hóa đơn, công nợ và báo cáo mà không tách rời khỏi hồ sơ điều trị.",
  },
  {
    title: "Kho, thuốc và thiết bị",
    copy: "Quản lý vật tư, lô, hạn dùng, đơn thuốc, thiết bị và bảo trì trong cùng hệ thống vận hành.",
  },
  {
    title: "Nhân sự và phân quyền",
    copy: "Phân quyền theo tổ chức và phòng khám, hỗ trợ nhiều vai trò cho cùng một nhân sự.",
  },
  {
    title: "Biểu mẫu, báo cáo và ứng dụng đi kèm",
    copy: "Kết nối biểu mẫu, consent, báo cáo, ứng dụng bệnh nhân và ứng dụng nhân viên với dữ liệu vận hành cốt lõi.",
  },
];

export async function generateMetadata(): Promise<Metadata> {
  const hostname = await currentHostname();
  return systemSubdomainFromHostname(hostname) === "odontogram"
    ? odontogramMetadata
    : marketingMetadata;
}

type HomePageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const hostname = await currentHostname();
  const systemSubdomain = systemSubdomainFromHostname(hostname);
  const tenantSlug = tenantSlugFromHostname(hostname);

  if (systemSubdomain === "docs") {
    redirect("/docs");
  }

  if (systemSubdomain === "odontogram") {
    return <PublicOdontogram />;
  }

  if (systemSubdomain === "demo") {
    const params = await searchParams;
    return (
      <DemoLanding
        enabled={demoWorkspaceEnabled()}
        error={params?.error}
        homeUrl={`https://${appRootDomain()}`}
      />
    );
  }

  if (
    tenantSlug ||
    systemSubdomain === "app" ||
    systemSubdomain === "admin"
  ) {
    redirect("/dashboard");
  }

  const demoUrl = isLocalHostname(hostname)
    ? "/demo"
    : `https://demo.${appRootDomain()}`;
  const sourceUrl =
    process.env.NEXT_PUBLIC_SOURCE_REPOSITORY_URL?.trim() || "/docs#source";

  return (
    <main className={styles.landingShell}>
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/" aria-label="Dental OS - Trang chủ">
          Dental OS
        </Link>

        <nav className={styles.desktopNav} aria-label="Điều hướng chính">
          <a href="#san-pham">Sản phẩm</a>
          <a href="#ma-nguon-mo">Mã nguồn mở</a>
          <a href="#trien-khai">Triển khai</a>
          <Link href="/docs">Tài liệu</Link>
        </nav>

        <div className={styles.headerActions}>
          <a className={styles.headerSource} href={sourceUrl} data-qa="source-cta">
            <GitFork size={15} aria-hidden="true" />
            GitHub
          </a>
          <Link className={styles.headerCta} href={demoUrl} data-qa="demo-cta">
            Dùng thử
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>

        <details className={styles.mobileMenu} data-qa="mobile-menu">
          <summary aria-label="Mở điều hướng">Menu</summary>
          <div className={styles.mobileMenuPanel}>
            <nav aria-label="Điều hướng trên di động">
              <a href="#san-pham">Sản phẩm</a>
              <a href="#ma-nguon-mo">Mã nguồn mở</a>
              <a href="#trien-khai">Triển khai</a>
              <Link href="/docs" data-qa="docs-cta-mobile">Tài liệu</Link>
              <a href={sourceUrl}>GitHub</a>
            </nav>
            <Link className={styles.headerCta} href={demoUrl}>
              Dùng thử 24 giờ
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </details>
      </header>

      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroIntro}>
          <p className={styles.eyebrow}>Dental OS · Mã nguồn mở · Local-first</p>
          <h1 id="landing-title" data-qa="landing-hero-title">
            Một hệ điều hành cho công việc hằng ngày của phòng khám nha khoa.
          </h1>
          <p className={styles.heroLead}>
            Kết nối lịch hẹn, hồ sơ điều trị, thanh toán, kho và nhân sự trong một
            hệ thống thống nhất, có thể tự host và để phòng khám chủ động kiểm soát dữ liệu.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryCta} href={demoUrl}>
              Dùng thử đầy đủ 24 giờ
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <a className={styles.secondaryCta} href="#san-pham">
              Xem sản phẩm
            </a>
          </div>
        </div>

        <figure className={styles.heroFigure}>
          <div className={styles.productFrame}>
            <img
              src="/marketing/feature-schedule.png"
              alt="Màn hình lịch hẹn thực tế của Dental OS với lịch vận hành phòng khám"
              decoding="async"
              loading="eager"
              data-qa="landing-hero-screenshot"
            />
          </div>
          <figcaption>
            Ảnh chụp sản phẩm thực tế với dữ liệu demo: lịch hẹn và vận hành trong ngày.
          </figcaption>
        </figure>
      </section>

      <section className={styles.proofStrip} aria-label="Tín hiệu tin cậy có thể kiểm chứng">
        <a href={sourceUrl}>
          <strong>Mã nguồn mở</strong>
          <span>Kho mã nguồn công khai để kiểm tra và đóng góp.</span>
        </a>
        <Link href={demoUrl}>
          <strong>Demo công khai</strong>
          <span>Workspace trải nghiệm riêng với dữ liệu nha khoa giả lập.</span>
        </Link>
        <Link href="/docs" data-qa="docs-cta">
          <strong>Tài liệu công khai</strong>
          <span>Hướng dẫn cài đặt, mạng LAN, sao lưu, cập nhật và vận hành.</span>
        </Link>
        <Link href="/docs#quick-start">
          <strong>Có thể tự host</strong>
          <span>Chạy trên máy phòng khám, server hoặc NAS theo nhu cầu hạ tầng.</span>
        </Link>
      </section>

      <section className={styles.productStory} id="san-pham">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Một hệ thống vận hành liền mạch</p>
          <h2>Từ lịch hẹn đầu ngày đến điều trị và vận hành phía sau.</h2>
          <p>
            Dental OS được trình bày bằng chính sản phẩm: mỗi luồng công việc dùng chung
            bệnh nhân, phòng khám và quyền truy cập thay vì trở thành những công cụ rời rạc.
          </p>
        </div>

        <article className={styles.story}>
          <div className={styles.storyCopy}>
            <span className={styles.storyIndex}>01</span>
            <p className={styles.storyLabel}>Vận hành hằng ngày</p>
            <h3>Bắt đầu ngày làm việc với bối cảnh chung.</h3>
            <p>
              Lịch hẹn, trạng thái công việc và thông tin vận hành được đặt trong cùng
              hệ thống để đội ngũ không phải ghép lại bối cảnh từ nhiều phần mềm.
            </p>
          </div>
          <figure className={styles.storyFigure}>
            <img
              src="/marketing/dashboard-preview.png"
              alt="Màn hình tổng quan vận hành thực tế của Dental OS"
              decoding="async"
              loading="lazy"
            />
          </figure>
        </article>

        <article className={`${styles.story} ${styles.storyReverse}`}>
          <div className={styles.storyCopy}>
            <span className={styles.storyIndex}>02</span>
            <p className={styles.storyLabel}>Bệnh nhân và điều trị</p>
            <h3>Một hồ sơ chung để nối tiếp hành trình chăm sóc.</h3>
            <p>
              Thông tin hành chính, lịch hẹn và các luồng điều trị cùng bắt đầu từ một
              hồ sơ bệnh nhân, giúp nhân viên chuyển tiếp công việc mà không nhập lại dữ liệu.
            </p>
          </div>
          <figure className={styles.storyFigure}>
            <img
              src="/marketing/feature-patients.png"
              alt="Màn hình hồ sơ bệnh nhân thực tế của Dental OS"
              decoding="async"
              loading="lazy"
            />
          </figure>
        </article>

        <article className={styles.story}>
          <div className={styles.storyCopy}>
            <span className={styles.storyIndex}>03</span>
            <p className={styles.storyLabel}>Vận hành phía sau</p>
            <h3>Kho, thiết bị và tài chính không đứng ngoài quy trình lâm sàng.</h3>
            <p>
              Dental OS mở rộng từ công việc tại quầy và ghế điều trị tới vật tư,
              thiết bị, thanh toán và báo cáo để phòng khám có một nguồn vận hành thống nhất.
            </p>
          </div>
          <figure className={styles.storyFigure}>
            <img
              src="/marketing/feature-inventory.png"
              alt="Màn hình quản lý kho và thiết bị thực tế của Dental OS"
              decoding="async"
              loading="lazy"
            />
          </figure>
        </article>
      </section>

      <section className={styles.breadthSection}>
        <div className={styles.sectionIntroCompact}>
          <div>
            <p className={styles.eyebrow}>Phạm vi sản phẩm</p>
            <h2>Một nền tảng, nhiều công việc của phòng khám.</h2>
          </div>
          <div>
            <p>
              Không cần biến homepage thành danh sách hàng chục tính năng. Các capability
              chính được nhóm theo công việc thực tế và có hướng dẫn chi tiết riêng.
            </p>
            <Link className={styles.textLink} href="/features">
              Xem tính năng và hướng dẫn
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className={styles.breadthList}>
          {breadth.map((item) => (
            <div key={item.title}>
              <strong>{item.title}</strong>
              <p>{item.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.openSourceBand} id="ma-nguon-mo">
        <div className={styles.openSourceInner}>
          <div className={styles.openSourceCopy}>
            <p className={styles.eyebrow}>Open source và quyền sở hữu</p>
            <h2>Phòng khám có thể nhìn thấy phần mềm mình đang dựa vào.</h2>
            <p>
              Mã nguồn công khai giúp đội ngũ kỹ thuật kiểm tra, tự triển khai và đóng góp.
              Khi tự host, hạ tầng và dữ liệu vận hành nằm dưới sự kiểm soát của phòng khám
              thay vì bị ràng buộc vào một nhà cung cấp hạ tầng duy nhất.
            </p>
            <div className={styles.openSourceActions}>
              <a className={styles.primaryCta} href={sourceUrl}>
                Xem mã nguồn
                <GitFork size={17} aria-hidden="true" />
              </a>
              <Link className={styles.secondaryCta} href="/docs">
                Đọc tài liệu
              </Link>
            </div>
          </div>

          <ul className={styles.ownershipList}>
            <li>
              <GitFork size={17} aria-hidden="true" />
              <span>Nguồn code có thể kiểm tra và đóng góp công khai.</span>
            </li>
            <li>
              <Server size={17} aria-hidden="true" />
              <span>Tự host trên hạ tầng do phòng khám lựa chọn.</span>
            </li>
            <li>
              <ShieldCheck size={17} aria-hidden="true" />
              <span>Chủ động phạm vi dữ liệu và quyền truy cập trong hệ thống.</span>
            </li>
            <li>
              <DatabaseBackup size={17} aria-hidden="true" />
              <span>Sao lưu, phục hồi và cập nhật bằng quy trình được tài liệu hóa.</span>
            </li>
          </ul>
        </div>
      </section>

      <section className={styles.deploymentSection} id="trien-khai">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Triển khai linh hoạt</p>
          <h2>Chọn hạ tầng phù hợp với phòng khám, không biến cài đặt thành sản phẩm.</h2>
          <p>
            Homepage chỉ trình bày lựa chọn triển khai. Các lệnh kỹ thuật, yêu cầu hệ thống
            và quy trình nâng cấp nằm trong tài liệu cài đặt riêng.
          </p>
        </div>

        <div className={styles.deploymentRows}>
          <div>
            <Building2 size={24} aria-hidden="true" />
            <strong>Máy tại phòng khám</strong>
            <p>Phù hợp phòng khám nhỏ cần tự host trên máy Windows vận hành tại chỗ.</p>
          </div>
          <div>
            <Server size={24} aria-hidden="true" />
            <strong>Server hoặc NAS</strong>
            <p>Docker hỗ trợ triển khai tập trung hơn khi phòng khám có server hoặc NAS riêng.</p>
          </div>
          <div>
            <DatabaseBackup size={24} aria-hidden="true" />
            <strong>Truy cập LAN và sao lưu chủ động</strong>
            <p>Thiết bị trong mạng nội bộ có thể truy cập hệ thống, với quy trình backup và restore được tài liệu hóa.</p>
          </div>
        </div>

        <Link className={styles.textLink} href="/docs#quick-start">
          Xem hướng dẫn triển khai
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </section>

      <section className={styles.trustSection}>
        <div className={styles.sectionIntroCompact}>
          <div>
            <p className={styles.eyebrow}>Tin cậy bằng những gì có thể kiểm tra</p>
            <h2>Không cần logo khách hàng hay con số giả để tạo cảm giác uy tín.</h2>
          </div>
          <p>
            Dental OS ưu tiên tín hiệu thật: sản phẩm demo, mã nguồn, tài liệu triển khai,
            quản trị quyền truy cập và khả năng sao lưu trên hạ tầng do phòng khám kiểm soát.
          </p>
        </div>

        <div className={styles.trustList}>
          <div>
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <strong>Quyền truy cập được xử lý trong hệ thống</strong>
              <p>Vai trò và phạm vi phòng khám được dùng để giới hạn dữ liệu và thao tác.</p>
            </div>
          </div>
          <div>
            <DatabaseBackup size={18} aria-hidden="true" />
            <div>
              <strong>Backup và restore là một phần của vận hành self-host</strong>
              <p>Tài liệu dự án mô tả quy trình sao lưu, phục hồi và kiểm tra trước khi cập nhật.</p>
            </div>
          </div>
          <div>
            <GitFork size={18} aria-hidden="true" />
            <div>
              <strong>Phát triển minh bạch</strong>
              <p>Repository và tài liệu công khai cho phép kiểm tra trạng thái và cách sản phẩm vận hành.</p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.finalCta} aria-labelledby="final-cta-title">
        <div>
          <p className={styles.eyebrow}>Xem sản phẩm trước khi quyết định</p>
          <h2 id="final-cta-title">Trải nghiệm Dental OS bằng dữ liệu demo.</h2>
          <p>
            Mở workspace riêng trong 24 giờ hoặc xem repository và tài liệu trước khi triển khai.
          </p>
        </div>
        <div className={styles.finalActions}>
          <Link className={styles.finalPrimaryCta} href={demoUrl}>
            Dùng thử 24 giờ
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <a className={styles.finalSecondaryCta} href={sourceUrl}>
            Xem GitHub
          </a>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <strong>Dental OS</strong>
          <p>Hệ điều hành phòng khám nha khoa mã nguồn mở, local-first.</p>
        </div>
        <nav aria-label="Sản phẩm">
          <strong>Sản phẩm</strong>
          <a href="#san-pham">Tổng quan</a>
          <Link href="/features">Tính năng</Link>
          <Link href={demoUrl}>Demo</Link>
        </nav>
        <nav aria-label="Tài nguyên">
          <strong>Tài nguyên</strong>
          <Link href="/docs">Tài liệu</Link>
          <a href={sourceUrl}>GitHub</a>
          <a href="#ma-nguon-mo">Mã nguồn mở</a>
        </nav>
        <nav aria-label="Triển khai">
          <strong>Triển khai</strong>
          <a href="#trien-khai">Tùy chọn</a>
          <Link href="/docs#quick-start">Quick start</Link>
          <Link href="/docs#backup">Sao lưu</Link>
        </nav>
      </footer>
    </main>
  );
}
