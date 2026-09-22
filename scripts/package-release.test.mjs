import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packageRelease } from "./package-release.mjs";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const script = fileURLToPath(new URL("./package-release.mjs", import.meta.url));
const required = {
  ".next/BUILD_ID": "fixture-build\n",
  ".next/server/app/login.html": "<html>synthetic login fixture</html>",
  ".next/static/chunks/app.js": "fixture",
  "public/odontogram-assets/tooth.svg": "<svg/>",
  "prisma/schema.prisma": "// schema fixture\n",
  "prisma/infrastructure.prisma": "// external tables fixture\n",
  "prisma/migrations/fixture/migration.sql": "SELECT 1;\n",
  "src/app/page.tsx": "export default function Page() { return null; }\n",
  "scripts/fixture.mjs": "console.log('fixture');\n",
  "package.json": '{"scripts":{"start":"next start"}}\n',
  "package-lock.json": '{"lockfileVersion":3}\n',
  "prisma.config.ts": "export default {};\n",
  "next.config.ts": "export default {};\n",
  "server.cjs": "// server fixture\n",
  "tsconfig.json": "{}\n",
  "next-env.d.ts": "// types fixture\n",
  "LICENSE": "AGPL-3.0-or-later\n",
};
function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "codexdentist-package-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(required)) put(root, path, text);
  return root;
}
function unpack(root, archive) {
  const extracted = join(root, "extracted");
  mkdirSync(extracted);
  execFileSync("tar", ["-xzf", archive, "-C", extracted]);
  return extracted;
}

test("packages into the source root twice without self-inclusion; verifies the extracted runtime", (t) => {
  const root = fixture(t);
  const output = join(root, "release.tar.gz");
  packageRelease({ sourceDir: root, outputPath: output, sha });
  packageRelease({ sourceDir: root, outputPath: output, sha: otherSha });
  const extracted = unpack(root, output);
  for (const [path, text] of Object.entries(required)) {
    assert.equal(readFileSync(join(extracted, path), "utf8"), text, path);
  }
  assert.equal(readFileSync(join(extracted, ".codexdentist-release-sha"), "utf8"), `${otherSha}\n`);
  assert.equal(existsSync(join(extracted, "release.tar.gz")), false);
  assert.equal(existsSync(join(root, ".codexdentist-release-sha")), false, "does not modify source identity");
});

test("excludes environments, patient storage, backups, QA output, dependencies and caches without deleting originals", (t) => {
  const root = fixture(t);
  const excluded = [
    ".env", ".env.production", "public/.env.local", "src/nested/.env",
    "storage/patient.bin", "backups/database.sql", "output/playwright/patient.png",
    "node_modules/private.txt", ".git/config", "coverage/report.json",
    "test-results/trace.zip", "playwright-report/index.html", ".tmp/upload.bin",
    ".next/cache/private.bin", "src/debug.log", "scripts/tsconfig.tsbuildinfo",
  ];
  for (const path of excluded) put(root, path, "private fixture");
  const output = join(root, "release.tar.gz");
  packageRelease({ sourceDir: root, outputPath: output, sha });
  const extracted = unpack(root, output);
  for (const path of excluded) {
    assert.equal(existsSync(join(extracted, path)), false, path);
    assert.equal(readFileSync(join(root, path), "utf8"), "private fixture", path);
  }
});

test("rejects absent or empty build artifacts and keeps the previous release", (t) => {
  for (const missing of [".next/BUILD_ID", ".next/server", ".next/static", "server.cjs", "prisma/schema.prisma", "package-lock.json", "src"]) {
    const root = fixture(t);
    const output = join(root, "release.tar.gz");
    writeFileSync(output, "previous release");
    rmSync(join(root, missing), { recursive: true });
    assert.throws(() => packageRelease({ sourceDir: root, outputPath: output, sha }), /Missing release input|Release requires/);
    assert.equal(readFileSync(output, "utf8"), "previous release");
  }
  const root = fixture(t);
  put(root, ".next/BUILD_ID", "  \n");
  assert.throws(() => packageRelease({ sourceDir: root, outputPath: join(root, "release.tar.gz"), sha }), /verification/);
});

test("rejects invalid release identities before publishing", (t) => {
  const root = fixture(t);
  const output = join(root, "release.tar.gz");
  for (const value of [undefined, "main", "a".repeat(39), "../invalid", `${sha}\n`]) {
    assert.throws(() => packageRelease({ sourceDir: root, outputPath: output, sha: value }), /Release SHA/);
  }
  assert.equal(existsSync(output), false);
});

test("rejects symbolic links inside runtime inputs and output paths that overwrite inputs", (t) => {
  const root = fixture(t);
  put(root, "storage/private.txt", "sensitive fixture");
  symlinkSync(join(root, "storage"), join(root, "public", "uploads"));
  assert.throws(() => packageRelease({ sourceDir: root, outputPath: join(root, "release.tar.gz"), sha }), /Unsupported release input/);
  rmSync(join(root, "public", "uploads"));
  for (const path of ["package.json", "public/release.tar.gz", ".next/release.tar.gz"]) {
    assert.throws(() => packageRelease({ sourceDir: root, outputPath: join(root, path), sha }), /outside runtime/);
  }
  assert.equal(readFileSync(join(root, "package.json"), "utf8"), required["package.json"]);
});

test("propagates tar failures instead of masking them or replacing the previous archive", (t) => {
  const root = fixture(t);
  const bin = join(root, "fake-bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "tar"), "#!/bin/sh\nexit 9\n", { mode: 0o755 });
  const output = join(root, "release.tar.gz");
  writeFileSync(output, "previous release");
  const result = spawnSync(process.execPath, [script, sha, output, root], {
    encoding: "utf8", env: { ...process.env, PATH: bin },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Command failed: tar/);
  assert.equal(readFileSync(output, "utf8"), "previous release");
});


test("CI verifies packaging and extracted boot on PRs while publishing only from main", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const steps = workflow.split(/(?=^      - )/m);
  const packaging = steps.find((step) => step.startsWith("      - name: Package production release artifact\n"));
  const boot = steps.find((step) => step.startsWith("      - name: Verify extracted hosted release boots\n"));
  const upload = steps.find((step) => step.startsWith("      - name: Upload production release artifact\n"));
  assert.ok(packaging && boot && upload, "release gates must remain explicit");
  assert.doesNotMatch(packaging, /^        if:/m);
  assert.doesNotMatch(boot, /^        if:/m);
  assert.match(packaging, /node scripts\/package-release\.mjs/);
  assert.match(boot, /tar -xzf/);
  assert.match(boot, /node server\.cjs/);
  assert.match(upload, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.ok(steps.indexOf(packaging) < steps.indexOf(boot));
  assert.ok(steps.indexOf(boot) < steps.indexOf(upload));
});


function dependency(root, name, value) {
  put(root, `node_modules/${name}/package.json`, JSON.stringify({ name, main: "index.cjs" }));
  put(root, `node_modules/${name}/index.cjs`, `module.exports = ${JSON.stringify(value)};`);
}

function alias(root, name, target) {
  const path = join(root, ".next/node_modules", name);
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
  return path;
}

test("preserves portable Turbopack aliases without bundling installed dependencies", (t) => {
  const root = fixture(t);
  const names = ["pg", "@prisma/client"];
  for (const name of names) {
    dependency(root, name, `source-${name}`);
    const link = join(root, ".next/node_modules", `${name}-0123456789abcdef`);
    const target = join(root, "node_modules", name);
    // Both absolute build-host links and already-relative links become portable.
    alias(root, `${name}-0123456789abcdef`, name === "pg" ? target : relative(dirname(link), target));
  }
  const output = join(root, "release.tar.gz");
  packageRelease({ sourceDir: root, outputPath: output, sha });
  const extracted = unpack(root, output);
  assert.equal(existsSync(join(extracted, "node_modules")), false, "dependencies must be installed separately");
  for (const name of names) {
    const link = join(extracted, ".next/node_modules", `${name}-0123456789abcdef`);
    assert.equal(lstatSync(link).isSymbolicLink(), true, name);
    assert.equal(readlinkSync(link), relative(dirname(link), join(extracted, "node_modules", name)));
    dependency(extracted, name, `installed-${name}`);
  }
  rmSync(join(root, "node_modules"), { recursive: true });
  const require = createRequire(join(extracted, ".next/server/probe.cjs"));
  for (const name of names) assert.equal(require(`${name}-0123456789abcdef`), `installed-${name}`);
});

test("rejects unsafe or broken runtime aliases without replacing the previous archive", (t) => {
  for (const kind of ["outside", "transitive-escape", "broken", "file", "alias-root"]) {
    const root = fixture(t);
    dependency(root, "pg", "fixture");
    put(root, "storage/private.txt", "protected fixture");
    let target;
    if (kind === "outside") target = join(root, "storage");
    if (kind === "transitive-escape") {
      symlinkSync(join(root, "storage"), join(root, "node_modules/escape"));
      target = join(root, "node_modules/escape");
    }
    if (kind === "broken") target = join(root, "node_modules/absent");
    if (kind === "file") target = join(root, "node_modules/pg/index.cjs");
    if (kind === "alias-root") symlinkSync(join(root, "storage"), join(root, ".next/node_modules"));
    else alias(root, "pg-0123456789abcdef", target);
    const output = join(root, "release.tar.gz");
    writeFileSync(output, "previous release");
    assert.throws(() => packageRelease({ sourceDir: root, outputPath: output, sha }), /Unsafe runtime alias/, kind);
    assert.equal(readFileSync(output, "utf8"), "previous release");
    assert.equal(readFileSync(join(root, "storage/private.txt"), "utf8"), "protected fixture");
  }
});
