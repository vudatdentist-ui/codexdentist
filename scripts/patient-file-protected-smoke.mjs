import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.PATIENT_FILE_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const password = process.env.PATIENT_FILE_SMOKE_OWNER_PASSWORD ?? "CodexSmoke2026!";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  await assertHealth();
  const ownerCookie = await login(
    process.env.PATIENT_FILE_SMOKE_OWNER_EMAIL ?? "owner@nhavista.vn",
    password,
  );
  const patientCookie = await login(
    process.env.PATIENT_FILE_SMOKE_PATIENT_EMAIL ?? "patient@nhavista.vn",
    password,
  );
  const frontdeskCookie = await login(
    process.env.PATIENT_FILE_SMOKE_FRONTDESK_EMAIL ?? "frontdesk@nhavista.vn",
    password,
  );
  const fixture = await createFixture();

  try {
    await assertReadable(ownerCookie, fixture.ownerFile, "owner file");
    await assertReadable(patientCookie, fixture.patientFile, "patient own clean file");
    await assertDenied(patientCookie, fixture.sameEmailFile, "same-email patient file");
    await assertDenied(patientCookie, fixture.otherOrganizationFile, "other-organization patient file");
    await assertDenied(frontdeskCookie, fixture.otherClinicFile, "out-of-scope clinic file");
    await assertDenied(patientCookie, fixture.quarantinedFile, "quarantined patient file");
    await assertDenied(patientCookie, fixture.infectedFile, "infected patient file");
    await assertUnauthenticatedDenied(fixture.ownerFile);
    await assertAuditWritten(fixture.ownerFile);
    console.log("ok patient file protected smoke");
  } finally {
    await cleanupFixture(fixture);
  }
}

async function createFixture() {
  const suffix = randomUUID();
  const owner = await prisma.user.findUniqueOrThrow({
    where: {
      email: process.env.PATIENT_FILE_SMOKE_OWNER_EMAIL ?? "owner@nhavista.vn",
    },
    select: {
      id: true,
      organizationId: true,
    },
  });
  const portalUser = await prisma.user.findUniqueOrThrow({
    where: {
      email: process.env.PATIENT_FILE_SMOKE_PATIENT_EMAIL ?? "patient@nhavista.vn",
    },
    select: {
      id: true,
      email: true,
    },
  });
  const patient = await prisma.patient.findUniqueOrThrow({
    where: {
      portalUserId: portalUser.id,
    },
    select: {
      id: true,
      clinicId: true,
      organizationId: true,
    },
  });
  const sameEmailPatient = await prisma.patient.create({
    data: {
      organizationId: patient.organizationId,
      clinicId: patient.clinicId,
      fullName: "QA Same Email Patient",
      phone: `same-email-${suffix}`,
      email: portalUser.email,
    },
  });
  const otherClinic = await prisma.clinic.create({
    data: {
      organizationId: owner.organizationId,
      name: `QA Isolated Clinic ${suffix}`,
      city: "QA",
      address: "QA only",
    },
  });
  const otherClinicPatient = await prisma.patient.create({
    data: {
      organizationId: owner.organizationId,
      clinicId: otherClinic.id,
      fullName: "QA Other Clinic Patient",
      phone: `other-clinic-${suffix}`,
    },
  });
  const otherOrganization = await prisma.organization.create({
    data: {
      name: `QA File Tenant ${suffix}`,
    },
  });
  const otherOrganizationClinic = await prisma.clinic.create({
    data: {
      organizationId: otherOrganization.id,
      name: "QA File Clinic",
      city: "QA",
      address: "QA only",
    },
  });
  const otherOrganizationUser = await prisma.user.create({
    data: {
      organizationId: otherOrganization.id,
      email: `qa-file-${suffix}@example.test`,
      fullName: "QA File Owner",
      passwordHash: "not-used",
      role: "OWNER",
    },
  });
  const otherOrganizationPatient = await prisma.patient.create({
    data: {
      organizationId: otherOrganization.id,
      clinicId: otherOrganizationClinic.id,
      fullName: "QA Other Organization Patient",
      phone: `other-org-${suffix}`,
    },
  });

  const files = [];
  files.push(await createStoredFile(owner, patient, "NOT_SCANNED", "owner"));
  files.push(await createStoredFile(owner, patient, "CLEAN", "patient-clean"));
  files.push(await createStoredFile(owner, sameEmailPatient, "CLEAN", "same-email"));
  files.push(
    await createStoredFile(
      otherOrganizationUser,
      otherOrganizationPatient,
      "CLEAN",
      "other-organization",
    ),
  );
  files.push(await createStoredFile(owner, otherClinicPatient, "CLEAN", "other-clinic"));
  files.push(await createStoredFile(owner, patient, "QUARANTINED", "quarantined"));
  files.push(await createStoredFile(owner, patient, "INFECTED", "infected"));

  return {
    ownerFile: files[0],
    patientFile: files[1],
    sameEmailFile: files[2],
    otherOrganizationFile: files[3],
    otherClinicFile: files[4],
    quarantinedFile: files[5],
    infectedFile: files[6],
    files,
    patientIds: [
      sameEmailPatient.id,
      otherClinicPatient.id,
      otherOrganizationPatient.id,
    ],
    otherClinicId: otherClinic.id,
    otherOrganizationClinicId: otherOrganizationClinic.id,
    otherOrganizationId: otherOrganization.id,
    otherOrganizationUserId: otherOrganizationUser.id,
  };
}

async function createStoredFile(uploader, patient, virusScanStatus, label) {
  const fileId = randomUUID();
  const body = `patient-file protected smoke ${label} ${new Date().toISOString()}\n`;
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
      uploadedById: uploader.id,
      category: "QA_PROTECTED_ROUTE",
      title: `QA protected patient file ${label}`,
      fileName: `${fileId}.txt`,
      mimeType: "text/plain",
      url: `/patient-files/${fileId}`,
      sizeBytes: bytes.byteLength,
      sourceType: "LOCAL_UPLOAD",
      sourceId: storageKey,
      storageProvider: "local",
      storageKey,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      virusScanStatus,
      notes: "Localhost-only protected route smoke fixture.",
    },
  });

  return {
    absolutePath,
    body,
    fileId,
  };
}

async function cleanupFixture(fixture) {
  await prisma.auditLog.deleteMany({
    where: {
      entityType: "PatientFile",
      entityId: {
        in: fixture.files.map((file) => file.fileId),
      },
    },
  });
  await prisma.patientFile.deleteMany({
    where: {
      id: {
        in: fixture.files.map((file) => file.fileId),
      },
    },
  });
  await prisma.patient.deleteMany({
    where: {
      id: {
        in: fixture.patientIds,
      },
    },
  });
  await prisma.clinic.delete({
    where: {
      id: fixture.otherClinicId,
    },
  });
  await prisma.user.delete({
    where: {
      id: fixture.otherOrganizationUserId,
    },
  });
  await prisma.clinic.delete({
    where: {
      id: fixture.otherOrganizationClinicId,
    },
  });
  await prisma.organization.delete({
    where: {
      id: fixture.otherOrganizationId,
    },
  });
  await Promise.all(
    fixture.files.map((file) => unlink(file.absolutePath).catch(() => {})),
  );
}

async function assertReadable(cookie, fixture, label) {
  const response = await fetch(`${baseUrl}/patient-files/${fixture.fileId}`, {
    headers: {
      cookie,
    },
  });
  const text = await response.text();

  if (response.status !== 200 || text !== fixture.body) {
    throw new Error(`${label} fetch failed: HTTP ${response.status}`);
  }

  if (response.headers.get("x-content-type-options") !== "nosniff") {
    throw new Error(`${label} response missing nosniff header`);
  }

  console.log(`ok ${label} fetch`);
}

async function assertDenied(cookie, fixture, label) {
  const response = await fetch(`${baseUrl}/patient-files/${fixture.fileId}`, {
    headers: {
      cookie,
    },
    redirect: "manual",
  });

  if (response.status === 200) {
    throw new Error(`${label} unexpectedly returned 200`);
  }

  console.log(`ok denied ${label} ${response.status}`);
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

async function login(email, loginPassword) {
  const html = await fetchText("/login");
  const action = html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

  if (!action) {
    throw new Error("Could not find login action.");
  }

  const form = new FormData();
  form.set(action, "");
  form.set("email", email);
  form.set("password", loginPassword);

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
