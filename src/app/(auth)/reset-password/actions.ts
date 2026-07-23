"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { resetPasswordWithToken } from "@/lib/password-reset";
import { consumePasswordResetAttempt } from "@/lib/rate-limit";

export async function resetPasswordAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const limit = consumePasswordResetAttempt(await resetRateLimitKey(token));

  if (!limit.allowed) {
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

async function resetRateLimitKey(token: string) {
  const headerStore = await headers();
  const forwardedFor = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headerStore.get("x-real-ip")?.trim();
  const ip = forwardedFor || realIp || "unknown";

  return `${ip}:reset:${token.slice(0, 16)}`;
}
