import "server-only";

import { headers } from "next/headers";
import { appRootDomain } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const reservedTenantSlugs = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "billing",
  "demo",
  "docs",
  "mail",
  "status",
  "static",
  "support",
  "www",
]);

export function normalizeTenantSlug(value: string) {
  return value.trim().toLowerCase();
}

export function isValidTenantSlug(value: string) {
  const slug = normalizeTenantSlug(value);

  return (
    slug.length >= 3 &&
    slug.length <= 40 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(slug) &&
    !slug.includes("--") &&
    !reservedTenantSlugs.has(slug)
  );
}

export function tenantDomainForSlug(slug: string) {
  return `${normalizeTenantSlug(slug)}.${appRootDomain()}`;
}

export async function currentHostname() {
  const headerStore = await headers();
  return normalizeHostname(
    headerStore.get("host") ?? headerStore.get("x-forwarded-host") ?? "",
  );
}

export function normalizeHostname(host: string) {
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

export function tenantSlugFromHostname(hostname: string) {
  const host = normalizeHostname(hostname);
  const rootDomain = appRootDomain();

  if (
    !host ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost") ||
    host === rootDomain ||
    systemSubdomainFromHostname(host) !== null
  ) {
    return null;
  }

  if (!host.endsWith(`.${rootDomain}`)) {
    return null;
  }

  const slug = host.slice(0, -(rootDomain.length + 1));

  return slug.includes(".") ? null : slug;
}

export function isLocalHostname(hostname: string) {
  const host = normalizeHostname(hostname);

  return (
    !host ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost")
  );
}

export function isNeutralAppHostname(hostname: string) {
  const host = normalizeHostname(hostname);
  const rootDomain = appRootDomain();

  return host === rootDomain || host === `app.${rootDomain}` || host === `admin.${rootDomain}`;
}

export function systemSubdomainFromHostname(hostname: string) {
  const host = normalizeHostname(hostname);
  const rootDomain = appRootDomain();
  const systemSubdomains = ["admin", "app", "demo", "docs", "status", "www"];

  return systemSubdomains.find((subdomain) => host === `${subdomain}.${rootDomain}`) ?? null;
}

export async function currentTenantSlug() {
  return tenantSlugFromHostname(await currentHostname());
}

export async function findTenantOrganization(slug: string) {
  return prisma.organization.findUnique({
    where: {
      slug: normalizeTenantSlug(slug),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      primaryDomain: true,
    },
  });
}
