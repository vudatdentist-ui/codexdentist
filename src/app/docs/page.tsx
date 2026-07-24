import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  DatabaseBackup,
  Download,
  ExternalLink,
  GitBranch,
  HardDrive,
  Laptop,
  Network,
  PlayCircle,
  Power,
  RefreshCw,
  Router,
  Server,
  ShieldCheck,
  Stethoscope,
  TerminalSquare,
  Wifi,
  Wrench,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CopyCodeButton } from "./CopyCodeButton";
import styles from "../marketing.module.css";

export const metadata: Metadata = {
  title: "Hướng dẫn cài đặt từng bước | Codexdentist",
  description:
    "Hướng dẫn chi tiết dành cho phòng khám tự cài Codexdentist trên Windows, truy cập qua mạng LAN, sao lưu và cập nhật.",
};

const repositoryUrl = "https://github.com/vudatdentist-ui/codexdentist";

const commands = [
  ["Khởi động", "npm run codexdentist -- start"],
  ["Dừng", "npm run codexdentist -- stop"],
  ["Xem trạng thái", "npm run codexdentist -- status"],
  ["Kiểm tra và xem địa chỉ", "npm run codexdentist -- doctor"],
  ["Sao lưu", "npm run codexdentist -- backup"],
  ["Cập nhật", "npm run codexdentist -- update"],
];

const cloneCommands = `cd $HOME\\Documents
git clone https://github.com/vudatdentist-ui/codexdentist.git
cd codexdentist`;

const installCommands = `Set-ExecutionPolicy -Scope Process Bypass -Force
.\\install.ps1`;

const verifyToolsCommands = `node --version
git --version
docker version
docker compose version`;

const firewallCommand = `New-NetFirewallRule -DisplayName "Codexdentist LAN" \`
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 \`
  -Profile Private -RemoteAddress LocalSubnet`;

export default function DocsPage() {
  const sourceUrl =
    process.env.NEXT_PUBLIC_SOURCE_REPOSITORY_URL?.trim() || repositoryUrl;

  return (
    <main className={styles.publicShell}>
      <header className={styles.publicHeader}>
        <Link className={styles.wordmark} href="/">
          <img src="/icons/codexmed-icon.svg" alt="" />
          <span>Codexdentist Docs</span>
        </Link>
        <nav aria-label="Điều hướng tài liệu cài đặt">
          <a href="#downloads">Tải công cụ</a>
          <a href="#windows-install">Cài trên Windows</a>
          <a href="#lan">Mạng LAN</a>
          <a href="#backup">Sao lưu</a>
        </nav>
        <Link className={styles.textLink} href="/">
          <ArrowLeft size={15} />
          Trang chủ
        </Link>
      </header>

      <div className={styles.docsLayout}>
        <aside className={styles.docsNav}>
          <strong>Làm theo thứ tự</strong>
          <a href="#before-start">1. Kiểm tra máy</a>
          <a href="#downloads">2. Tải công cụ</a>
          <a href="#windows-install">3. Cài trên Windows</a>
          <a href="#first-run">4. Tạo phòng khám</a>
          <a href="#lan">5. Kết nối thiết bị</a>
          <a href="#daily">6. Dùng hằng ngày</a>
          <a href="#backup">7. Sao lưu</a>
          <a href="#update">8. Cập nhật</a>
          <a href="#troubleshooting">Xử lý sự cố</a>
          <a href="#advanced">Linux và NAS</a>
          <a href="#security">Bảo mật</a>
        </aside>

        <article className={styles.docsArticle}>
          <header>
            <p className={styles.kicker}>Hướng dẫn cho người mới</p>
            <h1>Tự cài Codexdentist tại phòng khám</h1>
            <p>
              Chỉ một máy tính cần cài phần mềm và đóng vai trò máy chủ. Máy tính,
              máy tính bảng và điện thoại còn lại chỉ cần trình duyệt và dùng
              chung mạng Wi-Fi hoặc mạng dây của phòng khám.
            </p>
            <div className={styles.docsHeroFacts}>
              <span><Laptop size={17} /> Windows 10/11, máy Intel hoặc AMD</span>
              <span><HardDrive size={17} /> RAM từ 8 GB, trống từ 20 GB</span>
              <span><Wifi size={17} /> Không cần mua cloud để dùng trong LAN</span>
            </div>
            <div className={styles.docsPrimaryActions}>
              <a className={styles.primaryCta} href="#before-start">
                Bắt đầu từ bước 1
              </a>
              <a
                className={styles.secondaryCta}
                href="https://demo.codexdentist.com"
              >
                Dùng thử trước khi cài
                <ExternalLink size={16} />
              </a>
            </div>
          </header>

          <section id="before-start">
            <span className={styles.docsIcon}><Laptop size={22} /></span>
            <p className={styles.docsSectionLabel}>Bước 1</p>
            <h2>Chọn máy làm máy chủ</h2>
            <p>
              Nên chọn máy cố định, có dây mạng nếu có thể, ít bị mang ra khỏi
              phòng khám và có thể bật trong toàn bộ giờ làm việc.
            </p>
            <div className={styles.requirementsList}>
              <div>
                <strong>Windows</strong>
                <span>Windows 10 64-bit build 19045 trở lên hoặc Windows 11 64-bit.</span>
              </div>
              <div>
                <strong>Phần cứng</strong>
                <span>CPU Intel/AMD 64-bit, RAM tối thiểu 8 GB, còn trống ít nhất 20 GB.</span>
              </div>
              <div>
                <strong>Ảo hóa</strong>
                <span>Task Manager → Performance → CPU phải hiện “Virtualization: Enabled”.</span>
              </div>
              <div>
                <strong>Tài khoản Windows</strong>
                <span>Cần quyền quản trị một lần để bật WSL và cấu hình tường lửa.</span>
              </div>
            </div>
            <div className={styles.docsCallout}>
              <CircleAlert size={20} />
              <div>
                <strong>Không dùng máy quá yếu hoặc ổ đĩa gần đầy</strong>
                <p>
                  Docker Desktop hiện yêu cầu 8 GB RAM trên Windows. Máy 4 GB có
                  thể phù hợp với Linux/NAS nhưng không nên dùng cho Windows.
                </p>
              </div>
            </div>
          </section>

          <section id="downloads">
            <span className={styles.docsIcon}><Download size={22} /></span>
            <p className={styles.docsSectionLabel}>Bước 2</p>
            <h2>Tải đúng 4 công cụ và mã nguồn</h2>
            <p>
              Chỉ tải từ các liên kết dưới đây. Không tải lại từ website chia sẻ
              phần mềm, Google Drive hoặc các trang gắn nút “Download” không rõ
              nguồn.
            </p>

            <div className={styles.downloadList}>
              <DownloadRow
                index="01"
                title="WSL 2 của Microsoft"
                description="Lớp Linux tích hợp trong Windows để Docker chạy ứng dụng. Không cần tải file riêng; cài bằng một lệnh ở bước tiếp theo."
                href="https://learn.microsoft.com/windows/wsl/install"
                action="Hướng dẫn chính thức"
                meta="Nguồn: Microsoft Learn"
              />
              <DownloadRow
                index="02"
                title="Docker Desktop cho Windows"
                description="Chạy ứng dụng và cơ sở dữ liệu trong các container tách biệt. Chọn bản Windows x86_64 cho hầu hết máy Intel/AMD."
                href="https://docs.docker.com/desktop/setup/install/windows-install/"
                action="Tải Docker Desktop"
                meta="Nguồn: Docker Docs"
              />
              <DownloadRow
                index="03"
                title="Node.js 22 LTS cho Windows x64"
                description="Dùng để chạy trình cài và các lệnh quản trị Codexdentist. Dự án hiện yêu cầu đúng dòng Node.js 22."
                href="https://nodejs.org/download/release/v22.23.1/node-v22.23.1-x64.msi"
                action="Tải Node.js 22.23.1 (.msi)"
                sourceHref="https://nodejs.org/download/release/latest-v22.x/"
                meta="Nguồn: nodejs.org"
              />
              <DownloadRow
                index="04"
                title="Git for Windows x64"
                description="Tải mã nguồn lần đầu và nhận bản cập nhật về sau. Khi cài, có thể giữ nguyên toàn bộ lựa chọn mặc định."
                href="https://git-scm.com/install/windows"
                action="Tải Git for Windows"
                meta="Nguồn: git-scm.com"
              />
              <DownloadRow
                index="05"
                title="Mã nguồn Codexdentist"
                description="Repository công khai chính thức. Luồng cài bên dưới dùng Git để tải nên chưa cần bấm Download ZIP."
                href={sourceUrl}
                action="Mở repository"
                sourceHref="https://github.com/vudatdentist-ui/codexdentist/releases"
                sourceLabel="Xem các bản phát hành"
                meta="Nguồn: GitHub vudatdentist-ui/codexdentist"
              />
            </div>
          </section>

          <section id="windows-install">
            <span className={styles.docsIcon}><TerminalSquare size={22} /></span>
            <p className={styles.docsSectionLabel}>Bước 3</p>
            <h2>Cài trên Windows theo từng bước</h2>

            <ol className={styles.installSteps}>
              <Step number="01" title="Bật WSL 2">
                <p>
                  Nhấn Start, gõ <strong>PowerShell</strong>, bấm chuột phải và
                  chọn <strong>Run as administrator</strong>. Dán lệnh sau:
                </p>
                <CommandBlock label="PowerShell (Administrator)" value="wsl --install" />
                <p>Khởi động lại Windows khi được yêu cầu. Sau đó mở PowerShell quản trị và chạy:</p>
                <CommandBlock
                  label="Cập nhật và kiểm tra WSL"
                  value={`wsl --update
wsl --version`}
                />
                <ExpectedResult>
                  Có thông tin phiên bản WSL. Docker yêu cầu WSL 2.1.5 trở lên.
                </ExpectedResult>
              </Step>

              <Step number="02" title="Cài và mở Docker Desktop">
                <p>
                  Chạy file <strong>Docker Desktop Installer.exe</strong>. Chọn
                  chế độ cài cho người dùng hiện tại nếu được hỏi và giữ tùy chọn
                  dùng <strong>WSL 2</strong>. Sau khi cài, mở Docker Desktop từ
                  Start Menu và chờ ứng dụng báo Docker Engine đã chạy.
                </p>
                <ExpectedResult>
                  Biểu tượng Docker xuất hiện ở khay hệ thống và màn hình Docker
                  Desktop không còn trạng thái “Starting”.
                </ExpectedResult>
              </Step>

              <Step number="03" title="Cài Node.js 22 và Git">
                <p>
                  Chạy lần lượt file Node.js `.msi` và trình cài Git. Giữ lựa
                  chọn mặc định. Đóng toàn bộ cửa sổ PowerShell đang mở, mở lại
                  một PowerShell mới rồi dán:
                </p>
                <CommandBlock label="Kiểm tra 4 công cụ" value={verifyToolsCommands} />
                <ExpectedResult>
                  Dòng đầu bắt đầu bằng <code>v22.</code>; Git hiện số phiên bản;
                  hai lệnh Docker không báo lỗi kết nối.
                </ExpectedResult>
              </Step>

              <Step number="04" title="Tải Codexdentist về thư mục Documents">
                <p>
                  Mở PowerShell bình thường, không cần quyền quản trị. Dán nguyên
                  khối lệnh:
                </p>
                <CommandBlock label="Tải mã nguồn" value={cloneCommands} />
                <ExpectedResult>
                  PowerShell đang đứng tại thư mục
                  <code> C:\Users\Tên-của-bạn\Documents\codexdentist</code>.
                </ExpectedResult>
                <p className={styles.docsFinePrint}>
                  Nếu Git báo thư mục <code>codexdentist</code> đã tồn tại, không
                  clone lần nữa. Dùng lệnh
                  <code> cd $HOME\Documents\codexdentist</code>.
                </p>
              </Step>

              <Step number="05" title="Chạy trình cài Codexdentist">
                <p>
                  Bảo đảm Docker Desktop vẫn đang mở. Trong PowerShell tại thư
                  mục <code>codexdentist</code>, dán:
                </p>
                <CommandBlock label="Cài ứng dụng" value={installCommands} />
                <p>
                  Lần đầu Docker phải tải và dựng ứng dụng nên có thể mất nhiều
                  phút. Không đóng PowerShell, không tắt máy và không ngắt mạng.
                </p>
                <ExpectedResult>
                  Cuối quá trình xuất hiện <code>Local: http://127.0.0.1:3000</code>
                  và ít nhất một địa chỉ <code>LAN: http://192.168...:3000</code>.
                </ExpectedResult>
              </Step>
            </ol>

            <div className={`${styles.docsCallout} ${styles.docsCalloutWarning}`}>
              <CircleAlert size={20} />
              <div>
                <strong>Nếu cổng 3000 đã được phần mềm khác sử dụng</strong>
                <p>
                  Trước lần cài đầu tiên, chạy
                  <code> $env:CODEXDENTIST_PORT=&quot;3317&quot;</code> rồi chạy lại
                  <code> .\install.ps1</code>. Các địa chỉ sau đó sẽ kết thúc bằng
                  <code>:3317</code>.
                </p>
              </div>
            </div>
          </section>

          <section id="first-run">
            <span className={styles.docsIcon}><Stethoscope size={22} /></span>
            <p className={styles.docsSectionLabel}>Bước 4</p>
            <h2>Tạo phòng khám và tài khoản đầu tiên</h2>
            <ol className={styles.plainSteps}>
              <li>Mở Chrome hoặc Edge trên máy chủ.</li>
              <li>Truy cập <code>http://127.0.0.1:3000/setup</code>.</li>
              <li>Nhập tên hệ thống, tên phòng khám, họ tên và email của Chủ hệ thống.</li>
              <li>Tạo mật khẩu riêng, dài và không dùng chung với Wi-Fi hoặc email.</li>
              <li>Đăng nhập và vào <strong>Cài đặt</strong> để thêm ghế, dịch vụ và nhân sự.</li>
            </ol>
            <ExpectedResult>
              Sau khi tạo thành công, đường dẫn <code>/setup</code> tự khóa. Đây
              là hành vi đúng để người khác không thể tạo thêm Chủ hệ thống.
            </ExpectedResult>
          </section>

          <section id="lan">
            <span className={styles.docsIcon}><Router size={22} /></span>
            <p className={styles.docsSectionLabel}>Bước 5</p>
            <h2>Mở ứng dụng trên điện thoại và máy khác</h2>
            <p>
              Tất cả thiết bị phải kết nối cùng router. Không dùng mạng Wi-Fi
              khách vì nhiều router chặn các thiết bị nhìn thấy nhau.
            </p>
            <ol className={styles.installSteps}>
              <Step number="01" title="Xem địa chỉ LAN">
                <p>Mở PowerShell tại thư mục Codexdentist và chạy:</p>
                <CommandBlock
                  label="Lấy địa chỉ trong mạng nội bộ"
                  value={`cd $HOME\\Documents\\codexdentist
npm run codexdentist -- doctor`}
                />
                <ExpectedResult>
                  Ghi lại dòng dạng <code>LAN: http://192.168.1.25:3000</code>.
                  Địa chỉ thực tế trên máy của bạn có thể khác.
                </ExpectedResult>
              </Step>

              <Step number="02" title="Đặt mạng Windows là Private">
                <p>
                  Mở <strong>Settings → Network &amp; internet → Wi-Fi</strong>,
                  chọn mạng đang dùng và đặt <strong>Network profile type</strong>
                  thành <strong>Private network</strong>.
                </p>
                <a
                  className={styles.docsSourceLink}
                  href="https://support.microsoft.com/en-gb/windows/change-tcp-ip-settings-bd0a07af-15f5-cd6a-363f-ca2b6f391ace"
                >
                  Hướng dẫn mạng Public/Private của Microsoft
                  <ExternalLink size={14} />
                </a>
              </Step>

              <Step number="03" title="Chỉ khi thiết bị khác chưa truy cập được: mở tường lửa">
                <p>
                  Mở PowerShell bằng <strong>Run as administrator</strong> và
                  chạy lệnh dưới đây. Quy tắc chỉ cho phép máy trong mạng Private
                  nội bộ truy cập cổng 3000.
                </p>
                <CommandBlock label="PowerShell (Administrator)" value={firewallCommand} />
                <p className={styles.docsFinePrint}>
                  Nếu bạn cài ở cổng khác, thay <code>3000</code> bằng cổng đó.
                </p>
              </Step>

              <Step number="04" title="Mở địa chỉ LAN trên thiết bị còn lại">
                <p>
                  Nhập nguyên địa chỉ LAN vào Chrome hoặc Safari, gồm cả
                  <code> http://</code> và <code>:3000</code>. Không nhập địa chỉ
                  <code>127.0.0.1</code> trên điện thoại vì địa chỉ đó chỉ dùng
                  được ngay trên máy chủ.
                </p>
              </Step>
            </ol>

            <div className={`${styles.docsCallout} ${styles.docsCalloutWarning}`}>
              <ShieldCheck size={20} />
              <div>
                <strong>Không mở cổng 3000 trực tiếp ra Internet</strong>
                <p>
                  Không bật Port Forwarding trên router. Nếu cần truy cập từ
                  ngoài phòng khám, hãy dùng VPN hoặc HTTPS do người có kỹ thuật
                  cấu hình.
                </p>
              </div>
            </div>
          </section>

          <section id="daily">
            <span className={styles.docsIcon}><Power size={22} /></span>
            <p className={styles.docsSectionLabel}>Bước 6</p>
            <h2>Mở lại ứng dụng mỗi ngày</h2>
            <p>
              Trong Docker Desktop, bật tùy chọn khởi động cùng Windows. Sau khi
              máy chủ được bật và Docker Desktop chạy xong, các container được
              cấu hình tự khởi động lại.
            </p>
            <div className={styles.commandTable}>
              {commands.map(([label, command]) => (
                <div key={label}>
                  <strong>{label}</strong>
                  <code>{command}</code>
                </div>
              ))}
            </div>
            <div className={styles.docsCallout}>
              <PlayCircle size={20} />
              <div>
                <strong>Khi ứng dụng không mở sau khi restart máy</strong>
                <p>
                  Mở Docker Desktop, chờ Docker Engine chạy, rồi vào thư mục
                  Codexdentist và dùng lệnh <code>npm run codexdentist -- start</code>.
                </p>
              </div>
            </div>
          </section>

          <section id="backup">
            <span className={styles.docsIcon}><DatabaseBackup size={22} /></span>
            <p className={styles.docsSectionLabel}>Bước 7</p>
            <h2>Sao lưu dữ liệu phòng khám</h2>
            <p>
              Backup gồm cơ sở dữ liệu và toàn bộ tệp bệnh nhân. Tạo backup hằng
              ngày và chép cả thư mục kết quả sang USB, ổ cứng ngoài hoặc một máy
              khác. Backup nằm trên cùng máy chủ không bảo vệ được khi ổ cứng hỏng.
            </p>
            <CommandBlock
              label="Tạo một bản sao lưu"
              value={`cd $HOME\\Documents\\codexdentist
npm run codexdentist -- backup`}
            />
            <ExpectedResult>
              PowerShell in đường dẫn dạng
              <code> backups\codexdentist-YYYYMMDD...</code>. Bên trong phải có
              <code> postgres.dump</code> và <code>patient-files.tar.gz</code>.
            </ExpectedResult>

            <h3 className={styles.docsSubheading}>Khôi phục khi thật sự cần</h3>
            <p>
              Khôi phục sẽ thay dữ liệu hiện tại bằng nội dung trong backup. Hãy
              tạo thêm một backup mới trước, dừng người dùng nhập liệu và thay
              tên thư mục mẫu bằng tên backup thực tế.
            </p>
            <CommandBlock
              label="Lệnh khôi phục có xác nhận"
              value={`npm run codexdentist -- restore ".\\backups\\codexdentist-YYYYMMDD-HHMMSS" --confirm`}
            />
          </section>

          <section id="update">
            <span className={styles.docsIcon}><RefreshCw size={22} /></span>
            <p className={styles.docsSectionLabel}>Bước 8</p>
            <h2>Cập nhật lên phiên bản mới</h2>
            <p>
              Chỉ cập nhật khi phòng khám tạm ngừng nhập liệu. Quy trình dưới đây
              kiểm tra mã nguồn, tải thay đổi, tự backup rồi dựng lại ứng dụng.
            </p>
            <CommandBlock
              label="Kiểm tra trước khi cập nhật"
              value={`cd $HOME\\Documents\\codexdentist
git status --short`}
            />
            <ExpectedResult>
              Nếu lệnh không in ra dòng nào, có thể tiếp tục. Nếu có tên file
              xuất hiện, dừng lại và nhờ hỗ trợ để tránh mất thay đổi cục bộ.
            </ExpectedResult>
            <CommandBlock
              label="Tải và áp dụng bản mới"
              value={`git pull --ff-only
npm run codexdentist -- update
npm run codexdentist -- doctor`}
            />
            <p>
              Lệnh <code>update</code> tự tạo backup trước khi thay ứng dụng.
              Chỉ kết thúc khi <code>doctor</code> báo health thành công.
            </p>
          </section>

          <section id="troubleshooting">
            <span className={styles.docsIcon}><Wrench size={22} /></span>
            <h2>Xử lý các lỗi thường gặp</h2>
            <div className={styles.troubleshootingList}>
              <TroubleshootingItem
                title="Báo “Docker chưa chạy”"
                answer="Mở Docker Desktop, chờ trạng thái Engine running rồi chạy lại lệnh. Nếu Docker đứng ở Starting, chạy wsl --update trong PowerShell quản trị và restart Windows."
              />
              <TroubleshootingItem
                title="node --version không bắt đầu bằng v22"
                answer="Gỡ bản Node.js khác trong Settings → Apps, cài lại Node.js 22 từ link ở trên, đóng và mở lại PowerShell."
              />
              <TroubleshootingItem
                title="PowerShell chặn install.ps1"
                answer="Chạy Set-ExecutionPolicy -Scope Process Bypass -Force trong đúng cửa sổ PowerShell rồi chạy lại .\\install.ps1. Quyền này chỉ tồn tại trong cửa sổ hiện tại."
              />
              <TroubleshootingItem
                title="Máy chủ mở được nhưng điện thoại không mở được"
                answer="Kiểm tra hai thiết bị dùng cùng Wi-Fi, không dùng mạng khách, mạng Windows là Private, dùng địa chỉ LAN từ lệnh doctor và mở quy tắc tường lửa ở bước 5."
              />
              <TroubleshootingItem
                title="Trang /setup không còn mở"
                answer="Nếu phòng khám đầu tiên đã được tạo thì đây là hành vi đúng. Đăng nhập bằng tài khoản Chủ hệ thống đã tạo."
              />
              <TroubleshootingItem
                title="Cài đặt dừng vì hết dung lượng"
                answer="Không xóa thư mục backups hoặc Docker volumes nếu chưa có bản sao. Giải phóng tệp cá nhân hoặc chuyển dữ liệu Docker sang ổ lớn hơn rồi mới thử lại."
              />
            </div>

            <h3 className={styles.docsSubheading}>Thông tin cần gửi khi nhờ hỗ trợ</h3>
            <CommandBlock
              label="Chạy và gửi lại phần kết quả"
              value={`npm run codexdentist -- status
npm run codexdentist -- doctor
docker compose --env-file .env.selfhost -f compose.selfhost.yml logs --tail 100 app`}
            />
            <p className={styles.docsFinePrint}>
              Không gửi file <code>.env.selfhost</code>, database dump, mật khẩu,
              ảnh bệnh nhân hoặc hồ sơ thật lên GitHub Issue hay nhóm công khai.
            </p>
          </section>

          <section id="advanced">
            <span className={styles.docsIcon}><Server size={22} /></span>
            <h2>Linux, NAS và macOS</h2>
            <p>
              Luồng này dành cho người quản trị máy chủ. Cài Docker Engine có
              Compose, Git và Node.js 22 từ nguồn chính thức của hệ điều hành,
              sau đó chạy:
            </p>
            <div className={styles.docsSourceList}>
              <a href="https://docs.docker.com/engine/install/">
                Docker Engine theo hệ điều hành <ExternalLink size={14} />
              </a>
              <a href="https://nodejs.org/download/release/latest-v22.x/">
                Node.js 22 chính thức <ExternalLink size={14} />
              </a>
              <a href="https://git-scm.com/install/">
                Git theo hệ điều hành <ExternalLink size={14} />
              </a>
            </div>
            <CommandBlock
              label="Linux hoặc macOS"
              value={`git clone https://github.com/vudatdentist-ui/codexdentist.git
cd codexdentist
chmod +x install.sh
./install.sh`}
            />
            <p>
              Linux/NAS nên có tối thiểu 4 GB RAM và 10 GB trống; vẫn khuyến nghị
              8 GB RAM và dung lượng lớn hơn nếu lưu nhiều ảnh, video hoặc file 3D.
            </p>
          </section>

          <section id="security">
            <span className={styles.docsIcon}><ShieldCheck size={22} /></span>
            <h2>Checklist trước khi nhập dữ liệu thật</h2>
            <ul className={styles.securityChecklist}>
              <li><CheckCircle2 size={17} /> Mật khẩu Chủ hệ thống là mật khẩu riêng.</li>
              <li><CheckCircle2 size={17} /> Máy chủ dùng tài khoản Windows có mật khẩu.</li>
              <li><CheckCircle2 size={17} /> Không mở cổng ứng dụng hoặc PostgreSQL ra Internet.</li>
              <li><CheckCircle2 size={17} /> Đã tạo backup và chép thử sang thiết bị khác.</li>
              <li><CheckCircle2 size={17} /> Đã thử mở app từ một thiết bị khác trong LAN.</li>
              <li><CheckCircle2 size={17} /> Đã phân quyền nhân viên theo đúng vai trò.</li>
            </ul>
          </section>

          <section id="source">
            <span className={styles.docsIcon}><GitBranch size={22} /></span>
            <h2>Mã nguồn và đóng góp</h2>
            <p>
              Codexdentist sử dụng giấy phép AGPL-3.0-or-later. Dùng repository
              chính thức để tải mã nguồn, xem release, báo lỗi và theo dõi thay đổi.
            </p>
            <div className={styles.docsPrimaryActions}>
              <a className={styles.primaryCta} href={sourceUrl}>
                Mở repository
                <ExternalLink size={16} />
              </a>
              <a
                className={styles.secondaryCta}
                href="https://github.com/vudatdentist-ui/codexdentist/releases"
              >
                Xem bản phát hành
                <ExternalLink size={16} />
              </a>
            </div>
          </section>
        </article>
      </div>
    </main>
  );
}

function DownloadRow({
  index,
  title,
  description,
  href,
  action,
  sourceHref,
  sourceLabel = "Xem danh sách phiên bản",
  meta,
}: {
  index: string;
  title: string;
  description: string;
  href: string;
  action: string;
  sourceHref?: string;
  sourceLabel?: string;
  meta: string;
}) {
  return (
    <div className={styles.downloadRow}>
      <span className={styles.downloadIndex}>{index}</span>
      <div className={styles.downloadBody}>
        <strong>{title}</strong>
        <p>{description}</p>
        <span>{meta}</span>
      </div>
      <div className={styles.downloadActions}>
        <a href={href}>
          {action}
          <ExternalLink size={14} />
        </a>
        {sourceHref ? (
          <a className={styles.docsSourceLink} href={sourceHref}>
            {sourceLabel}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className={styles.installStep}>
      <span>{number}</span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

function CommandBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.commandBlock}>
      <div>
        <span>{label}</span>
        <CopyCodeButton value={value} />
      </div>
      <pre><code>{value}</code></pre>
    </div>
  );
}

function ExpectedResult({ children }: { children: ReactNode }) {
  return (
    <div className={styles.expectedResult}>
      <CheckCircle2 size={17} />
      <div>
        <strong>Kết quả đúng</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

function TroubleshootingItem({
  title,
  answer,
}: {
  title: string;
  answer: string;
}) {
  return (
    <div>
      <strong>{title}</strong>
      <p>{answer}</p>
    </div>
  );
}
