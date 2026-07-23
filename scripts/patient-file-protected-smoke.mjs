import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.PATIENT_FILE_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  await assertHealth();
  const ownerCookie = await login(
    process.env.PATIENT_FILE_SMOKE_OWNER_EMAIL ?? "owner@nhavista.vn",
    process.env.PATIENT_FILE_SMOKE_OWNER_PASSWORD ?? "CodexSmoke2026!",
  );
  const fixture = await createFixture();
  await assertOwnerCanRead(ownerCookie, fixture);
  await assertUnauthenticatedDenied(fixture);
  await assertAuditWritten(fixture);
  console.log("ok patient file protected smoke");
}

async function createFixture() {
  const owner = await prisma.user.findFirstOrThrow({
    where: {
      email: process.env.PATIENT_FILE_SMOKE_OWNER_EMAIL ?? "owner@nhavista.vn",
    },
    select: {
      id: true,
      organizationId: true,
    },
  });
  const patient = await prisma.patient.findFirstOrThrow({
    where: {
      organizationId: owner.organizationId,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      clinicId: true,
      organizationId: true,
    },
  });
  const fileId = randomUUID();
  const body = `patient-file protected smoke ${new Date().toISOString()}\n`;
  const bytes = Buffer.from(body, "utf8");
  const storageKey = `patient-files/${patient.organizationId}/${patient.id}/${fileId}.txt`;
  const storageRelativePath = storageKey.replace(/^patient-files\//, "");
  const absolutePath = path.resolve("storage", "patient-files", storageRelativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes, { flag: "wx" });

  await prisma.patientFile.create({
    data: {
      id: fileId,
      organizationId: patient.organizationId,
      clinicId: patient.clinicId,
      patientId: patient.id,
      uploadedById: owner.id,
      category: "QA_PROTECTED_ROUTE",
      title: "QA protected patient file smoke",
      fileName: `${fileId}.txt`,
      mimeType: "text/plain",
      url: `/patient-files/${fileId}`,
      sizeBytes: bytes.byteLength,
      sourceType: "LOCAL_UPLOAD",
      sourceId: storageKey,
      storageProvider: "local",
      storageKey,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      virusScanStatus: "NOT_SCANNED",
      notes: "Localhost-only protected route smoke fixture.",
    },
  });

  return {
    body,
    fileId,
  };
}

async function assertOwnerCanRead(cookie, fixture) {
  const response = await fetch(`${baseUrl}/patient-files/${fixture.fileId}`, {
    headers: {
      cookie,
    },
  });
  const text = await response.text();

  if (response.status !== 200) {
    throw new Error(`owner patient file fetch failed: HTTP ${response.status}`);
  }

  if (text !== fixture.body) {
    throw new Error("owner patient file fetch returned unexpected body");
  }

  if (response.headers.get("x-content-type-options") !== "nosniff") {
    throw new Error("patient file response missing nosniff header");
  }

  console.log("ok owner protected patient file fetch");
}

async function assertUnauthenticatedDenied(fixture) {
  const response = await fetch(`${baseUrl}/patient-files/${fixture.fileId}`, {
    redirect: "manual",
  });

  if (response.status === 200) {
    throw new Error("unauthenticated patient file fetch unexpectedly returned 200");
  }

  console.log(`ok unauthenticated patient file denied ${response.status}`);
}

async function assertAuditWritten(fixture) {
  const audit = await prisma.auditLog.findFirst({
    where: {
      entityType: "PatientFile",
      entityId: fixture.fileId,
      action: "patient_file.viewed",
    },
  });

  if (!audit) {
    throw new Error("patient file view audit log was not written");
  }

  console.log("ok patient file view audit");
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

async function fetchText(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);

  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}.`);
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

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
