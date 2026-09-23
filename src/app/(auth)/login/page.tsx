import { LockKeyhole } from "lucide-react";
import { demoAuthEnabled } from "@/lib/env";
import { forgotPasswordAction, loginAction } from "./actions";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    forgot?: string;
    reset?: string;
    signup?: string;
  }>;
};

const demoAccounts = [
  "owner@nhavista.vn",
  "manager@nhavista.vn",
  "dentist@nhavista.vn",
  "frontdesk@nhavista.vn",
];

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const showDemoAccounts = demoAuthEnabled();

  return (
    <main className="login-shell">
      <section className="login-story" aria-label="Codexdentist">
        <div className="workspace-brand"><img src="/icons/codexmed-icon.svg" width="38" height="38" alt="" aria-hidden="true" /><div><strong>Codexdentist</strong><span>Sổ chăm sóc phòng khám</span></div></div>
        <h1>Mỗi lần hẹn,<br />một lần tiếp nối.</h1>
        <p>Lịch hẹn, bệnh án và công việc của đội ngũ trong cùng một không gian.</p>
        <ol><li><span>01</span>Chuẩn bị cho ngày làm việc</li><li><span>02</span>Theo suốt hành trình bệnh nhân</li><li><span>03</span>Khép lại và hẹn lần chăm sóc tiếp theo</li></ol>
      </section>
      <section className="login-panel">
        <div><h2>Đăng nhập</h2><p className="workspace-caption">Trở lại công việc của bạn.</p></div>

        {params?.error && (
          <p className="login-error" role="alert">
            {loginErrorText(params.error)}
          </p>
        )}
        {params?.reset === "success" && (
          <p className="login-success" role="status">
            Đã lưu mật khẩu. Hãy đăng nhập bằng mật khẩu mới.
          </p>
        )}
        {params?.signup === "created" && (
          <p className="login-success" role="status">
            Tài khoản dùng thử 30 ngày đã được tạo. Hãy đăng nhập để bắt đầu.
          </p>
        )}
        {params?.forgot === "sent" && (
          <p className="login-success" role="status">
            Nếu email thuộc tài khoản đang hoạt động, hệ thống đã gửi liên kết đặt lại mật khẩu.
          </p>
        )}

        <form action={loginAction} className="login-form">
          <label>
            Email
            <input
              name="email"
              type="email"
              defaultValue={showDemoAccounts ? "owner@nhavista.vn" : ""}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Mật khẩu
            <input
              name="password"
              type="password"
              defaultValue={showDemoAccounts ? "demo1234" : ""}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary-button" type="submit">
            <LockKeyhole size={16} />
            Đăng nhập
          </button>
        </form>

        <details className="forgot-password-panel">
          <summary>Quên mật khẩu?</summary>
          <form action={forgotPasswordAction} className="login-form">
            <label>
              Email tài khoản
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </label>
            <button className="secondary-button" type="submit">
              Gửi liên kết đặt lại mật khẩu
            </button>
          </form>
        </details>

        {showDemoAccounts && (
          <div className="demo-accounts">
            <strong>Tài khoản dùng thử</strong>
            {demoAccounts.map((account) => (
              <span key={account}>
                {account} / demo1234
              </span>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function loginErrorText(error: string) {
  if (error === "database") {
    return "Tạm thời chưa thể đăng nhập. Vui lòng thử lại sau.";
  }

  if (error === "rate-limited") {
    return "Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ vài phút rồi thử lại.";
  }

  if (error === "password-change-required") {
    return "Tài khoản này cần liên kết thiết lập mật khẩu từ quản trị viên.";
  }

  if (error === "tenant-not-found") {
    return "Tên miền phòng khám này chưa được đăng ký.";
  }

  if (error === "expired") {
    return "Không gian demo đã hết hạn.";
  }

  if (error === "trial-expired") {
    return "Thời gian dùng thử 30 ngày đã kết thúc. Vui lòng liên hệ để tiếp tục sử dụng không gian làm việc.";
  }

  return "Email hoặc mật khẩu không đúng.";
}
