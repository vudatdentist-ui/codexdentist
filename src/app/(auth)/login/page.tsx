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
          <p className="eyebrow">Staff access</p>
          <h1>Sign in to Codexdentist</h1>
        </div>

        {params?.error && (
          <p className="login-error">
            {loginErrorText(params.error)}
          </p>
        )}
        {params?.reset === "success" && (
          <p className="login-success">
            Password saved. Sign in with the new password.
          </p>
        )}
        {params?.forgot === "sent" && (
          <p className="login-success">
            If that email belongs to an active account, a password reset link has been sent.
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
            Password
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
            Sign in
          </button>
        </form>

        <details className="forgot-password-panel">
          <summary>Forgot password?</summary>
          <form action={forgotPasswordAction} className="login-form">
            <label>
              Account email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </label>
            <button className="secondary-button" type="submit">
              Send reset link
            </button>
          </form>
        </details>

        {showDemoAccounts && (
          <div className="demo-accounts">
            <strong>Demo accounts</strong>
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
    return "Sign-in is temporarily unavailable. Please try again later.";
  }

  if (error === "rate-limited") {
    return "Too many sign-in attempts. Wait a few minutes, then try again.";
  }

  if (error === "password-change-required") {
    return "This account needs a password setup link from an administrator.";
  }

  if (error === "tenant-not-found") {
    return "This system subdomain is not registered.";
  }

  if (error === "expired") {
    return "This demo workspace has expired. Start a new 24-hour demo.";
  }

  return "Email or password is not valid.";
}
