import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { trialSignupEnabled } from "@/lib/env";
import { createTrialAccountAction } from "./actions";
import styles from "./signup.module.css";

export const metadata: Metadata = {
  title: "Dùng thử miễn phí 30 ngày | Codexdentist",
  description:
    "Tạo tài khoản Codexdentist cho phòng khám và dùng thử miễn phí trong 30 ngày.",
};

type SignupPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  if (!trialSignupEnabled()) {
    notFound();
  }

  const params = await searchParams;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Codexdentist - Trang chủ">
          <img src="/icons/codexmed-icon.svg" width="34" height="34" alt="" />
          <span>codexdentist<span>.</span></span>
        </Link>
        <Link className={styles.loginLink} href="/login">
          Đã có tài khoản? <strong>Đăng nhập</strong>
        </Link>
      </header>

      <section className={styles.layout}>
        <div className={styles.formCard}>
          <div className={styles.formHeading}>
            <h1>Tạo tài khoản phòng khám</h1>
          </div>

          {params?.error && (
            <p className={styles.error} role="alert">
              {signupErrorText(params.error)}
            </p>
          )}

          <form action={createTrialAccountAction} className={styles.form}>
            <label>
              <span>Tên phòng khám</span>
              <input
                name="clinicName"
                autoComplete="organization"
                placeholder="Ví dụ: Nha khoa An Nhiên"
                required
              />
            </label>
            <label>
              <span>Tỉnh / thành phố</span>
              <input
                name="city"
                autoComplete="address-level1"
                placeholder="Hà Nội"
                required
              />
            </label>
            <label>
              <span>Họ tên của bạn</span>
              <input
                name="ownerFullName"
                autoComplete="name"
                placeholder="Nguyễn Minh Anh"
                required
              />
            </label>
            <label>
              <span>Email đăng nhập</span>
              <input
                name="ownerEmail"
                type="email"
                autoComplete="email"
                placeholder="you@clinic.vn"
                required
              />
            </label>
            <div className={styles.passwordGrid}>
              <label>
                <span>Mật khẩu</span>
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label>
                <span>Nhập lại mật khẩu</span>
                <input
                  name="passwordConfirmation"
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </label>
            </div>

            <p className={styles.passwordHint}>
              <Check size={15} aria-hidden="true" /> Tối thiểu 12 ký tự.
            </p>

            <button className={styles.submit} type="submit">
              Tạo tài khoản dùng thử
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>

          <p className={styles.finePrint}>
            Thời gian dùng thử kéo dài 30 ngày kể từ lúc tạo tài khoản. Khi hết
            hạn, workspace dừng truy cập cho đến khi được chuyển sang gói sử dụng.
          </p>
        </div>
      </section>
    </main>
  );
}

function signupErrorText(error: string) {
  if (error === "password") {
    return "Mật khẩu cần có ít nhất 12 ký tự.";
  }

  if (error === "password-confirmation") {
    return "Hai lần nhập mật khẩu chưa giống nhau.";
  }

  if (error === "account-exists") {
    return "Email này đã thuộc một tài khoản. Hãy đăng nhập hoặc dùng email khác.";
  }

  if (error === "rate-limited") {
    return "Thiết bị này đã tạo quá nhiều tài khoản dùng thử hôm nay. Vui lòng thử lại sau.";
  }

  if (error === "invalid") {
    return "Hãy kiểm tra lại các trường bắt buộc.";
  }

  return "Chưa thể tạo tài khoản dùng thử lúc này. Vui lòng thử lại sau.";
}
