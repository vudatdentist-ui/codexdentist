"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { resetPasswordWithToken } from "@/lib/password-reset";
import { consumePasswordResetAttempt } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/request-ip";

export async function resetPasswordAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const limits = await Promise.all(
    (await resetRateLimitKeys(token)).map((key) =>
      consumePasswordResetAttempt(key),
    ),
  );

  if (limits.some((limit) => !limit.allowed)) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=rate-limited`);
  }

  if (!token || !password || password !== confirmPassword) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=invalid`);
  }

  const result = await resetPasswordWithToken({ token, password });

  if (!result.ok) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${result.reason}`);
  }

  redirect("/login?reset=success");
}

async function resetRateLimitKeys(token: string) {
  const headerStore = await headers();
  const ip = clientIpFromHeaders(headerStore);
  const tokenPrefix = token.slice(0, 16);

  return [`network:${ip}:reset:${tokenPrefix}`, `token:${tokenPrefix}`];
}
