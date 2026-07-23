import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  assertSource("src/lib/env.ts", [
    "if (process.env.NODE_ENV === \"production\") {\n    return false;",
    "return process.env.DEFAULT_DATA_SEED_ENABLED === \"true\";",
  ]);
  assertSource("src/app/(auth)/login/page.tsx", [
    "Sign-in is temporarily unavailable. Please try again later.",
  ]);
  assertSourceMissing("src/app/(auth)/login/page.tsx", [
    "DATABASE_URL",
    "Database login",
  ]);
  assertSource("src/lib/runtime-guards.ts", ["assertDemoFallbackAllowed"]);
  assertSource("src/lib/resource-policy.ts", [
    "getAuthorizedPatientFile",
    "canServePatientFile",
    "cleanFileStatuses",
  ]);
  assertSource("src/app/(app)/patient-files/[fileId]/route.ts", [
    "patient_file.blocked",
    "File is not cleared for access.",
    "getAuthorizedPatientFile",
  ]);
  assertSource("src/app/(app)/billing/actions.ts", [
    "nextDocumentNo",
    "nextInvoiceNo(session.organizationId",
    "nextReceiptNo(session.organizationId",
    "nextPaymentPlanNo(session.organizationId",
  ]);
  assertSource("src/lib/pharmacy.ts", [
    "nextDocumentNo",
    "type: \"RX\"",
    "patient: patientAccessWhere(session)",
  ]);
  assertSource("scripts/go-live-check.mjs", [
    "checkSecretHygiene",
    "Add ${pattern} to .gitignore",
  ]);

  await assertDocumentSequenceModel();
  console.log("ok hardening smoke");
}

function assertSource(path, needles) {
  const source = readFileSync(path, "utf8");

  for (const needle of needles) {
    if (!source.includes(needle)) {
      throw new Error(`${path} missing expected hardening marker: ${needle}`);
    }
  }
}

function assertSourceMissing(path, needles) {
  const source = readFileSync(path, "utf8");

  for (const needle of needles) {
    if (source.includes(needle)) {
      throw new Error(`${path} should not include user-facing implementation detail: ${needle}`);
    }
  }
}

async function assertDocumentSequenceModel() {
  const organization = await prisma.organization.findFirst({
    select: {
      id: true,
    },
  });

  if (!organization) {
    console.log("skip document sequence db check: no organization");
    return;
  }

  const sequence = await prisma.documentSequence.upsert({
    where: {
      organizationId_scopeKey_type_year: {
        organizationId: organization.id,
        scopeKey: "hardening-smoke",
        type: "QA",
        year: 2099,
      },
    },
    create: {
      organizationId: organization.id,
      scopeKey: "hardening-smoke",
      type: "QA",
      year: 2099,
      currentValue: 1,
    },
    update: {
      currentValue: {
        increment: 1,
      },
    },
    select: {
      currentValue: true,
    },
  });

  if (sequence.currentValue < 1) {
    throw new Error("DocumentSequence did not allocate a positive value.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
