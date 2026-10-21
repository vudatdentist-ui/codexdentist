const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./audit-source-loader.cjs");
const permissions = load("src/lib/permissions.ts");
const actions = load("src/lib/actions/permissions.ts", { "@/lib/permissions": permissions });
const scope = load("src/lib/tenant-scope.ts", { "@/lib/permissions": permissions });
const superAdmin = load("src/lib/super-admin.ts", { "@/lib/permissions": permissions });
const templates = load("src/lib/notification-templates.ts");
const session = {
  userId: "staff", email: "staff@example.test", organizationId: "org",
  role: "CLINIC_MANAGER", roles: ["CLINIC_MANAGER", "DENTIST"],
  roleAssignments: [
    { role: "CLINIC_MANAGER", organizationId: "org", clinicId: "A" },
    { role: "DENTIST", organizationId: "org", clinicId: "B" },
  ], activeClinicId: "B", clinicIds: ["A", "B"],
  isDemo: false, workspaceExpiresAt: null,
};
const redirect = (url) => { const error = new Error(`REDIRECT ${url}`); error.digest = "NEXT_REDIRECT"; throw error; };

test("F1: authorization follows the active clinic, ignoring legacy strongest roles", () => {
  assert.equal(actions.canPerformAction(session, "settings.manage"), false);
  assert.equal(actions.canPerformAction(session, "staff.manage"), false);
  assert.equal(permissions.canAccessView(session, "settings"), false);
  assert.equal(actions.canPerformAction({ ...session, activeClinicId: "A" }, "settings.manage"), true);
  assert.deepEqual([...scope.accessibleClinicIds(session)], ["B"]);
  const foreign = { ...session, roleAssignments: [{ role: "OWNER", organizationId: "foreign", clinicId: null }] };
  assert.equal(permissions.canUseAllClinics(foreign), false);
  const scopedOwner = { ...session, roleAssignments: [{ role: "OWNER", organizationId: "org", clinicId: "B" }] };
  assert.equal(permissions.canUseAllClinics(scopedOwner), false);
  const owner = { ...session, roleAssignments: [{ role: "OWNER", organizationId: "org", clinicId: null }] };
  assert.equal(permissions.canUseAllClinics(owner), true);
});

test("F1: actual staff action rejects a manager acting outside their active clinic", async () => {
  let actor = session;
  const settings = load("src/app/(app)/settings/actions.ts", {
    "next/cache": { revalidatePath() {} }, "next/navigation": { redirect },
    "@/lib/actions/permissions": actions,
    "@/lib/auth": { requireViewSession: async () => actor },
    "@/lib/env": {}, "@/lib/form-validation": load("src/lib/form-validation.ts"),
    "@/lib/notification-templates": templates, "@/lib/notifications": {},
    "@/lib/patient-file-storage": {}, "@/lib/permissions": permissions,
    "@/lib/tenant-scope": scope,
    "@/lib/prisma": { prisma: { clinic: { findFirst: async ({ where }) =>
      where.id.in.includes(where.id.equals) ? { id: where.id.equals, organizationId: "org" } : null } } },
    "@/lib/source-commission": {}, "@/lib/super-admin": superAdmin,
    "@/lib/tenant-bootstrap": {}, "@/lib/tenant": {},
  });
  const form = new FormData();
  for (const [key, value] of Object.entries({ fullName: "Test staff", email: "new@example.test", clinicId: "B", assignmentRole: "FRONT_DESK" })) form.set(key, value);
  await assert.rejects(settings.createStaffAction(form), /REDIRECT .*settings-denied/);
  actor = { ...session, activeClinicId: "A" };
  await assert.rejects(settings.createStaffAction(form), /REDIRECT .*settings-missing/);
});

test("F2: public signup rejects normalized reserved operator emails before provisioning", async () => {
  let writes = 0;
  const trial = load("src/lib/trial-workspaces.ts", {
    "@prisma/client": {}, "@/lib/prisma": { prisma: {} },
    "@/lib/organization-onboarding": { createOrganizationWorkspace: async () => { writes++; } },
    "@/lib/tenant": {}, "@/lib/super-admin": superAdmin,
  });
  await assert.rejects(trial.createTrialWorkspace({ ownerEmail: " Reserved-Admin@Example.Test " }),
    (error) => error instanceof trial.TrialAccountAlreadyExistsError);
  assert.equal(writes, 0);
});

test("F2: even an existing allowlisted trial/demo owner never has platform access", () => {
  const owner = { ...session, email: "reserved-admin@example.test", role: "OWNER",
    roleAssignments: [{ role: "OWNER", organizationId: "org", clinicId: null }] };
  assert.equal(superAdmin.isSuperAdminSession(owner), true);
  assert.equal(superAdmin.isSuperAdminSession({ ...owner, workspaceExpiresAt: Date.now() + 1000 }), false);
  assert.equal(superAdmin.isSuperAdminSession({ ...owner, isDemo: true }), false);
});

test("F3: appointment conflict lookup executes in the serializable transaction before insert", async () => {
  const events = [];
  const tx = { appointment: {
    findFirst: async () => { events.push("check"); return { id: "conflict" }; },
    create: async () => { throw new Error("must not create"); },
  } };
  const errors = load("src/lib/application/errors.ts");
  const scheduling = load("src/lib/application/scheduling/commands.ts", {
    "@/lib/actions/permissions": actions, "@/lib/application/errors": errors,
    "@/lib/form-validation": {}, "@/lib/patient-access": { allowedClinicIds: () => ["A"] },
    "@/lib/prisma": { prisma: Object.fromEntries(["clinic", "patient", "user", "chair"].map(key => [key, { findFirst: async () => ({ id: key }) }])) },
    "@/lib/transaction": { runSerializableTransaction: async (fn) => { events.push("transaction"); return fn(tx); } },
  });
  await assert.rejects(scheduling.createAppointmentCommand({ ...session, activeClinicId: "A" }, {
    clinicId: "A", patientId: "patient", providerId: "provider", chairId: "chair",
    startsAt: new Date(), endsAt: new Date(Date.now() + 60000), reason: "Test",
  }), (error) => error instanceof errors.ApplicationCommandError && error.code === "conflict");
  assert.deepEqual(events, ["transaction", "check"]);
});

test("F4: root password recovery serves tenants; wrong tenant and missing user keep generic response", async () => {
  let host = "codexdentist.test", tokenCount = 0, userExists = true;
  const login = load("src/app/(auth)/login/actions.ts", {
    "next/navigation": { redirect }, "next/headers": { headers: async () => ({}) },
    "@/lib/auth": {}, "@/lib/notification-templates": templates,
    "@/lib/notifications": { processNotificationNow: async () => ({}) },
    "@/lib/password-reset": { createPasswordSetupToken: async () => { tokenCount++; return { url: "https://tenant.codexdentist.test/reset-password?token=synthetic", expiresAt: new Date() }; } },
    "@/lib/prisma": { prisma: {
      user: { findUnique: async () => userExists ? { id: "u", organizationId: "org", fullName: "Test", email: "test@example.test", active: true, clinics: [] } : null },
      notification: { create: async () => ({ id: "n" }) },
    } },
    "@/lib/tenant": { currentHostname: async () => host, tenantSlugFromHostname: h => h.startsWith("wrong.") ? "wrong" : null,
      findTenantOrganization: async () => ({ id: "other" }) },
    "@/lib/rate-limit": { consumePasswordResetAttempt: async () => ({ allowed: true }) },
    "@/lib/request-ip": { clientIpFromHeaders: () => "127.0.0.1" },
  });
  const form = new FormData(); form.set("email", "test@example.test");
  await assert.rejects(login.forgotPasswordAction(form), /REDIRECT \/login\?forgot=sent/);
  assert.equal(tokenCount, 1);
  host = "wrong.codexdentist.test";
  await assert.rejects(login.forgotPasswordAction(form), /REDIRECT \/login\?forgot=sent/);
  assert.equal(tokenCount, 1);
  host = "codexdentist.test"; userExists = false;
  await assert.rejects(login.forgotPasswordAction(form), /REDIRECT \/login\?forgot=sent/);
  assert.equal(tokenCount, 1);
});

test("F5: competing immediate/batch workers send once; terminal/future records are skipped", async () => {
  let status = "SCHEDULED", scheduledAt = null, requests = 0;
  const row = () => ({ id: "n", organizationId: "org", channel: "EMAIL", recipient: "test@example.test", subject: "Test", body: "Test", templateKey: null, status, scheduledAt });
  const notifications = load("src/lib/notifications.ts", {
    "@/lib/notification-templates": templates,
    "@/lib/env": { notificationDeliveryMode: () => "resend", notificationBatchLimit: () => 10,
      resendEmailConfig: () => ({ apiKey: "synthetic", from: "test@example.test" }) },
    "@/lib/prisma": { prisma: {
      notification: { findUnique: async () => row(), findMany: async () => [row()],
        updateMany: async ({ where, data }) => {
          if (!where.status.in.includes(status) || (scheduledAt && scheduledAt > new Date())) return { count: 0 };
          status = data.status; return { count: 1 };
        }, update: async ({ data }) => { status = data.status; } },
      organization: { findUnique: async () => ({ isDemo: false }) }, auditLog: { createMany: async () => ({}) },
    } },
  }, { fetch: async (_url, options) => { requests++; assert.equal(options.headers["Idempotency-Key"], "notification/n"); await new Promise(r => setTimeout(r, 5)); return { ok: true }; } });
  const results = await Promise.all([notifications.processNotificationNow("n"), notifications.processDueNotifications(), notifications.processNotificationNow("n")]);
  assert.equal(requests, 1); assert.equal(status, "SENT");
  assert.equal(results.reduce((n, r) => n + r.sent, 0), 1);
  for (const value of ["SENT", "FAILED", "CANCELLED", "PROCESSING"]) {
    status = value; assert.equal((await notifications.processNotificationNow("n")).sent, 0);
  }
  status = "SCHEDULED"; scheduledAt = new Date(Date.now() + 60000);
  assert.equal((await notifications.processNotificationNow("n")).sent, 0);
  assert.equal(requests, 1);
});

test("F6: patched XML parser and Xcode UUID dependency remain compatible with Capacitor tooling", () => {
  const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
  const doc = new DOMParser().parseFromString('<plist version="1.0"><dict/></plist>', "application/xml");
  assert.match(new XMLSerializer().serializeToString(doc), /plist/);
  const xcode = require("xcode");
  const project = xcode.project("synthetic.pbxproj");
  project.hash = { project: { objects: {} } };
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
});
