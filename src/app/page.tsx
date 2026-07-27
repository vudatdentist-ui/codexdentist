import {
  ArrowRight,
  Building2,
  CalendarDays,
  DatabaseBackup,
  GitFork,
  HeartPulse,
  PackageCheck,
  Server,
  ShieldCheck,
  UsersRound,
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
import styles from "./marketing.module.css";

const marketingMetadata: Metadata = {
  title: "Codexdentist - Phần mềm quản lý phòng khám nha khoa mã nguồn mở",
  description:
    "Quản lý lịch hẹn, hồ sơ bệnh nhân, điều trị, thu chi, kho và nhân sự trong một hệ thống có thể tự host.",
};

const odontogramMetadata: Metadata = {
  title: "Odontogram 5 mặt | Codexdentist",
  description:
    "Mô hình odontogram FDI tương tác với năm mặt răng Mesial, Distal, Buccal, Lingual và Occlusal hoặc Incisal.",
};

export async function generateMetadata(): Promise<Metadata> {
  const hostname = await currentHostname();
  return systemSubdomainFromHostname(hostname) === "odontogram"
    ? odontogramMetadata
    : marketingMetadata;
}

const workflows = [
  {
    icon: CalendarDays,
    title: "Lịch hẹn và vận hành ghế",
    copy: "Theo dõi lịch bác sĩ, trạng thái bệnh nhân và công việc trong ngày.",
  },
  {
    icon: HeartPulse,
    title: "Hồ sơ điều trị hợp nhất",
    copy: "Journey, odontogram, dịch vụ, ghi chú và chứng từ trên cùng timeline.",
  },
  {
    icon: PackageCheck,
    title: "Kho, thuốc và thiết bị",
    copy: "Quản lý nhóm, tag chuyên ngành, lô, hạn dùng và bảo trì.",
  },
  {
    icon: UsersRound,
    title: "Nhân sự và phân quyền",
    copy: "Một người có thể giữ nhiều vai trò theo từng phạm vi phòng khám.",
  },
];

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
    <main className={styles.publicShell}>
      <header className={styles.publicHeader}>
        <Link className={styles.wordmark} href="/">
          <img src="/icons/codexmed-icon.svg" alt="" />
          <span>Codexdentist</span>
        </Link>
        <nav aria-label="Điều hướng chính">
          <a href="#san-pham">Sản phẩm</a>
          <Link href="/features">Tính năng & hướng dẫn</Link>
          <a href="#cai-dat">Cài đặt</a>
          <Link href="/docs">Tài liệu</Link>
          <a href={sourceUrl}>
            GitHub
          </a>
        </nav>
        <Link className={styles.headerCta} href={demoUrl}>
          Dùng thử
          <ArrowRight size={16} />
        </Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Mã nguồn mở · Local-first · Dành cho nha khoa Việt Nam</p>
          <h1>Codexdentist</h1>
          <p className={styles.heroLead}>
            Hệ điều hành phòng khám nha khoa, kết nối lịch hẹn, hồ sơ điều trị,
            tài chính, kho và nhân sự trong một luồng làm việc thống nhất.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryCta} href={demoUrl}>
              Dùng thử đầy đủ 24 giờ
              <ArrowRight size={18} />
            </Link>
            <a className={styles.secondaryCta} href="#cai-dat">
              Cài trên máy phòng khám
              <Server size={17} />
            </a>
          </div>
          <div className={styles.heroSignals}>
            <span><ShieldCheck size={16} /> Dữ liệu thuộc về phòng khám</span>
            <span><DatabaseBackup size={16} /> Sao lưu và phục hồi chủ động</span>
          </div>
        </div>
        <div className={styles.heroCaption}>
          <span>Dashboard vận hành</span>
          <strong>Một màn hình cho công việc hôm nay</strong>
        </div>
      </section>

      <section className={styles.contextStrip} aria-label="Định hướng sản phẩm">
        <strong>Thiết kế cho phòng khám vừa và nhỏ</strong>
        <span>Không khóa dữ liệu</span>
        <span>Không bắt buộc cloud</span>
        <span>Truy cập qua máy tính và điện thoại trong mạng LAN</span>
      </section>

      <section className={styles.workflowBand} id="san-pham">
        <div className={styles.sectionHeading}>
          <p className={styles.kicker}>Một nguồn dữ liệu vận hành</p>
          <h2>Từ cuộc hẹn đầu tiên đến khi hoàn tất điều trị</h2>
          <p>
            Các module dùng chung bệnh nhân, phòng khám và quyền truy cập để nhân
            viên không phải nhập lại thông tin giữa nhiều phần mềm.
          </p>
        </div>
        <div className={styles.workflowGrid}>
          {workflows.map(({ icon: Icon, title, copy }, index) => (
            <article key={title}>
              <span className={styles.workflowIndex}>{String(index + 1).padStart(2, "0")}</span>
              <Icon size={24} />
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.installBand} id="cai-dat">
        <div className={styles.installCopy}>
          <p className={styles.kicker}>Tự host trong vài bước</p>
          <h2>Chạy tại phòng khám, sử dụng từ mọi thiết bị trong mạng LAN</h2>
          <p>
            Bộ cài tự tạo khóa bảo mật, khởi động PostgreSQL, chạy migration và
            mở trình thiết lập phòng khám lần đầu.
          </p>
          <div className={styles.installOptions}>
            <span><Building2 size={18} /> Windows cho phòng khám</span>
            <span><Server size={18} /> Docker cho máy chủ hoặc NAS</span>
            <span><DatabaseBackup size={18} /> Backup trước mỗi lần cập nhật</span>
          </div>
          <Link className={styles.primaryCta} href="/docs#quick-start">
            Xem hướng dẫn cài đặt
            <ArrowRight size={18} />
          </Link>
        </div>
        <div className={styles.terminalPreview} aria-label="Lệnh cài đặt nhanh">
          <div>
            <span />
            <span />
            <span />
            <strong>codexdentist / install</strong>
          </div>
          <pre><code>{`git clone <repository-url>
cd codexdentist
./install.sh

✓ PostgreSQL sẵn sàng
✓ Migration hoàn tất
✓ Codexdentist chạy tại :3000
→ Mở /setup để tạo phòng khám`}</code></pre>
        </div>
      </section>

      <section className={styles.opensourceBand}>
        <div>
          <GitFork size={30} />
          <p className={styles.kicker}>Open source</p>
          <h2>Có thể kiểm tra, tự triển khai và cùng phát triển</h2>
        </div>
        <p>
          Codexdentist hướng tới một nền tảng minh bạch cho cộng đồng nha khoa.
          Cấu hình AI, email và lưu trữ ngoài đều là tùy chọn; chức năng cốt lõi
          vẫn hoạt động trên hạ tầng do phòng khám kiểm soát.
        </p>
        <div className={styles.opensourceActions}>
          <a className={styles.primaryCta} href={sourceUrl}>
            Xem mã nguồn
            <GitFork size={18} />
          </a>
          <Link className={styles.secondaryCta} href="/docs">
            Đọc tài liệu
            <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      <footer className={styles.publicFooter}>
        <div className={styles.wordmark}>
          <img src="/icons/codexmed-icon.svg" alt="" />
          <span>Codexdentist</span>
        </div>
        <p>Phần mềm quản lý phòng khám nha khoa mã nguồn mở.</p>
        <nav>
          <Link href="/features">Hướng dẫn sử dụng</Link>
          <Link href="/docs">Tài liệu</Link>
          <Link href={demoUrl}>Demo</Link>
          <a href={sourceUrl}>GitHub</a>
        </nav>
      </footer>
    </main>
  );
}
