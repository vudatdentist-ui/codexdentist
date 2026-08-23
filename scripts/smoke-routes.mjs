import {
  enabledMigrationRoutes,
  materializePatientRoute,
  materializeTreatmentCaseRoute,
  routeNeedsPatientId,
  routeNeedsTreatmentServiceId,
} from "./qa-route-contract.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.SMOKE_EMAIL ?? "owner@nhavista.vn";
const password = process.env.SMOKE_PASSWORD ?? process.env.SMOKE_USER_PASSWORD ?? "CodexSmoke2026!";

const defaultRoutes = [
  "today",
  "schedule",
  "patients",
  "patient-management",
  "journey",
  "treatment",
  "billing",
  "accounting",
  "services",
  "staff",
  "crm",
  "inventory",
  "pharmacy",
  "forms",
  "learning",
  "employee-app",
  "reports",
  "community",
  "patient-app",
  "settings",
];
const configuredRoutes = (process.env.SMOKE_ROUTES
  ? process.env.SMOKE_ROUTES.split(",")
  : defaultRoutes
).map((route) => route.trim().replace(/^\/+/, "")).filter(Boolean);
const migrationRoutes = enabledMigrationRoutes(
  process.env.SMOKE_MIGRATION_ROUTES,
  "SMOKE_MIGRATION_ROUTES",
).map((route) => route.replace(/^\/+/, ""));
const routes = [...new Set([...configuredRoutes, ...migrationRoutes])];
const routeMarkers = {
  today: ["Hôm nay"],
  schedule: ["Multi-clinic schedule", "Lịch hẹn đa phòng khám"],
  patients: ["Patient 360", "Hồ sơ bệnh nhân 360"],
  "patients/[patientId]": ["Patient 360", "Hồ sơ bệnh nhân 360"],
  "patients/[patientId]/treatments/[treatmentServiceId]": ["Ca điều trị"],
  "patient-management": ["Patient 360", "Hồ sơ bệnh nhân 360"],
  journey: ["Patient 360", "Hồ sơ bệnh nhân 360", "Patient journey", "Hành trình bệnh nhân"],
  clinical: ["Patient 360", "Hồ sơ bệnh nhân 360", "Patient journey", "Hành trình bệnh nhân"],
  treatment: ["Ca điều trị", "Điều trị"],
  billing: ["Billing and collections", "Thanh toán và công nợ"],
  accounting: ["Accounting", "Kế toán"],
  services: ["Service management", "Quản lý dịch vụ"],
  staff: ["Staff and time clock", "Nhân sự và chấm công"],
  crm: ["Customer care", "Chăm sóc khách hàng"],
  inventory: ["Equipment and supplies", "Thiết bị và vật tư tiêu hao"],
  pharmacy: ["Prescriptions and drug library", "Đơn thuốc và thư viện thuốc"],
  forms: ["Forms and consent library", "Biểu mẫu và phiếu đồng thuận"],
  learning: ["Digital library and courses", "Thư viện số và khóa học"],
  "employee-app": ["Hồ sơ của tôi"],
  operations: ["Vận hành", "Thu nhập tháng này"],
  reports: ["Reports", "Báo cáo"],
  community: ["Internal community", "Cộng đồng nội bộ"],
  "patient-app": ["Patient portal and mobile", "Cổng thông tin bệnh nhân"],
  settings: ["Roles and compliance", "Vai trò và tuân thủ"],
};
const expectedHeaders = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};
let discoveredPatientId = process.env.SMOKE_PATIENT_ID ?? process.env.QA_PATIENT_ID ?? null;
let discoveredTreatmentServiceId =
  process.env.SMOKE_TREATMENT_SERVICE_ID ?? process.env.QA_TREATMENT_SERVICE_ID ?? null;

async function main() {
  await assertHealth();
  const loginHtml = await fetchText("/login");
  assertSecurityHeaders(await fetch(`${baseUrl}/login`), "/login");
  const actionName = loginHtml.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

  if (!actionName) {
    throw new Error("Could not find login server action field.");
  }

  const form = new FormData();
  form.set(actionName, "");
  form.set("email", email);
  form.set("password", password);

  const loginResponse = await fetch(`${baseUrl}/login`, {
    method: "POST",
    body: form,
    redirect: "manual",
  });

  if (![303, 200].includes(loginResponse.status)) {
    throw new Error(`Login failed with HTTP ${loginResponse.status}.`);
  }

  const cookie = cookieHeader(loginResponse);

  if (!cookie) {
    throw new Error("Login did not return a session cookie.");
  }

  if (migrationRoutes.length > 0) {
    console.log(`migration smoke routes: ${migrationRoutes.map((route) => `/${route}`).join(", ")}`);
  }

  for (const route of routes) {
    const resolvedRoute = await resolveSmokeRoute(route, cookie);
    const response = await fetch(`${baseUrl}/${resolvedRoute}`, {
      headers: {
        cookie,
      },
      redirect: "manual",
    });
    const html = await response.text();

    if (response.status !== 200) {
      throw new Error(`/${resolvedRoute} returned HTTP ${response.status}.`);
    }

    if (html.includes("Runtime Error")) {
      throw new Error(`/${resolvedRoute} rendered a runtime error.`);
    }

    const markers = routeMarkers[route];

    if (markers && !markers.some((marker) => html.includes(marker))) {
      throw new Error(`/${resolvedRoute} did not include expected marker "${markers.join('" or "')}".`);
    }

    assertSecurityHeaders(response, `/${resolvedRoute}`);
    const contractLabel = resolvedRoute === route ? "" : ` (contract /${route})`;
    console.log(`ok /${resolvedRoute}${contractLabel}`);
  }

  await assertLegacyDashboardRedirect(cookie);

  if (routes.includes("billing")) {
    await assertBillingExportAndPrint(cookie);
  }

  if (routes.includes("settings")) {
    await assertSourceCommissionExport(cookie);
  }

  if (routes.includes("staff")) {
    await assertPayrollPolicyExport(cookie);
  }
}

async function resolveSmokeRoute(route, cookie) {
  const normalized = `/${route.replace(/^\/+/, "")}`;

  if (routeNeedsTreatmentServiceId(normalized)) {
    if (!discoveredPatientId || !discoveredTreatmentServiceId) {
      await discoverTreatmentCase(cookie);
    }

    return materializeTreatmentCaseRoute(
      normalized,
      discoveredPatientId,
      discoveredTreatmentServiceId,
    ).replace(/^\//, "");
  }

  if (!routeNeedsPatientId(normalized)) return normalized.replace(/^\//, "");

  if (!discoveredPatientId) {
    discoveredPatientId = await discoverPatientId(cookie);
  }

  return materializePatientRoute(normalized, discoveredPatientId).replace(/^\//, "");
}

async function discoverPatientId(cookie) {
  const response = await fetch(`${baseUrl}/patients`, {
    headers: { cookie },
    redirect: "manual",
  });
  const html = await response.text();

  if (response.status !== 200) {
    throw new Error(`Cannot discover patient id: /patients returned HTTP ${response.status}.`);
  }

  for (const match of html.matchAll(/href=["']([^"']+)["']/g)) {
    const rawHref = match[1].replaceAll("&amp;", "&");
    let pathname;
    try {
      pathname = new URL(rawHref, baseUrl).pathname;
    } catch {
      continue;
    }
    const patientMatch = pathname.match(/^\/patients\/([^/]+)$/);
    const candidate = patientMatch?.[1];
    if (candidate && !["new", "create"].includes(candidate.toLowerCase())) {
      return decodeURIComponent(candidate);
    }
  }

  throw new Error(
    "Cannot discover a patient detail link from /patients. Set QA_PATIENT_ID or SMOKE_PATIENT_ID before enabling /patients/[patientId].",
  );
}

async function discoverTreatmentCase(cookie) {
  const response = await fetch(`${baseUrl}/treatment`, {
    headers: { cookie },
    redirect: "manual",
  });
  const html = await response.text();

  if (response.status !== 200) {
    throw new Error(`Cannot discover treatment case: /treatment returned HTTP ${response.status}.`);
  }

  for (const match of html.matchAll(/href=["']([^"']+)["']/g)) {
    const rawHref = match[1].replaceAll("&amp;", "&");
    let pathname;
    try {
      pathname = new URL(rawHref, baseUrl).pathname;
    } catch {
      continue;
    }
    const caseMatch = pathname.match(/^\/patients\/([^/]+)\/treatments\/([^/]+)$/);
    if (caseMatch?.[1] && caseMatch?.[2]) {
      discoveredPatientId = decodeURIComponent(caseMatch[1]);
      discoveredTreatmentServiceId = decodeURIComponent(caseMatch[2]);
      return;
    }
  }

  throw new Error(
    "Cannot discover a Treatment Case link from /treatment. Set QA_PATIENT_ID and QA_TREATMENT_SERVICE_ID before enabling Treatment Case QA.",
  );
}

async function assertHealth() {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.text();
  if (!response.ok || !body.includes('"status":"ok"')) {
    throw new Error(`/api/health failed with HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  console.log("ok /api/health");
}

async function fetchText(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}.`);
  }
  return response.text();
}

function cookieHeader(response) {
  const raw = response.headers.get("set-cookie");
  if (!raw) return null;
  return raw
    .split(/,(?=[^;]+=[^;]+)/)
    .map((part) => part.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function assertLegacyDashboardRedirect(cookie) {
  const response = await fetch(`${baseUrl}/dashboard`, {
    headers: { cookie },
    redirect: "manual",
  });
  if (![307, 308].includes(response.status)) {
    throw new Error(`/dashboard did not redirect; received HTTP ${response.status}.`);
  }
  const location = response.headers.get("location") ?? "";
  if (!location.endsWith("/today")) {
    throw new Error(`/dashboard redirected to unexpected location: ${location}`);
  }
  console.log("ok /dashboard -> /today");
}

async function assertBillingExportAndPrint(cookie) {
  const exportResponse = await fetch(`${baseUrl}/billing/export`, {
    headers: { cookie },
    redirect: "manual",
  });
  if (exportResponse.status !== 200) {
    throw new Error(`/billing/export returned HTTP ${exportResponse.status}.`);
  }

  const billingResponse = await fetch(`${baseUrl}/billing`, {
    headers: { cookie },
  });
  const html = await billingResponse.text();
  const invoiceNo = html.match(/\/billing\/print\/([^"'?]+)/)?.[1];
  if (invoiceNo) {
    const printResponse = await fetch(`${baseUrl}/billing/print/${invoiceNo}`, {
      headers: { cookie },
      redirect: "manual",
    });
    if (printResponse.status !== 200) {
      throw new Error(`/billing/print/${invoiceNo} returned HTTP ${printResponse.status}.`);
    }
  }
  console.log("ok billing export/print");
}

async function assertSourceCommissionExport(cookie) {
  const response = await fetch(`${baseUrl}/settings/source-commission-export`, {
    headers: { cookie },
    redirect: "manual",
  });
  if (response.status !== 200) {
    throw new Error(`/settings/source-commission-export returned HTTP ${response.status}.`);
  }
  console.log("ok source commission export");
}

async function assertPayrollPolicyExport(cookie) {
  const response = await fetch(`${baseUrl}/staff/payroll-policy-export`, {
    headers: { cookie },
    redirect: "manual",
  });
  if (response.status !== 200) {
    throw new Error(`/staff/payroll-policy-export returned HTTP ${response.status}.`);
  }
  console.log("ok payroll policy export");
}

function assertSecurityHeaders(response, label) {
  for (const [header, expected] of Object.entries(expectedHeaders)) {
    const actual = response.headers.get(header);
    if (actual !== expected) {
      throw new Error(`${label} ${header} expected ${expected}, received ${actual ?? "missing"}.`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
