import { chromium } from "playwright";

const baseUrl = process.env.API_CONTRACT_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.API_CONTRACT_EMAIL ?? "owner@nhavista.vn";
const password = process.env.API_CONTRACT_PASSWORD ?? "CodexSmoke2026!";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  const form = page.locator("form.login-form").first();
  await form.locator('input[type="email"]').fill(email);
  await form.locator('input[name="password"]').fill(password);
  await form.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15_000 });

  for (const route of [
    "/api/imaging/studies",
    "/api/lab/cases",
    "/api/sterilization/cycles",
  ]) {
    const response = await context.request.get(`${baseUrl}${route}`);
    assert(response.status() === 200, `${route} returns 200 for an authorized session`);
    assertNoStore(response, `${route} is not cached`);
  }

  const viewer = await context.request.get(
    `${baseUrl}/api/imaging/studies/api-contract-missing/viewer`,
  );
  assert([404, 503].includes(viewer.status()), "imaging viewer uses a controlled error status");
  assertNoStore(viewer, "imaging viewer is not cached");

  for (const [route, body] of [
    ["/api/lab/cases/api-contract-missing/status", { status: "READY" }],
    ["/api/sterilization/cycles/api-contract-missing/status", { status: "RUNNING" }],
  ]) {
    const response = await context.request.post(`${baseUrl}${route}`, {
      data: body,
      headers: { "content-type": "application/json", origin: baseUrl },
    });
    assert(
      [400, 404, 409, 503].includes(response.status()),
      `${route} uses a controlled status response`,
    );
    assertNoStore(response, `${route} is not cached`);
  }

  const job = await context.request.post(`${baseUrl}/api/jobs/patient-file-gc`, {
    data: {},
    headers: { "content-type": "application/json" },
  });
  assert(job.status() === 401, "patient-file GC rejects an unauthenticated request");

  const fhir = await context.request.get(`${baseUrl}/api/integrations/fhir/patients/contract-smoke`);
  assert(
    fhir.headers()["content-type"]?.startsWith("application/fhir+json"),
    "FHIR route uses the FHIR media type",
  );
  assertNoStore(fhir, "FHIR route is not cached");
  const fhirBody = await fhir.json();
  assert([200, 403, 404, 503].includes(fhir.status()), "FHIR uses a documented status");
  if (fhir.status() === 200) {
    assert(fhirBody.resourceType === "Patient", "enabled FHIR response is a Patient resource");
  } else {
    assert(fhirBody.resourceType === "OperationOutcome", "FHIR error is an OperationOutcome");
  }

  for (const [route, body] of [
    ["/api/imaging/studies", { patientId: "", externalStudyId: "" }],
    ["/api/lab/cases", { patientId: "" }],
    ["/api/sterilization/cycles", { instrumentIds: [] }],
    ["/api/sterilization/instruments", { code: "", name: "", category: "" }],
    ["/api/integrations/connections", { provider: "orthanc", secretRef: "env:ORTHANC_DEFAULT" }],
    ["/api/integrations/payos/payment-links", { patientId: "", amount: 1 }],
    ["/api/integrations/documenso/signing-requests", { patientFormId: "", sourcePatientFileId: "" }],
  ]) {
    const response = await context.request.post(`${baseUrl}${route}`, {
      data: body,
      headers: { "content-type": "application/json" },
    });
    assert(response.status() === 403, `${route} rejects a missing Origin header`);
    const responseBody = await response.json();
    assert(responseBody.error === "csrf-origin-invalid", `${route} reports the CSRF contract`);
  }

  console.log("ok API contract smoke");
} finally {
  await context.close();
  await browser.close();
}

function assert(condition, label) {
  if (!condition) throw new Error(`API contract smoke failed: ${label}`);
  console.log(`ok ${label}`);
}

function assertNoStore(response, label) {
  assert(response.headers()["cache-control"]?.includes("no-store"), label);
}
