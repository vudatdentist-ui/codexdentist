import "server-only";

import { trustedProxyProvider } from "@/lib/env";

type HeaderReader = {
  get(name: string): string | null;
};

export function clientIpFromHeaders(headerStore: HeaderReader) {
  const provider = trustedProxyProvider();

  if (provider === "cloudflare") {
    return normalizeIp(headerStore.get("cf-connecting-ip")) ?? "unknown";
  }

  if (provider === "reverse-proxy") {
    const realIp = normalizeIp(headerStore.get("x-real-ip"));

    if (realIp) {
      return realIp;
    }

    return (
      normalizeIp(headerStore.get("x-forwarded-for")?.split(",")[0] ?? null) ??
      "unknown"
    );
  }

  return "unknown";
}

function normalizeIp(value: string | null) {
  const normalized = value?.trim() ?? "";

  if (
    !normalized ||
    normalized.length > 64 ||
    !/^[0-9a-f:.]+$/i.test(normalized)
  ) {
    return null;
  }

  return normalized;
}
