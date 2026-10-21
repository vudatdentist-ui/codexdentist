const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { load } = require("./audit-source-loader.cjs");

// These tests create and remove only a uniquely identified synthetic workspace.
if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Audit concurrency tests require NODE_ENV=test and a loopback test database.");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const permissions = load("src/lib/permissions.ts");
const actions = load("src/lib/actions/permissions.ts", { "@/lib/permissions": permissions });
const scheduling = load("src/lib/application/scheduling/commands.ts", {
  "@/lib/actions/permissions": actions,
  "@/lib/application/errors": load("src/lib/application/errors.ts"),
  "@/lib/form-validation": load("src/lib/form-validation.ts"),
  "@/lib/patient-access": load("src/lib/patient-access.ts", { "@/lib/permissions": permissions }),
  "@/lib/prisma": { prisma },
  "@/lib/transaction": load("src/lib/transaction.ts", { "@/lib/prisma": { prisma } }),
});

async function main() {
  const organization = await prisma.organization.create({ data: { name: `Audit fixture ${randomUUID()}` } });
  const orgId = organization.id;
  try {
    const clinic = await prisma.clinic.create({ data: { organizationId: orgId, name: "Audit A", city: "Test", address: "Test" } });
    const clinicB = await prisma.clinic.create({ data: { organizationId: orgId, name: "Audit B", city: "Test", address: "Test" } });
    const providers = await Promise.all([1, 2].map(i => prisma.user.create({ data: {
      organizationId: orgId, email: `audit-${randomUUID()}@example.test`, fullName: `Provider ${i}`,
      passwordHash: "unusable-synthetic-fixture", role: "DENTIST",
      clinics: { create: [{ clinicId: clinic.id }, { clinicId: clinicB.id }] },
    } })));
    const chairs = await Promise.all([1, 2].map(i => prisma.chair.create({ data: { clinicId: clinic.id, name: `Chair ${i}` } })));
    const patient = await prisma.patient.create({ data: { organizationId: orgId, clinicId: clinic.id, fullName: "Synthetic audit", phone: "0000000000", medicalAlerts: [] } });
    const patientB = await prisma.patient.create({ data: { organizationId: orgId, clinicId: clinicB.id, fullName: "Synthetic audit B", phone: "0000000001", medicalAlerts: [] } });
    const session = { userId: providers[0].id, organizationId: orgId, role: "OWNER", roles: ["OWNER"],
      roleAssignments: [{ role: "OWNER", organizationId: orgId, clinicId: null }], clinicIds: [clinic.id, clinicB.id], activeClinicId: null };
    const scope = load("src/lib/tenant-scope.ts", { "@/lib/permissions": permissions });
    const sharedMocks = {
      "@/lib/permissions": permissions, "@/lib/tenant-scope": scope,
      "@/lib/actions/permissions": actions, "@/lib/prisma": { prisma },
      "@/lib/form-validation": load("src/lib/form-validation.ts"),
      "@/lib/application/errors": load("src/lib/application/errors.ts"),
    };
    const patients = load("src/lib/application/patient/commands.ts", sharedMocks);
    const revenue = load("src/lib/application/revenue/commands.ts", {
      ...sharedMocks, "@/lib/document-sequence": {}, "@/lib/transaction": {},
      "@/lib/notification-templates": load("src/lib/notification-templates.ts"),
    });
    const manager = { ...session, role: "CLINIC_MANAGER", roles: ["CLINIC_MANAGER", "DENTIST"], activeClinicId: clinic.id,
      roleAssignments: [{ role: "CLINIC_MANAGER", organizationId: orgId, clinicId: clinic.id },
        { role: "DENTIST", organizationId: orgId, clinicId: clinicB.id }] };
    await assert.rejects(patients.createPatientCommand(manager, { clinicId: clinicB.id }), error => error.code === "clinic-denied");
    await assert.rejects(revenue.createInvoiceCommand(manager, { patientId: patientB.id, amount: 100, dueDate: new Date() }),
      error => error.code === "billing-patient-not-found");
    assert.equal(await prisma.invoice.count({ where: { organizationId: orgId } }), 0);
    assert.equal(await prisma.patient.count({ where: { organizationId: orgId } }), 2);
    console.log("ok cross-clinic patient and revenue mutation denial");
    const base = { clinicId: clinic.id, patientId: patient.id, providerId: providers[0].id, chairId: chairs[0].id,
      startsAt: new Date("2035-01-01T01:00:00Z"), endsAt: new Date("2035-01-01T02:00:00Z"), reason: "Synthetic concurrency regression" };
    for (const [label, second] of [
      ["same provider, different chairs", { ...base, chairId: chairs[1].id }],
      ["same chair, different providers", { ...base, providerId: providers[1].id }],
      ["same provider across clinics", { ...base, clinicId: clinicB.id, patientId: patientB.id, chairId: null }],
    ]) {
      for (let round = 0; round < 3; round++) {
        const results = await Promise.allSettled([
          scheduling.createAppointmentCommand(session, base), scheduling.createAppointmentCommand(session, second),
        ]);
        assert.equal(results.filter(r => r.status === "fulfilled").length, 1, label);
        assert.equal(results.find(r => r.status === "rejected").reason.code, "conflict", label);
        assert.equal(await prisma.appointment.count({ where: { clinicId: { in: session.clinicIds } } }), 1);
        await prisma.appointment.deleteMany({ where: { clinicId: { in: session.clinicIds } } });
      }
      console.log(`ok appointment concurrency: ${label} (3 rounds)`);
    }
    await scheduling.createAppointmentCommand(session, base);
    await scheduling.createAppointmentCommand(session, { ...base, startsAt: base.endsAt, endsAt: new Date("2035-01-01T03:00:00Z") });
    assert.equal(await prisma.appointment.count({ where: { clinicId: clinic.id } }), 2, "adjacent slots are allowed");
    console.log("ok adjacent appointment slots");

    let deliveries = 0;
    const notificationClient = {
      notification: {
        findUnique: args => prisma.notification.findUnique(args),
        findMany: args => prisma.notification.findMany({ ...args, where: { ...args.where, organizationId: orgId } }),
        updateMany: args => prisma.notification.updateMany(args),
        update: args => prisma.notification.update(args),
      }, organization: prisma.organization, auditLog: prisma.auditLog,
    };
    const notifications = load("src/lib/notifications.ts", {
      "@/lib/prisma": { prisma: notificationClient },
      "@/lib/notification-templates": load("src/lib/notification-templates.ts"),
      "@/lib/env": { notificationDeliveryMode: () => "resend", notificationBatchLimit: () => 10,
        resendEmailConfig: () => ({ apiKey: "synthetic", from: "test@example.test" }) },
    }, { fetch: async (_url, options) => {
      assert.match(options.headers["Idempotency-Key"], /^notification\//);
      deliveries++;
      await new Promise(resolve => setTimeout(resolve, 40));
      return { ok: true };
    } });
    const data = { organizationId: orgId, channel: "EMAIL", status: "SCHEDULED", recipient: "synthetic@example.test", subject: "Test", body: "Test" };
    const notification = await prisma.notification.create({ data });
    const results = await Promise.all([
      notifications.processDueNotifications(), notifications.processNotificationNow(notification.id),
      notifications.processDueNotifications(), notifications.processNotificationNow(notification.id),
    ]);
    assert.equal(deliveries, 1, "only one worker delivers");
    assert.equal(results.reduce((n, r) => n + r.sent, 0), 1);
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).status, "SENT");
    await notifications.processNotificationNow(notification.id);
    assert.equal(deliveries, 1, "SENT cannot be resent");
    const credential = await prisma.notification.create({ data: { ...data, templateKey: "PASSWORD_RESET" } });
    await notifications.processDueNotifications();
    await notifications.processNotificationNow(credential.id);
    assert.equal(deliveries, 1, "redacted credential records cannot be sent by batch or id alone");
    await notifications.processNotificationNow(credential.id, { subject: "Reset", body: "Synthetic fresh link" });
    assert.equal(deliveries, 2, "fresh credential content can be sent once");
    console.log("ok real database notification claims and credential delivery");
  } finally {
    // All deletes are restricted to this test's newly generated organization.
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.appointment.deleteMany({ where: { clinic: { organizationId: orgId } } });
    await prisma.patient.deleteMany({ where: { organizationId: orgId } });
    await prisma.userClinic.deleteMany({ where: { user: { organizationId: orgId } } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.chair.deleteMany({ where: { clinic: { organizationId: orgId } } });
    await prisma.clinic.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
