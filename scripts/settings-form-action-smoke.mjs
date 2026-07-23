import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.SETTINGS_FORM_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.SETTINGS_FORM_SMOKE_EMAIL ?? "owner@nhavista.vn";
const password = process.env.SETTINGS_FORM_SMOKE_PASSWORD ?? "demo1234";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const fixture = {
  chainName: `MFORM Chain ${suffix}`,
  chainNameUpdated: `MFORM Chain Updated ${suffix}`,
  clinicName: `MFORM Clinic ${suffix}`,
  clinicNameUpdated: `MFORM Clinic Updated ${suffix}`,
};

async function main() {
  const cookie = await login();

  try {
    const settingsHtml = await getPage("/settings", cookie);
    const createChainAction = actionForForm(settingsHtml, {
      include: ["name", "brandName", "phone"],
      exclude: ["chainId", "clinicId", "city", "address"],
    });

    await postAction(cookie, createChainAction, {
      name: fixture.chainName,
      brandName: `Brand ${suffix}`,
      phone: "0900000000",
    });

    const chain = await prisma.chain.findFirstOrThrow({
      where: { name: fixture.chainName },
      select: { id: true, organizationId: true },
    });
    console.log("ok create chain form");

    const refreshedAfterChain = await getPage("/settings", cookie);
    const updateChainAction = actionForForm(refreshedAfterChain, {
      include: ["chainId", "legalName", "specialty", "taxCode", "website"],
      exclude: ["clinicId"],
    });
    await postAction(cookie, updateChainAction, {
      chainId: chain.id,
      name: fixture.chainNameUpdated,
      legalName: `Legal ${suffix}`,
      brandName: `Brand Updated ${suffix}`,
      taxCode: `TAX${suffix}`,
      phone: "0911111111",
      email: `chain-${suffix}@example.test`,
      website: "https://example.test",
      specialty: "DENTAL",
    });
    console.log("ok update chain form");

    const refreshedAfterUpdate = await getPage("/settings", cookie);
    const createClinicAction = actionForForm(refreshedAfterUpdate, {
      include: ["name", "city", "address", "phone"],
      exclude: ["clinicId", "legalName"],
    });
    await postAction(cookie, createClinicAction, {
      chainId: chain.id,
      name: fixture.clinicName,
      city: "QA",
      address: "Disposable form fixture",
      phone: "0922222222",
    });

    const clinic = await prisma.clinic.findFirstOrThrow({
      where: { name: fixture.clinicName },
      select: { id: true },
    });
    console.log("ok create clinic form");

    const refreshedAfterClinic = await getPage("/settings", cookie);
    const updateClinicAction = actionForForm(refreshedAfterClinic, {
      include: ["clinicId", "chainId", "city", "address", "phone"],
      exclude: ["legalName"],
    });
    await postAction(cookie, updateClinicAction, {
      clinicId: clinic.id,
      chainId: chain.id,
      name: fixture.clinicNameUpdated,
      city: "QA2",
      address: "Disposable form fixture updated",
      phone: "0933333333",
    });
    console.log("ok update clinic form");

    const refreshedAfterClinicUpdate = await getPage("/settings", cookie);
    const toggleClinicAction = actionForForm(refreshedAfterClinicUpdate, {
      include: ["clinicId", "active"],
      exclude: ["name", "city", "address"],
    });
    await postAction(cookie, toggleClinicAction, {
      clinicId: clinic.id,
      active: "false",
    });
    await postAction(cookie, toggleClinicAction, {
      clinicId: clinic.id,
      active: "true",
    });
    console.log("ok toggle clinic form");

    const refreshedAfterToggle = await getPage("/settings", cookie);
    const toggleChainAction = actionForForm(refreshedAfterToggle, {
      include: ["chainId", "active"],
      exclude: ["name", "legalName", "clinicId"],
    });
    await postAction(cookie, toggleChainAction, {
      chainId: chain.id,
      active: "false",
    });
    await postAction(cookie, toggleChainAction, {
      chainId: chain.id,
      active: "true",
    });
    console.log("ok toggle chain form");

    const finalChain = await prisma.chain.findUniqueOrThrow({
      where: { id: chain.id },
      select: {
        active: true,
        name: true,
        clinics: {
          where: { id: clinic.id },
          select: { active: true, name: true },
        },
      },
    });

    if (
      !finalChain.active ||
      finalChain.name !== fixture.chainNameUpdated ||
      finalChain.clinics[0]?.name !== fixture.clinicNameUpdated ||
      !finalChain.clinics[0]?.active
    ) {
      throw new Error("Settings form lifecycle did not persist expected final state.");
    }

    console.log("ok settings form action lifecycle");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

function actionForForm(html, options) {
  const forms = Array.from(html.matchAll(/<form[\s\S]*?<\/form>/g)).map((match) => match[0]);
  const form = forms.find((candidate) => {
    const names = Array.from(candidate.matchAll(/name="([^"]+)"/g)).map((match) => match[1]);

    return (
      options.include.every((name) => names.includes(name)) &&
      (options.exclude ?? []).every((name) => !names.includes(name))
    );
  });

  if (!form) {
    throw new Error(`Could not find form with fields: ${options.include.join(", ")}`);
  }

  const actionName = form.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

  if (!actionName) {
    throw new Error(`Could not find server action field for: ${options.include.join(", ")}`);
  }

  return actionName;
}

async function postAction(cookie, actionName, fields) {
  const form = new FormData();
  form.set(actionName, "");

  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  const response = await fetch(`${baseUrl}/settings`, {
    method: "POST",
    body: form,
    headers: {
      cookie,
      origin: baseUrl,
    },
    redirect: "manual",
  });

  if (![200, 303].includes(response.status)) {
    throw new Error(`Server action failed with HTTP ${response.status}`);
  }
}

async function getPage(path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      cookie,
      origin: baseUrl,
    },
  });

  if (response.status !== 200) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  return response.text();
}

async function login() {
  const html = await getPage("/login", "");
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
    throw new Error(`Login failed with HTTP ${response.status}.`);
  }

  const cookie = cookieHeader(response);

  if (!cookie) {
    throw new Error("Login did not return a session cookie.");
  }

  return cookie;
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
  const chains = await prisma.chain.findMany({
    where: {
      name: {
        in: [fixture.chainName, fixture.chainNameUpdated],
      },
    },
    select: {
      id: true,
      clinics: {
        select: {
          id: true,
        },
      },
    },
  });
  const clinicIds = chains.flatMap((chain) => chain.clinics.map((clinic) => clinic.id));
  const chainIds = chains.map((chain) => chain.id);

  if (clinicIds.length > 0) {
    await prisma.userClinic.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
  }

  if (chainIds.length > 0) {
    await prisma.chain.deleteMany({ where: { id: { in: chainIds } } });
  }

  console.log("ok cleanup");
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
