import { trustedProxyProvider } from "@/lib/env";

export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const originUrl = new URL(origin);
    const provider = trustedProxyProvider();
    const forwardedHost = provider === "none"
      ? null
      : request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || null;
    const forwardedProtocol = provider === "none"
      ? null
      : request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() || null;
    const requestUrl = new URL(request.url);
    const expectedHost = (forwardedHost ?? host.trim()).toLowerCase();
    const expectedProtocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;

    return (
      ["http:", "https:"].includes(expectedProtocol) &&
      originUrl.host === expectedHost &&
      originUrl.protocol === expectedProtocol
    );
  } catch {
    return false;
  }
}
