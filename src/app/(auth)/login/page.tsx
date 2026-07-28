import { LockKeyhole } from "lucide-react";
import { demoAuthEnabled } from "@/lib/env";
import { forgotPasswordAction, loginAction } from "./actions";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    forgot?: string;
    reset?: string;
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
      <section className="login-panel">
        <div className="brand login-brand">
          <div className="brand-mark">
            <img src="/icons/codexmed-icon.svg" alt="" aria-hidden="true" />
          </div>
          <div>
            <strong>Codexdentist</strong>
            <span>SMART DENTAL SOLUTIONS</span>
          </div>
        </div>

        <div>
          <p className="eyebrow">Dành cho nhân sự</p>
          <h1>Đăng nhập Codexdentist</h1>
        </div>

        {params?.error && (
          <p className="login-error">
            {loginErrorText(params.error)}
          </p>
        )}
        {params?.reset === "success" && (
          <p className="login-success">
            Đã lưu mật khẩu. Hãy đăng nhập bằng mật khẩu mới.
          </p>
        )}
        {params?.forgot === "sent" && (
          <p className="login-success">
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
    return "Không gian dùng thử đã hết hạn. Hãy tạo một phiên dùng thử 24 giờ mới.";
  }

  return "Email hoặc mật khẩu không đúng.";
}
