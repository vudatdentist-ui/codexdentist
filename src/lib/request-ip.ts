import "server-only";

import { deploymentMode } from "@/lib/env";

type HeaderReader = {
  get(name: string): string | null;
};

export function clientIpFromHeaders(headerStore: HeaderReader) {
  const cloudflareIp = normalizeIp(headerStore.get("cf-connecting-ip"));

  if (cloudflareIp) {
    return cloudflareIp;
  }

  const realIp = normalizeIp(headerStore.get("x-real-ip"));

  if (realIp) {
    return realIp;
  }

  if (deploymentMode() === "self-hosted") {
    const forwardedIp = normalizeIp(
      headerStore.get("x-forwarded-for")?.split(",")[0] ?? null,
    );

    if (forwardedIp) {
      return forwardedIp;
    }
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
