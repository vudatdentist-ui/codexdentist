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

  const rootDomain = process.env.APP_ROOT_DOMAIN?.trim().toLowerCase() || "codexdentist.com";
  const effectiveHost = process.env.TRUSTED_PROXY_PROVIDER && process.env.TRUSTED_PROXY_PROVIDER !== "none"
    ? forwardedHost ?? host
    : host;
  const subdomain = effectiveHost.endsWith(`.${rootDomain}`)
    ? effectiveHost.slice(0, -(rootDomain.length + 1))
    : null;
  const dedicatedHosts = new Set(["admin", "api", "assets", "billing", "demo", "docs", "mail", "odontogram", "status", "static", "support"]);
  const pathname = request.nextUrl.pathname;
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    subdomain && !subdomain.includes(".") && !dedicatedHosts.has(subdomain) &&
    !pathname.startsWith("/api/") && pathname !== "/api" &&
    !pathname.startsWith("/_next/") && !/\.[a-z0-9]+$/i.test(pathname)
  ) {
    const destination = new URL(`https://${rootDomain}`);
    destination.pathname = pathname === "/" ? "/login" : pathname;
    destination.search = request.nextUrl.search;
    return NextResponse.redirect(destination, 307);
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
