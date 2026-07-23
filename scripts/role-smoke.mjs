const baseUrl = process.env.ROLE_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const sharedPassword = process.env.ROLE_SMOKE_PASSWORD ?? "CodexSmoke2026!";
const roleFilter = process.env.ROLE_SMOKE_ONLY?.trim().toLowerCase() ?? "";

const accounts = [
  {
    label: "owner",
    email: process.env.ROLE_SMOKE_OWNER_EMAIL ?? "owner@nhavista.vn",
    password: process.env.ROLE_SMOKE_OWNER_PASSWORD ?? sharedPassword,
    allow: ["dashboard", "reports", "accounting", "schedule", "patients", "journey", "billing", "staff", "settings"],
    deny: [],
  },
  {
    label: "area",
    email: process.env.ROLE_SMOKE_AREA_EMAIL ?? "area@nhavista.vn",
    password: process.env.ROLE_SMOKE_AREA_PASSWORD ?? sharedPassword,
    allow: ["dashboard", "reports", "accounting", "schedule", "patients", "journey", "billing", "staff", "settings"],
    deny: [],
  },
  {
    label: "manager",
    email: process.env.ROLE_SMOKE_MANAGER_EMAIL ?? "manager@nhavista.vn",
    password: process.env.ROLE_SMOKE_MANAGER_PASSWORD ?? sharedPassword,
    allow: ["dashboard", "schedule", "patients", "journey", "billing", "staff", "settings"],
    deny: [],
  },
  {
    label: "frontdesk",
    email: process.env.ROLE_SMOKE_FRONTDESK_EMAIL ?? "frontdesk@nhavista.vn",
    password: process.env.ROLE_SMOKE_FRONTDESK_PASSWORD ?? sharedPassword,
    allow: ["schedule", "patients", "journey", "billing", "crm"],
    deny: ["settings", "staff", "accounting", "reports"],
  },
  {
    label: "dentist",
    email: process.env.ROLE_SMOKE_DENTIST_EMAIL ?? "dentist@nhavista.vn",
    password: process.env.ROLE_SMOKE_DENTIST_PASSWORD ?? sharedPassword,
    allow: ["schedule", "journey", "clinical", "pharmacy"],
    deny: ["billing", "settings", "reports"],
  },
  {
    label: "hygienist",
    email: process.env.ROLE_SMOKE_HYGIENIST_EMAIL ?? "hygienist@nhavista.vn",
    password: process.env.ROLE_SMOKE_HYGIENIST_PASSWORD ?? sharedPassword,
    allow: ["schedule", "patients", "journey", "clinical", "pharmacy", "employee-app"],
    deny: ["billing", "settings", "reports"],
  },
  {
    label: "billing",
    email: process.env.ROLE_SMOKE_BILLING_EMAIL ?? "billing@nhavista.vn",
    password: process.env.ROLE_SMOKE_BILLING_PASSWORD ?? sharedPassword,
    allow: ["patients", "journey", "billing", "services", "employee-app"],
    deny: ["settings", "staff", "accounting", "reports"],
  },
  {
    label: "patient",
    email: process.env.ROLE_SMOKE_PATIENT_EMAIL ?? "patient@nhavista.vn",
    password: process.env.ROLE_SMOKE_PATIENT_PASSWORD ?? sharedPassword,
    allow: ["patient-app"],
    deny: ["dashboard", "settings", "billing", "journey"],
  },
];

async function main() {
  const selectedAccounts = roleFilter
    ? accounts.filter((account) => account.label === roleFilter)
    : accounts;

  if (selectedAccounts.length === 0) {
    throw new Error(`Unknown ROLE_SMOKE_ONLY value: ${roleFilter}`);
  }

  const authenticatedAccounts = [];

  for (const account of selectedAccounts) {
    console.log(`authenticating role ${account.label}`);
    authenticatedAccounts.push({
      account,
      cookie: await login(account.email, account.password),
    });
  }

  for (const { account, cookie } of authenticatedAccounts) {
    console.log(`checking role ${account.label}`);
    for (const route of account.allow) {
      console.log(`  allow /${route}`);
      await assertAllowed(account, cookie, route);
    }

    for (const route of account.deny) {
      console.log(`  deny /${route}`);
      await assertDenied(account, cookie, route);
    }

    console.log(`ok role ${account.label}`);
  }
}

async function assertAllowed(account, cookie, route) {
  const response = await fetchWithTimeout(`${baseUrl}/${route}`, {
    headers: { cookie },
    redirect: "manual",
  }, `${account.label} allow /${route}`);
  const body = await response.text();

  if (response.status !== 200 || body.includes("Runtime Error")) {
    throw new Error(`${account.label} could not use /${route}: HTTP ${response.status}`);
  }
}

async function assertDenied(account, cookie, route) {
  const response = await fetchWithTimeout(`${baseUrl}/${route}`, {
    headers: { cookie },
    redirect: "manual",
  }, `${account.label} deny /${route}`);

  if (response.status === 200) {
    throw new Error(`${account.label} unexpectedly accessed /${route}.`);
  }

  if (![302, 303, 307, 308].includes(response.status)) {
    throw new Error(`${account.label} deny check for /${route} returned HTTP ${response.status}.`);
  }
}

async function login(email, password) {
  const html = await fetchText("/login");
  const action = html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

  if (!action) {
    throw new Error("Could not find login action.");
  }

  const multipart = multipartBody({
    [action]: "",
    email,
    password,
  });

  const response = await fetchWithTimeout(`${baseUrl}/login`, {
    method: "POST",
    body: multipart.body,
    headers: {
      "content-type": `multipart/form-data; boundary=${multipart.boundary}`,
    },
    redirect: "manual",
  }, `login ${email}`);

  if (![303, 200].includes(response.status)) {
    throw new Error(`Login failed for ${email}: HTTP ${response.status}`);
  }

  const cookie = cookieHeader(response);
  await response.arrayBuffer();

  if (!cookie) {
    throw new Error(`Login did not return a cookie for ${email}.`);
  }

  return cookie;
}

async function fetchText(path) {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, {}, `GET ${path}`);

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}.`);
  }

  return response.text();
}

async function fetchWithTimeout(url, options, label) {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new Error(`${label} timed out or failed`, { cause: error });
  }
}

function multipartBody(fields) {
  const boundary = `----codexdentist-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const parts = Object.entries(fields).map(
    ([name, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );

  return {
    boundary,
    body: `${parts.join("")}--${boundary}--\r\n`,
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
