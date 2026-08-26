import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

assertEqual(packageJson.dependencies.next, "16.2.11", "Next.js security patch");
assertEqual(packageJson.dependencies.sharp, "0.35.3", "Sharp security patch");
assertEqual(packageJson.scripts.prebuild, "npm run typecheck", "Release typecheck gate");

assertSourceMissing("next.config.ts", ["'unsafe-eval'"]);
assertSource("next.config.ts", ["allowedOrigins: serverActionAllowedOrigins"]);
assertSource("src/proxy.ts", [
  'status: 405',
  'status: 421',
  "isTrustedRequestHostname",
]);
assertSource("src/app/api/readiness/route.ts", [
  "verifyJobRequest(request)",
  '"Cache-Control": "no-store"',
]);
assertSource("src/lib/request-ip.ts", [
  "trustedProxyProvider()",
  'provider === "cloudflare"',
  'provider === "reverse-proxy"',
]);
assertSource("src/lib/rate-limit.ts", [
  'INSERT INTO "SecurityRateLimitBucket"',
  'createHash("sha256")',
  "allowed: false",
  '"ai-user"',
  '"ai-organization"',
]);
assertSource("src/app/(auth)/login/actions.ts", [
  "`account:${email}`",
  "limits.some((limit) => !limit.allowed)",
]);
assertSource("src/lib/task-inbox.ts", [
  "credentialNotificationTemplateKeys",
  "userId: null",
]);
assertSource("src/app/(app)/settings/actions.ts", [
  "assertCanManageStaffTarget(session, user)",
  "assertAnotherActiveOwner",
]);
assertSource("src/lib/csv.ts", [
  "spreadsheetFormulaPrefix",
  "safeText",
]);
assertSourceMissing("src/app/(auth)/login/actions.ts", [
  "body: rendered.body",
]);
assertSourceMissing("src/app/(app)/settings/actions.ts", [
  "body: rendered.body",
]);
assertSource("src/lib/patient-file-storage.ts", [
  "validateUploadContent",
  "detectImageMimeType",
  "sharp.block",
  "limitInputPixels: 40_000_000",
]);
assertSource("src/lib/password-reset.ts", [
  "runSerializableTransaction",
  "passwordResetToken.updateMany",
  "claim.count !== 1",
]);
assertSource("src/lib/patient-access.ts", [
  'session.role === "PATIENT"',
  "portalUserId: session.userId",
]);
assertSource("src/lib/application/revenue/commands.ts", [
  "runSerializableTransaction",
  "recordInvoicePaymentCommand",
  "recordPatientReceiptCommand",
  "recordServiceCollectionCommand",
  "issueServiceInvoiceCommand",
  "voidInvoiceCommand",
  "recordInvoiceRefundCommand",
]);
assertSource("src/app/(app)/billing/actions.ts", [
  '@/lib/application/revenue/commands',
]);
assertSourceMissing("src/app/(app)/billing/actions.ts", [
  "runSerializableTransaction",
  '@/lib/prisma',
]);
assertSource("src/app/(app)/patient-app/actions.ts", [
  'status: "REQUESTED"',
  'status: "PRESENTED"',
  'in: ["OPEN", "PARTIAL"]',
]);

console.log("ok security hardening check");

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function assertSource(path, needles) {
  const source = readFileSync(path, "utf8");

  for (const needle of needles) {
    if (!source.includes(needle)) {
      throw new Error(`${path} missing security marker: ${needle}`);
    }
  }
}

function assertSourceMissing(path, needles) {
  const source = readFileSync(path, "utf8");

  for (const needle of needles) {
    if (source.includes(needle)) {
      throw new Error(`${path} contains forbidden security marker: ${needle}`);
    }
  }
}