import { KeyRound } from "lucide-react";
import { passwordRequirementsText } from "@/lib/password-reset";
import { resetPasswordAction } from "./actions";

type ResetPasswordPageProps = {
  searchParams?: Promise<{
    token?: string;
    error?: string;
  }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params?.token ?? "";

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
          <p className="eyebrow">Thiết lập tài khoản</p>
          <h1>Đặt mật khẩu nhân viên</h1>
          <span className="login-subtitle">Set your staff account password</span>
        </div>

        {params?.error && (
          <p className="login-error">{resetErrorText(params.error)}</p>
        )}

        {!token ? (
          <p className="login-error">Link thiết lập mật khẩu bị thiếu hoặc không hợp lệ.</p>
        ) : (
          <form action={resetPasswordAction} className="login-form">
            <input name="token" type="hidden" value={token} />
            <label>
              Mật khẩu mới
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                aria-describedby="password-requirements"
                autoFocus
                minLength={10}
                required
              />
            </label>
            <label>
              Xác nhận mật khẩu
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                aria-describedby="password-requirements"
                minLength={10}
                required
              />
            </label>
            <small className="login-help" id="password-requirements">
              {passwordRequirementsText("vi")} {passwordRequirementsText("en")}
            </small>
            <button className="primary-button" type="submit">
              <KeyRound size={16} />
              Lưu mật khẩu
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function resetErrorText(error: string) {
  if (error === "expired") {
    return "Link thiết lập đã hết hạn hoặc đã được sử dụng.";
  }

  if (error === "rate-limited") {
    return "Thử quá nhiều lần. Vui lòng chờ trước khi thử lại.";
  }

  return "Nhập hai mật khẩu trùng nhau và có tối thiểu 10 ký tự.";
}
