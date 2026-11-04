import { pbkdf2Sync, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.TENANT_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const rootDomain = process.env.APP_ROOT_DOMAIN ?? "codexdentist.com";
const password = process.env.TENANT_SMOKE_PASSWORD ?? "CodexSmoke2026!";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const tenants = [
  {
    slug: "tenant-smoke-a",
    name: "Tenant Smoke A",
    email: "tenant-smoke-a@nhavista.vn",
  },
  {
    slug: "tenant-smoke-b",
    name: "Tenant Smoke B",
    email: "tenant-smoke-b@nhavista.vn",
  },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run tenant smoke against production.");
  }

  await assertHealth();
  await seedTenants();

  const tenantAHost = `${tenants[0].slug}.${rootDomain}`;
  const tenantBHost = `${tenants[1].slug}.${rootDomain}`;

  for (const tenant of tenants) {
    const result = await login(rootDomain, tenant.email);
    if (!result.cookie || !result.location?.endsWith("/dashboard") || result.location.includes(tenant.slug)) {
      throw new Error("Shared login must establish a session and stay on /dashboard.");
    }
    if (result.setCookie.toLowerCase().includes("domain=")) throw new Error("Session must be host-only.");
    const dashboard = await fetch(`${baseUrl}/dashboard`, {
      headers: { ...tenantHeaders(rootDomain), cookie: result.cookie }, redirect: "manual",
    });
    if (dashboard.status !== 200) throw new Error(`Root session failed: ${dashboard.status}`);
    const patients = await fetch(`${baseUrl}/patients?organizationId=untrusted`, {
      headers: { ...tenantHeaders(rootDomain), cookie: result.cookie }, redirect: "manual",
    });
    const html = await patients.text();
    const other = tenants.find(candidate => candidate !== tenant);
    if (patients.status !== 200 || !html.includes(`${tenant.slug}-patient`) || html.includes(`${other.slug}-patient`)) {
      throw new Error("Shared-host patients must follow authenticated organization scope.");
    }
    console.log(`ok shared-host login, session and patient isolation ${tenant.slug}`);
  }
  const legacy = await fetch(`${baseUrl}/reset-password?token=synthetic`, {
    headers: tenantHeaders(tenantAHost), redirect: "manual",
  });
  if (legacy.status !== 307 || legacy.headers.get("location") !== `https://${rootDomain}/reset-password?token=synthetic`) {
    throw new Error("Legacy host must preserve password reset path and token on shared host.");
  }

  await assertLoginAllowed(tenantAHost, tenants[0].email, "tenant A owner on tenant A host");
  await assertLoginAllowed(tenantBHost, tenants[1].email, "tenant B owner on tenant B host");
  await assertLoginDenied(tenantBHost, tenants[0].email, "tenant A owner on tenant B host");
  await assertLoginDenied(`missing-tenant-smoke.${rootDomain}`, tenants[0].email, "known owner on missing tenant host");

  console.log("ok tenant isolation smoke");
}

async function seedTenants() {
  const passwordHash = hashPassword(password);

  for (const tenant of tenants) {
    const organization = await prisma.organization.upsert({
      where: { slug: tenant.slug },
      update: {
        name: tenant.name,
        primaryDomain: `${tenant.slug}.${rootDomain}`,
      },
      create: {
        name: tenant.name,
        slug: tenant.slug,
        primaryDomain: `${tenant.slug}.${rootDomain}`,
        locale: "vi-VN",
      },
      select: { id: true },
    });

    const clinic = await prisma.clinic.upsert({
      where: {
        organizationId_name: {
          organizationId: organization.id,
          name: `${tenant.name} Clinic`,
        },
      },
      update: {
        active: true,
      },
      create: {
        organizationId: organization.id,
        name: `${tenant.name} Clinic`,
        city: "Ho Chi Minh City",
        address: "Tenant smoke address",
        phone: "0900000000",
      },
      select: { id: true },
    });

    const user = await prisma.user.upsert({
      where: { email: tenant.email },
      update: {
        organizationId: organization.id,
        fullName: `${tenant.name} Owner`,
        passwordHash,
        role: "OWNER",
        active: true,
        mustChangePassword: false,
      },
      create: {
        organizationId: organization.id,
        email: tenant.email,
        fullName: `${tenant.name} Owner`,
        passwordHash,
        role: "OWNER",
        active: true,
        mustChangePassword: false,
      },
      select: { id: true },
    });

    await prisma.userClinic.upsert({
      where: {
        userId_clinicId: {
          userId: user.id,
          clinicId: clinic.id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        clinicId: clinic.id,
      },
    });
    await prisma.patient.upsert({
      where: { organizationId_phone: { organizationId: organization.id, phone: "0999888777" } },
      update: { fullName: `${tenant.slug}-patient` },
      create: { organizationId: organization.id, clinicId: clinic.id, phone: "0999888777", fullName: `${tenant.slug}-patient`, dateOfBirth: new Date("1990-01-01") },
    });
  }
}

async function assertHealth() {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json().catch(() => ({}));

  if (response.status !== 200 || body.status !== "ok" || body.database !== "ok") {
    throw new Error(`/api/health is not healthy: HTTP ${response.status}`);
  }
}

async function assertLoginAllowed(host, email, label) {
  const result = await login(host, email);

  if (!result.cookie) {
    throw new Error(`${label} should receive a session cookie; got HTTP ${result.status}.`);
  }

  console.log(`ok allowed ${label}`);
}

async function assertLoginDenied(host, email, label) {
  const result = await login(host, email);

  if (result.cookie) {
    throw new Error(`${label} unexpectedly received a session cookie.`);
  }

  console.log(`ok denied ${label}`);
}

async function login(host, email) {
  const html = await fetchText("/login", rootDomain);
  const action = html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

  if (!action) {
    throw new Error(`Could not find login action for ${host}.`);
  }

  const form = new FormData();
  form.set(action, "");
  form.set("email", email);
  form.set("password", password);

  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    body: form,
    headers: tenantHeaders(host),
    redirect: "manual",
  });

  return {
    status: response.status,
    cookie: cookieHeader(response),
    location: response.headers.get("location"),
    setCookie: response.headers.get("set-cookie") ?? "",
  };
}

async function fetchText(path, host) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: tenantHeaders(host),
  });

  if (!response.ok) {
    throw new Error(`${path} on ${host} returned HTTP ${response.status}.`);
  }

  return response.text();
}

function tenantHeaders(host) {
  return {
    host,
    "x-forwarded-host": host,
    origin: `http://${host}`,
  };
}

function cookieHeader(response) {
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie().join(",")
      : response.headers.get("set-cookie");

  return setCookie
    ?.split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((cookie) => cookie.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function hashPassword(value, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(value, salt, 310000, 32, "sha256").toString("hex");

  return `pbkdf2_sha256$310000$${salt}$${hash}`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
