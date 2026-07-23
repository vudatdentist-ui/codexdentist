import { Building2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { completeFirstRunSetupAction } from "./actions";
import { deploymentMode } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import styles from "../marketing.module.css";

export const dynamic = "force-dynamic";

type SetupPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function SetupPage({ searchParams }: SetupPageProps) {
  if (deploymentMode() !== "self-hosted") {
    notFound();
  }

  if ((await prisma.organization.count()) > 0) {
    redirect("/login");
  }

  const params = await searchParams;

  return (
    <main className={styles.publicShell}>
      <header className={styles.publicHeader}>
        <Link className={styles.wordmark} href="/">
          <img src="/icons/codexmed-icon.svg" alt="" />
          <span>Codexdentist Setup</span>
        </Link>
      </header>

      <section className={styles.setupStage}>
        <div className={styles.setupIntro}>
          <p className={styles.kicker}>Thiết lập lần đầu</p>
          <h1>Tạo hệ thống cho phòng khám</h1>
          <p>
            Tài khoản được tạo ở bước này có toàn quyền quản trị. Trang thiết lập
            sẽ tự khóa ngay sau khi hoàn tất.
          </p>
          <span><ShieldCheck size={18} /> Mật khẩu tối thiểu 12 ký tự</span>
          <span><Building2 size={18} /> Có thể thêm chi nhánh sau trong Cài đặt</span>
        </div>

        <form action={completeFirstRunSetupAction} className={styles.setupForm}>
          <h2>Thông tin ban đầu</h2>
          {params?.error && (
            <p className={styles.publicError}>{setupErrorText(params.error)}</p>
          )}
          <label>
            Tên hệ thống hoặc công ty
            <input name="organizationName" required />
          </label>
          <label>
            Tên phòng khám đầu tiên
            <input name="clinicName" required />
          </label>
          <div className={styles.setupFormRow}>
            <label>
              Tỉnh, thành phố
              <input name="city" required />
            </label>
            <label>
              Địa chỉ
              <input name="address" required />
            </label>
          </div>
          <label>
            Họ tên Chủ hệ thống
            <input name="ownerFullName" autoComplete="name" required />
          </label>
          <label>
            Email đăng nhập
            <input name="ownerEmail" type="email" autoComplete="email" required />
          </label>
          <div className={styles.setupFormRow}>
            <label>
              Mật khẩu
              <input
                name="password"
                type="password"
                minLength={12}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Nhập lại mật khẩu
              <input
                name="passwordConfirmation"
                type="password"
                minLength={12}
                autoComplete="new-password"
                required
              />
            </label>
          </div>
          <button className={styles.primaryCta} type="submit">
            Tạo hệ thống
          </button>
        </form>
      </section>
    </main>
  );
}

function setupErrorText(error: string) {
  if (error === "password") {
    return "Mật khẩu cần có ít nhất 12 ký tự.";
  }

  if (error === "password-confirmation") {
    return "Hai lần nhập mật khẩu chưa giống nhau.";
  }

  if (error === "invalid") {
    return "Hãy kiểm tra lại các trường bắt buộc.";
  }

  return "Chưa thể hoàn tất thiết lập. Vui lòng thử lại.";
}
