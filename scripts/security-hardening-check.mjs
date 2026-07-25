import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

assertEqual(packageJson.dependencies.next, "16.2.11", "Next.js security patch");
assertEqual(packageJson.dependencies.sharp, "0.35.3", "Sharp security patch");

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
  'headerStore.get("cf-connecting-ip")',
  'deploymentMode() === "self-hosted"',
]);
assertSource("src/lib/rate-limit.ts", [
  'INSERT INTO "SecurityRateLimitBucket"',
  'createHash("sha256")',
  "allowed: false",
]);
assertSource("src/lib/patient-file-storage.ts", [
  "validateUploadContent",
  "detectImageMimeType",
  "sharp.block",
  "limitInputPixels: 40_000_000",
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
