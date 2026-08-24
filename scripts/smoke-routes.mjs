import {
  enabledMigrationRoutes,
  materializePatientRoute,
  routeNeedsPatientId,
} from "./qa-route-contract.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.SMOKE_EMAIL ?? "owner@nhavista.vn";
const password = process.env.SMOKE_PASSWORD ?? process.env.SMOKE_USER_PASSWORD ?? "CodexSmoke2026!";

const defaultRoutes = [
  "today",
  "schedule",
  "patients",
  "journey",
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
  journey: ["Patient journey", "Hành trình bệnh nhân"],
  clinical: ["Patient journey", "Hành trình bệnh nhân"],
  treatment: ["Patient journey", "Hành trình bệnh nhân"],
  billing: ["Billing and collections", "Thanh toán và công nợ"],
  accounting: ["Accounting", "Kế toán"],
  services: ["Service management", "Quản lý dịch vụ"],
  staff: ["Staff and time clock", "Nhân sự và chấm công"],
  crm: ["Customer care", "Chăm sóc khách hàng"],
  inventory: ["Equipment and supplies", "Thiết bị và vật tư tiêu hao"],
  pharmacy: ["Prescriptions and drug library", "Đơn thuốc và thư viện thuốc"],
  forms: ["Forms and consent library", "Biểu mẫu và phiếu đồng thuận"],
  learning: ["Digital library and courses", "Thư viện số và khóa học"],
  "employee-app": ["Staff mobile app", "Ứng dụng nhân viên"],
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

async function assertHealth() {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json().catch(() => ({}));

  if (response.status !== 200 || body.status !== "ok" || body.database !== "ok") {
    throw new Error(`/api/health is not healthy: HTTP ${response.status}`);
  }

  assertSecurityHeaders(response, "/api/health");
  console.log("ok /api/health");
}

async function assertLegacyDashboardRedirect(cookie) {
  const response = await fetch(`${baseUrl}/dashboard`, {
    headers: { cookie },
    redirect: "manual",
  });
  const location = response.headers.get("location");
  const pathname = location ? new URL(location, baseUrl).pathname : null;

  if (![303, 307, 308].includes(response.status) || pathname !== "/today") {
    throw new Error(
      `/dashboard compatibility route expected redirect to /today, received HTTP ${response.status} -> ${location ?? "no location"}.`,
    );
  }

  assertSecurityHeaders(response, "/dashboard");
  console.log("ok /dashboard -> /today");
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

function assertSecurityHeaders(response, label) {
  for (const [header, expectedValue] of Object.entries(expectedHeaders)) {
    const actualValue = response.headers.get(header);

    if (actualValue !== expectedValue) {
      throw new Error(
        `${label} missing security header ${header}: expected "${expectedValue}", received "${actualValue}".`,
      );
    }
  }
}

async function assertBillingExportAndPrint(cookie) {
  const exportResponse = await fetch(`${baseUrl}/billing/export`, {
    headers: {
      cookie,
    },
  });
  const csv = await exportResponse.text();

  if (exportResponse.status !== 200) {
    throw new Error(`/billing/export returned HTTP ${exportResponse.status}.`);
  }

  if (!csv.includes("invoice_no")) {
    throw new Error("/billing/export did not include expected invoice CSV data.");
  }
  const invoiceNo = csv
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(",")[0]?.replace(/^"|"$/g, ""))
    .find(Boolean);

  assertSecurityHeaders(exportResponse, "/billing/export");

  if (!invoiceNo) {
    console.log("ok billing export/print (no invoices)");
    return;
  }

  const printPath = `/billing/print/${encodeURIComponent(invoiceNo)}`;
  const printResponse = await fetch(`${baseUrl}${printPath}`, {
    headers: {
      cookie,
    },
  });
  const printHtml = await printResponse.text();

  if (printResponse.status !== 200) {
    throw new Error(`${printPath} returned HTTP ${printResponse.status}.`);
  }

  if (!printHtml.includes("Clinic invoice") || !printHtml.includes(invoiceNo)) {
    throw new Error(`${printPath} did not include the printable invoice.`);
  }

  assertSecurityHeaders(printResponse, printPath);
  console.log("ok billing export/print");
}

async function assertSourceCommissionExport(cookie) {
  const exportResponse = await fetch(`${baseUrl}/settings/source-commission-export`, {
    headers: {
      cookie,
    },
  });
  const csv = await exportResponse.text();

  if (exportResponse.status !== 200) {
    throw new Error(`/settings/source-commission-export returned HTTP ${exportResponse.status}.`);
  }

  if (!csv.includes("commission_amount")) {
    throw new Error("/settings/source-commission-export did not include source commission CSV data.");
  }

  assertSecurityHeaders(exportResponse, "/settings/source-commission-export");
  console.log("ok source commission export");
}

async function assertPayrollPolicyExport(cookie) {
  const exportResponse = await fetch(`${baseUrl}/staff/payroll-policy-export`, {
    headers: {
      cookie,
    },
  });
  const csv = await exportResponse.text();

  if (exportResponse.status !== 200) {
    throw new Error(`/staff/payroll-policy-export returned HTTP ${exportResponse.status}.`);
  }

  if (!csv.includes("scope_key")) {
    throw new Error("/staff/payroll-policy-export did not include payroll policy CSV headers.");
  }

  assertSecurityHeaders(exportResponse, "/staff/payroll-policy-export");
  console.log("ok payroll policy export");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});