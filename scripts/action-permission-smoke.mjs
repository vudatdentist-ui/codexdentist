import { readFile } from "node:fs/promises";

const baseUrl = process.env.ACTION_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const sharedPassword = process.env.ACTION_SMOKE_PASSWORD ?? "CodexSmoke2026!";
const accounts = {
  owner: {
    email: process.env.ACTION_SMOKE_OWNER_EMAIL ?? "owner@nhavista.vn",
    password: process.env.ACTION_SMOKE_OWNER_PASSWORD ?? sharedPassword,
  },
  patient: {
    email: process.env.ACTION_SMOKE_PATIENT_EMAIL ?? "patient@nhavista.vn",
    password: process.env.ACTION_SMOKE_PATIENT_PASSWORD ?? sharedPassword,
  },
  frontdesk: {
    email: process.env.ACTION_SMOKE_FRONTDESK_EMAIL ?? "frontdesk@nhavista.vn",
    password: process.env.ACTION_SMOKE_FRONTDESK_PASSWORD ?? sharedPassword,
  },
};

async function main() {
  await assertHealth();
  const ownerCookie = await login(accounts.owner.email, accounts.owner.password);
  const patientCookie = await login(accounts.patient.email, accounts.patient.password);
  const frontdeskCookie = await login(accounts.frontdesk.email, accounts.frontdesk.password);

  await assertAllowedExport(ownerCookie);
  await assertDenied(patientCookie, "/staff/payroll-policy-export", "patient payroll policy export");
  await assertDenied(frontdeskCookie, "/staff/payroll-policy-export", "frontdesk payroll policy export");
  await assertDenied(patientCookie, "/settings/source-commission-export", "patient source commission export");
  await assertGuardMarkers();
  console.log("ok action permission smoke");
}

async function assertAllowedExport(cookie) {
  const response = await fetch(`${baseUrl}/staff/payroll-policy-export`, {
    headers: {
      cookie,
      origin: baseUrl,
    },
    redirect: "manual",
  });
  const csv = await response.text();

  if (response.status !== 200 || !csv.includes("scope_key")) {
    throw new Error(`owner payroll policy export failed: HTTP ${response.status}`);
  }

  console.log("ok owner payroll policy export");
}

async function assertDenied(cookie, path, label) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      cookie,
      origin: baseUrl,
    },
    redirect: "manual",
  });

  if (response.status === 200) {
    throw new Error(`${label} unexpectedly returned HTTP 200.`);
  }

  if (![302, 303, 307, 308].includes(response.status)) {
    throw new Error(`${label} returned HTTP ${response.status}, expected redirect.`);
  }

  console.log(`ok denied ${label}`);
}

async function assertGuardMarkers() {
  await assertSource("src/app/(app)/staff/actions.ts", [
    "updatePayrollPolicyAction",
    "importPayrollPoliciesAction",
    'canPerformAction(session, "payroll.manage")',
  ]);
  await assertSource("src/app/(app)/settings/actions.ts", [
    "sendNotificationTestAction",
    'canPerformAction(session, "settings.manage")',
  ]);
  await assertSource("src/app/(app)/patient-files/actions.ts", [
    "updatePatientFileGovernanceAction",
    'canPerformAction(session, "file.delete")',
  ]);
  await assertSource("src/app/(app)/patients/actions.ts", [
    "createPatientAction",
    'canPerformAction(session, "patient.create")',
    'canPerformAction(session, "patient.update")',
  ]);
  await assertSource("src/app/(app)/schedule/actions.ts", [
    "createAppointmentAction",
    'canPerformAction(session, "appointment.create")',
    'canPerformAction(session, "appointment.update")',
    'canPerformAction(session, "appointment.cancel")',
  ]);
  await assertSource("src/app/(app)/journey/actions.ts", [
    "createJourneyTreatmentServicesAction",
    'canPerformAction(session, "treatment.plan.create")',
    'canPerformAction(session, "treatment.service.progress")',
  ]);
  await assertSource("src/app/(app)/clinical/actions.ts", [
    "createClinicalNoteAction",
    'canPerformAction(session, "clinical.note.create")',
    'canPerformAction(session, "clinical.note.sign")',
  ]);
  await assertSource("src/app/(app)/treatment/actions.ts", [
    "createTreatmentPlanAction",
    'canPerformAction(session, "treatment.plan.create")',
    'canPerformAction(session, status === "ACCEPTED" ? "treatment.plan.accept" : "treatment.plan.create")',
  ]);
}

async function assertSource(path, markers) {
  const source = await readFile(path, "utf8");

  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(`${path} missing guard marker "${marker}".`);
    }
  }

  console.log(`ok guard ${path}`);
}

async function assertHealth() {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json().catch(() => ({}));

  if (response.status !== 200 || body.status !== "ok" || body.database !== "ok") {
    throw new Error(`/api/health is not healthy: HTTP ${response.status}`);
  }

  console.log("ok health");
}

async function login(email, password) {
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
    headers: {
      origin: baseUrl,
    },
    redirect: "manual",
  });

  if (![200, 303].includes(response.status)) {
    throw new Error(`Login failed for ${email}: HTTP ${response.status}.`);
  }

  const cookie = cookieHeader(response);

  if (!cookie) {
    throw new Error(`Login did not return a cookie for ${email}.`);
  }

  return cookie;
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
