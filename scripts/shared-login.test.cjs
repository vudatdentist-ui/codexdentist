const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./audit-source-loader.cjs");

test("shared login creates a host-only session and reads the organization from the stored user", async () => {
  let host = "codexdentist.com", cookie, cookieOptions;
  const permissions = load("src/lib/permissions.ts");
  const env = { appRootDomain: () => "codexdentist.com", authSecret: () => "synthetic-test-auth-secret", demoAuthEnabled: () => false, sessionCookieSecure: () => true };
  const tenant = load("src/lib/tenant.ts", { "next/headers": { headers: async () => ({ get: key => key === "host" ? host : null }) }, "@/lib/env": { ...env, trustedProxyProvider: () => "none" }, "@/lib/prisma": { prisma: {} } });
  const user = { id: "user-a", email: "a@example.test", fullName: "Owner A", active: true, role: "OWNER", organizationId: "org-a", roleAssignments: [], clinics: [], organization: { id: "org-a", name: "Clinic A", slug: "clinic-a", primaryDomain: "clinic-a.codexdentist.com", isDemo: false, trialEndsAt: null, clinics: [] } };
  let storedOrganization = "org-a";
  const prisma = { user: { findUnique: async () => user, update: async () => ({}) }, session: { create: async () => ({}), findFirst: async ({ where }) => where.user.organizationId === storedOrganization ? { activeClinicId: null, user } : null } };
  const auth = load("src/lib/auth.ts", {
    "next/headers": { cookies: async () => ({ set(name, value, options) { cookie = { name, value }; cookieOptions = options; }, get(name) { return name === cookie?.name ? cookie : undefined; } }) },
    "next/navigation": {}, "@/lib/audit": { writeAuditLog: async () => {} }, "@/lib/data": { clinics: [] },
    "@/lib/permissions": permissions, "@/lib/env": env, "@/lib/prisma": { prisma },
    "@/lib/tenant": tenant, "@/lib/super-admin": { superAdminEmails: () => [] },
  });
  user.passwordHash = auth.hashPassword("SyntheticPassword!2026");
  assert.equal((await auth.signIn(user.email, "SyntheticPassword!2026")).ok, true);
  assert.equal(cookie.name, "codexdentist_session");
  assert.equal(cookieOptions.domain, undefined);
  assert.equal(cookieOptions.httpOnly, true);
  assert.equal(cookieOptions.secure, true);
  assert.equal((await auth.getSession()).organizationId, "org-a");
  storedOrganization = "org-b";
  assert.equal(await auth.getSession(), null, "reassigned/forged organization must fail stored-session validation");
  storedOrganization = "org-a";
  host = "admin.codexdentist.com";
  assert.equal(await auth.getSession(), null, "ordinary staff cannot use the platform host");
});

test("password recovery and staff setup links always use the configured shared origin", async () => {
  const env = { appBaseUrl: () => "https://codexdentist.com" };
  const reset = load("src/lib/password-reset.ts", { "@/lib/auth": {}, "@/lib/env": env, "@/lib/prisma": { prisma: {} }, "@/lib/transaction": {} });
  assert.equal(await reset.passwordSetupUrl("a+b", "org-a"), "https://codexdentist.com/reset-password?token=a%2Bb");
  const support = load("src/lib/application/settings/support.ts", { "@/lib/env": env, "@/lib/prisma": { prisma: {} }, "@/lib/notifications": {}, "@/lib/notification-templates": { renderNotificationTemplate: (_key, values) => values } });
  const setup = await support.createPasswordSetupArtifactsTx({ passwordResetToken: { updateMany: async () => ({}), create: async () => ({}) }, notification: { create: async () => ({ id: "n" }) } }, { organizationId: "org-a", userId: "u", fullName: "Owner", email: "a@example.test", organizationDomain: "legacy.codexdentist.com" });
  assert.match(setup.deliveryContent.setupUrl, /^https:\/\/codexdentist\.com\/reset-password\?token=/);
});

test("legacy page redirects preserve deep links while APIs and dedicated hosts stay routed", () => {
  const { proxy } = load("src/proxy.ts", { "next/server": { NextResponse: class { static next() { return { next: true }; } static redirect(url, status) { return { url: url.href, status }; } } } });
  const request = (host, path, method = "GET") => ({ method, headers: new Headers({ host }), nextUrl: new URL(`https://${host}${path}`) });
  assert.equal(proxy(request("phuongthao.codexdentist.com", "/reset-password?token=synthetic")).url, "https://codexdentist.com/reset-password?token=synthetic");
  assert.equal(proxy(request("phuongthao.codexdentist.com", "/")).url, "https://codexdentist.com/login");
  for (const host of ["codexdentist.com", "demo.codexdentist.com", "admin.codexdentist.com", "odontogram.codexdentist.com"]) assert.equal(proxy(request(host, "/login")).next, true);
  assert.equal(proxy(request("phuongthao.codexdentist.com", "/api/health")).next, true);
  assert.equal(proxy(request("phuongthao.codexdentist.com", "/login", "POST")).next, true);
});
