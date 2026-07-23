import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.M1015_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.M1015_EMAIL ?? "owner@nhavista.vn";
const password = process.env.M1015_PASSWORD ?? "demo1234";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const fixture = {
  chainId: `m1015-chain-${suffix}`,
  clinicId: `m1015-clinic-${suffix}`,
  policyId: `m1015-policy-${suffix}`,
  aiRunId: `m1015-ai-${suffix}`,
};

async function main() {
  await assertHealth();
  const cookie = await login();

  try {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, organizationId: true },
    });

    await assertDisposableChainClinic(owner);
    await assertPayrollPolicy(owner.organizationId);
    await assertAiAudit(owner);
    await assertPage(cookie, "/staff", ["Nhân sự"]);
    await assertPage(cookie, "/settings", ["CodexMed"]);
    await assertCsvExport(cookie, "/reports/export", [
      "section",
      "clinic_or_group",
      "codexmed-reports",
    ]);
    await assertSource("src/app/(app)/staff/actions.ts", [
      "updatePayrollPolicyAction",
      "importPayrollPoliciesAction",
      "payroll.policy_upserted",
      "findPayrollPolicy",
    ]);
    await assertSource("src/app/(app)/patient-files/actions.ts", [
      "updatePatientFileGovernanceAction",
      "files-denied",
      "patient_file.governance_updated",
    ]);
    await assertSource("src/app/(app)/settings/actions.ts", [
      "sendNotificationTestAction",
      "notification.test_sent",
      "canWriteSettings",
    ]);
    await assertSource("src/modules/staff/StaffPayrollPanel.tsx", [
      "updatePayrollPolicyAction",
      "importPayrollPoliciesAction",
      "payrollPolicyDefaults",
    ]);
    await assertSource("src/components/DentalSuite.tsx", [
      "module-ai-history",
    ]);
    await assertSource("src/modules/settings/SettingsPanel.tsx", [
      "aiAudit",
      "aiAuditQuery",
      "filteredAiRuns",
    ]);
    console.log("ok milestone 10/11/12/13/14/15 smoke");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

async function assertDisposableChainClinic(owner) {
  await prisma.chain.create({
    data: {
      id: fixture.chainId,
      organizationId: owner.organizationId,
      name: `M1015 Chain ${suffix}`,
      specialty: "DENTAL",
      clinics: {
        create: {
          id: fixture.clinicId,
          organizationId: owner.organizationId,
          name: `M1015 Clinic ${suffix}`,
          city: "QA",
          address: "Disposable fixture",
          users: {
            create: {
              userId: owner.id,
            },
          },
        },
      },
    },
  });

  await prisma.clinic.update({
    where: { id: fixture.clinicId },
    data: { active: false },
  });
  await prisma.clinic.update({
    where: { id: fixture.clinicId },
    data: { active: true },
  });
  await prisma.chain.update({
    where: { id: fixture.chainId },
    data: { active: false },
  });
  await prisma.chain.update({
    where: { id: fixture.chainId },
    data: { active: true },
  });

  const clinic = await prisma.clinic.findUniqueOrThrow({
    where: { id: fixture.clinicId },
    select: { active: true, chain: { select: { active: true } } },
  });

  if (!clinic.active || !clinic.chain?.active) {
    throw new Error("Disposable chain/clinic lifecycle failed.");
  }

  console.log("ok disposable chain/clinic lifecycle");
}

async function assertPayrollPolicy(organizationId) {
  const policy = await prisma.payrollPolicy.create({
    data: {
      id: fixture.policyId,
      organizationId,
      clinicId: fixture.clinicId,
      scopeKey: fixture.clinicId,
      name: `M1015 Payroll ${suffix}`,
      includeBaseSalary: true,
      standardWorkdays: 24,
      taxPercent: 5,
      insurancePercent: 10.5,
      otherDeductionAmount: 250000,
    },
    select: {
      standardWorkdays: true,
      taxPercent: true,
      insurancePercent: true,
      otherDeductionAmount: true,
    },
  });

  if (
    policy.standardWorkdays !== 24 ||
    Number(policy.taxPercent) !== 5 ||
    Number(policy.insurancePercent) !== 10.5 ||
    Number(policy.otherDeductionAmount) !== 250000
  ) {
    throw new Error("Payroll policy values were not persisted.");
  }

  console.log("ok payroll policy persistence");
}

async function assertAiAudit(owner) {
  await prisma.aiRun.create({
    data: {
      id: fixture.aiRunId,
      organizationId: owner.organizationId,
      clinicId: fixture.clinicId,
      actorId: owner.id,
      module: "M1015_SMOKE",
      action: "AI_AUDIT_VISIBLE",
      provider: "test",
      model: "test-model",
      status: "SUCCEEDED",
      input: { fixture: suffix },
      output: { ok: true },
      rawOutput: "{\"ok\":true}",
      totalTokens: 3,
      completedAt: new Date(),
    },
  });

  console.log("ok ai audit fixture");
}

async function assertHealth() {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json().catch(() => ({}));

  if (response.status !== 200 || body.status !== "ok" || body.database !== "ok") {
    throw new Error(`/api/health is not healthy: HTTP ${response.status}`);
  }

  console.log("ok health");
}

async function login() {
  const html = await fetchText("/login");
  const action = html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

  if (!action) {
    throw new Error("Could not find login action.");
  }

  const form = new FormData();
  form.set(action, "");
  form.set("email", email);
  form.set("password", password);

  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    body: form,
    redirect: "manual",
  });

  if (![200, 303].includes(response.status)) {
    throw new Error(`Login failed with HTTP ${response.status}.`);
  }

  const cookie = cookieHeader(response);

  if (!cookie) {
    throw new Error("Login did not return a session cookie.");
  }

  console.log("ok login");
  return cookie;
}

async function assertPage(cookie, path, markers) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie },
  });
  const html = await response.text();

  if (response.status !== 200 || html.includes("Runtime Error")) {
    throw new Error(`${path} failed: HTTP ${response.status}`);
  }

  for (const marker of markers) {
    if (!html.includes(marker)) {
      throw new Error(`${path} missing marker "${marker}".`);
    }
  }

  console.log(`ok ${path}`);
}

async function assertCsvExport(cookie, path, markers) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie },
  });
  const body = await response.text();
  const disposition = response.headers.get("content-disposition") ?? "";

  if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/csv")) {
    throw new Error(`${path} export failed: HTTP ${response.status}`);
  }

  for (const marker of markers) {
    const haystack = marker.startsWith("codexmed-") ? disposition : body;
    if (!haystack.includes(marker)) {
      throw new Error(`${path} missing export marker "${marker}".`);
    }
  }

  console.log(`ok ${path}`);
}

async function assertSource(path, markers) {
  const source = await readFile(path, "utf8");

  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(`${path} missing marker "${marker}".`);
    }
  }

  console.log(`ok ${path}`);
}

async function fetchText(path) {
  const response = await fetch(`${baseUrl}${path}`);

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}.`);
  }

  return response.text();
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

async function cleanup() {
  await prisma.aiRun.deleteMany({ where: { id: fixture.aiRunId } });
  await prisma.payrollPolicy.deleteMany({ where: { id: fixture.policyId } });
  await prisma.userClinic.deleteMany({ where: { clinicId: fixture.clinicId } });
  await prisma.clinic.deleteMany({ where: { id: fixture.clinicId } });
  await prisma.chain.deleteMany({ where: { id: fixture.chainId } });
  console.log("ok cleanup");
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
