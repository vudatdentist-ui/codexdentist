import { NextRequest, NextResponse } from "next/server";

const supportedMethods = new Set(["GET", "HEAD", "OPTIONS", "POST"]);

export function proxy(request: NextRequest) {
  if (!supportedMethods.has(request.method)) {
    return new NextResponse("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: [...supportedMethods].join(", "),
      },
    });
  }

  const host = hostnameFromHeader(request.headers.get("host"));
  const forwardedHost = hostnameFromHeader(
    request.headers.get("x-forwarded-host"),
  );

  if (
    !host ||
    !isTrustedRequestHostname(host) ||
    (forwardedHost !== null && !isTrustedRequestHostname(forwardedHost))
  ) {
    return new NextResponse("Misdirected Request", { status: 421 });
  }

  return NextResponse.next();
}

export function isTrustedRequestHostname(hostname: string) {
  const host = hostnameFromHeader(hostname);

  if (!host) {
    return false;
  }

  const rootDomain =
    process.env.APP_ROOT_DOMAIN?.trim().toLowerCase() || "codexdentist.com";
  const trustedHosts = new Set(
    (process.env.TRUSTED_APP_HOSTS ?? "")
      .split(",")
      .map(hostnameFromHeader)
      .filter((value): value is string => Boolean(value)),
  );

  try {
    const appBaseHostname = process.env.APP_BASE_URL
      ? new URL(process.env.APP_BASE_URL).hostname.toLowerCase()
      : null;

    if (appBaseHostname) {
      trustedHosts.add(appBaseHostname);
    }
  } catch {
    return false;
  }

  if (
    host === rootDomain ||
    (host.endsWith(`.${rootDomain}`) &&
      !host.slice(0, -(rootDomain.length + 1)).includes("."))
  ) {
    return true;
  }

  if (trustedHosts.has(host)) {
    return true;
  }

  if (process.env.DEPLOYMENT_MODE !== "self-hosted") {
    return process.env.NODE_ENV !== "production" && isLocalHost(host);
  }

  return isLocalHost(host);
}

function hostnameFromHeader(value: string | null) {
  const firstValue = value?.split(",")[0]?.trim().toLowerCase();

  if (!firstValue || firstValue.length > 253) {
    return null;
  }

  if (firstValue.startsWith("[")) {
    const closingBracket = firstValue.indexOf("]");
    return closingBracket > 0
      ? firstValue.slice(1, closingBracket)
      : null;
  }

  return firstValue.replace(/:\d+$/, "");
}

function isLocalHost(host: string) {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    !host.includes(".") ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

export const config = {
  matcher: "/:path*",
};
