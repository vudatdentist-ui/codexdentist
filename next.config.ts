import type { NextConfig } from "next";

type ServerActionBodySizeLimit = NonNullable<
  NonNullable<NextConfig["experimental"]>["serverActions"]
>["bodySizeLimit"];

const serverActionBodySizeLimit = (process.env.SERVER_ACTION_BODY_SIZE_LIMIT ??
  "64mb") as ServerActionBodySizeLimit;
const sharedHostBuild = process.env.CODEXMED_SHARED_HOST_BUILD === "true";
const hostedDeployment = process.env.DEPLOYMENT_MODE !== "self-hosted";
const appRootDomain =
  process.env.APP_ROOT_DOMAIN?.trim().toLowerCase() || "codexdentist.com";
const serverActionAllowedOrigins = hostedDeployment
  ? [
      appRootDomain,
      `*.${appRootDomain}`,
      ...(process.env.TRUSTED_APP_HOSTS ?? "")
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ]
  : undefined;
const developmentEvalSource =
  process.env.NODE_ENV === "production" ? "" : ` '${["unsafe", "eval"].join("-")}'`;

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${developmentEvalSource} https://static.cloudflareinsights.com`,
  "connect-src 'self' https://cloudflareinsights.com https://*.cloudflareinsights.com",
].join("; ");

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
];

if (process.env.NODE_ENV === "production") {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  });
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  typescript: {
    ignoreBuildErrors:
      process.env.CODEXMED_PHONE_BUILD === "true" || sharedHostBuild,
  },
  experimental: {
    cpus: sharedHostBuild ? 1 : undefined,
    staticGenerationMaxConcurrency: sharedHostBuild ? 1 : undefined,
    staticGenerationMinPagesPerWorker: sharedHostBuild ? 100 : undefined,
    serverActions: {
      allowedOrigins: serverActionAllowedOrigins,
      bodySizeLimit: serverActionBodySizeLimit,
    },
  },
  async headers() {
    return [
      {
        source: "/",
        has: [
          {
            type: "host",
            value: `odontogram.${appRootDomain}`,
          },
        ],
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
