import { readFile } from "node:fs/promises";

const baseUrl = process.env.M789_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.M789_EMAIL ?? "owner@nhavista.vn";
const password = process.env.M789_PASSWORD ?? "demo1234";

async function main() {
  await assertHealth();
  const cookie = await login();

  await assertPage(cookie, "/staff", ["Nhân sự"]);
  await assertPage(cookie, "/settings", ["Cài đặt", "CodexMed"]);
  await assertPage(cookie, "/journey", ["Hành trình", "journey"]);

  await assertSource("prisma/schema.prisma", [
    "retentionUntil DateTime?",
    "@@index([organizationId, retentionUntil])",
  ]);
  await assertSource("src/app/(app)/staff/actions.ts", [
    "standardWorkdays",
    "taxPercent",
    "insurancePercent",
    "otherDeductionAmount",
    "proratedBaseSalary",
  ]);
  await assertSource("src/app/(app)/staff/payroll-export/route.ts", [
    "worked_days",
    "standard_workdays",
    "monthly_base_salary_vnd",
    "tax_vnd",
    "insurance_vnd",
    "other_deduction_vnd",
  ]);
  await assertSource("src/app/(app)/settings/actions.ts", [
    "sendNotificationTestAction",
    "processNotificationNow",
    "notification.test_sent",
  ]);
  await assertSource("src/app/(app)/patient-files/actions.ts", [
    "updatePatientFileGovernanceAction",
    "QUARANTINED",
    "INFECTED",
    "patient_file.governance_updated",
  ]);
  await assertSource("src/modules/journey/PatientJourneyPanel.tsx", [
    "patient-file-governance-form",
    "retentionUntilIso",
    "updatePatientFileGovernanceAction",
  ]);

  console.log("ok milestone 7/8/9 smoke");
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
  const loginHtml = await fetchText("/login");
  const action = loginHtml.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
