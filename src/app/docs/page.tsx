import {
  ArrowLeft,
  CheckCircle2,
  DatabaseBackup,
  Download,
  RefreshCw,
  Server,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import styles from "../marketing.module.css";

export const metadata: Metadata = {
  title: "Tài liệu cài đặt | Codexdentist",
  description: "Cài đặt, cấu hình, sao lưu và cập nhật Codexdentist.",
};

const commands = [
  ["Cài đặt", "npm run codexdentist -- install"],
  ["Khởi động", "npm run codexdentist -- start"],
  ["Kiểm tra", "npm run codexdentist -- doctor"],
  ["Sao lưu", "npm run codexdentist -- backup"],
  ["Cập nhật", "npm run codexdentist -- update"],
];

export default function DocsPage() {
  const sourceUrl =
    process.env.NEXT_PUBLIC_SOURCE_REPOSITORY_URL?.trim() || null;

  return (
    <main className={styles.publicShell}>
      <header className={styles.publicHeader}>
        <Link className={styles.wordmark} href="/">
          <img src="/icons/codexmed-icon.svg" alt="" />
          <span>Codexdentist Docs</span>
        </Link>
        <Link className={styles.textLink} href="/">
          <ArrowLeft size={15} />
          Trang chủ
        </Link>
      </header>

      <div className={styles.docsLayout}>
        <aside className={styles.docsNav}>
          <strong>Bắt đầu</strong>
          <a href="#quick-start">Cài đặt nhanh</a>
          <a href="#first-run">Thiết lập lần đầu</a>
          <a href="#lan">Truy cập mạng LAN</a>
          <a href="#operations">Vận hành</a>
          <a href="#backup">Sao lưu và phục hồi</a>
          <a href="#security">Bảo mật</a>
          <a href="#source">Mã nguồn</a>
        </aside>

        <article className={styles.docsArticle}>
          <header>
            <p className={styles.kicker}>Self-hosting guide</p>
            <h1>Cài Codexdentist tại phòng khám</h1>
            <p>
              Hướng dẫn này dành cho một máy Windows, Linux hoặc NAS luôn bật
              trong mạng nội bộ. Các máy khác chỉ cần trình duyệt.
            </p>
          </header>

          <section id="quick-start">
            <span className={styles.docsIcon}><Download size={22} /></span>
            <h2>Cài đặt nhanh</h2>
            <p>Máy chủ cần Git, Node.js 22 LTS và Docker Desktop hoặc Docker Engine.</p>
            <pre><code>{`git clone <repository-url>
cd codexdentist
./install.sh

# Windows PowerShell: .\\install.ps1`}</code></pre>
            <p>
              Trình cài sẽ tạo `.env.selfhost`, sinh khóa bảo mật, dựng ứng dụng
              và chờ PostgreSQL sẵn sàng trước khi chạy migration.
            </p>
          </section>

          <section id="first-run">
            <span className={styles.docsIcon}><Stethoscope size={22} /></span>
            <h2>Thiết lập lần đầu</h2>
            <p>
              Mở <code>http://127.0.0.1:3000/setup</code> trên máy chủ. Tạo tên
              phòng khám, tài khoản Chủ hệ thống và mật khẩu đầu tiên. Trang này
              tự khóa sau khi tổ chức đầu tiên được tạo.
            </p>
          </section>

          <section id="lan">
            <span className={styles.docsIcon}><Server size={22} /></span>
            <h2>Truy cập trong mạng LAN</h2>
            <p>
              Chạy lệnh doctor để xem địa chỉ LAN. Điện thoại và máy tính phải
              dùng cùng Wi-Fi với máy chủ.
            </p>
            <pre><code>npm run codexdentist -- doctor</code></pre>
          </section>

          <section id="operations">
            <span className={styles.docsIcon}><RefreshCw size={22} /></span>
            <h2>Lệnh vận hành</h2>
            <div className={styles.commandTable}>
              {commands.map(([label, command]) => (
                <div key={label}>
                  <strong>{label}</strong>
                  <code>{command}</code>
                </div>
              ))}
            </div>
          </section>

          <section id="backup">
            <span className={styles.docsIcon}><DatabaseBackup size={22} /></span>
            <h2>Sao lưu và phục hồi</h2>
            <p>
              Backup gồm PostgreSQL và thư mục tệp bệnh nhân. Mỗi lần cập nhật
              đều tạo backup trước khi thay image hoặc chạy migration.
            </p>
            <pre><code>{`npm run codexdentist -- backup
npm run codexdentist -- restore <backup-folder> --confirm`}</code></pre>
          </section>

          <section id="security">
            <span className={styles.docsIcon}><ShieldCheck size={22} /></span>
            <h2>Nguyên tắc bảo mật</h2>
            <ul>
              <li><CheckCircle2 size={16} /> Không đưa `.env.selfhost` lên Git.</li>
              <li><CheckCircle2 size={16} /> Sao lưu ra thiết bị khác máy chủ.</li>
              <li><CheckCircle2 size={16} /> Không mở cổng PostgreSQL ra Internet.</li>
              <li><CheckCircle2 size={16} /> Dùng HTTPS khi truy cập từ bên ngoài mạng LAN.</li>
            </ul>
          </section>

          <section id="source">
            <span className={styles.docsIcon}><ShieldCheck size={22} /></span>
            <h2>Mã nguồn và đóng góp</h2>
            <p>
              Dự án sử dụng giấy phép AGPL-3.0-or-later. Bản triển khai sửa đổi
              được cung cấp qua mạng phải giữ quyền truy cập mã nguồn tương ứng.
            </p>
            {sourceUrl ? (
              <a className={styles.primaryCta} href={sourceUrl}>
                Mở repository
              </a>
            ) : (
              <p>Repository công khai đang được chuẩn bị cho bản beta đầu tiên.</p>
            )}
          </section>
        </article>
      </div>
    </main>
  );
}
