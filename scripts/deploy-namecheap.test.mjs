import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const sha = "a".repeat(40);
const source = readFileSync(new URL("./deploy-namecheap.sh", import.meta.url), "utf8");
const runtimeDeclaration = 'NODE_BIN="/opt/alt/alt-nodejs22/root/usr/bin"';
const realMv = execFileSync("which", ["mv"], { encoding: "utf8" }).trim();

function put(root, path, text, mode = 0o600) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, { mode });
}

// Execute the real shell control flow against disposable files. Only the
// host-specific Node path and external commands are substituted; no hosting,
// network, database, patient data or real application process is involved.
function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "codexdentist-deploy-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "app");
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const [path, text] of Object.entries({
    "server.cjs": "old", ".next/BUILD_ID": "old-build", ".env": "protected-environment",
    "storage/patient.bin": "protected-patient-fixture", "backups/database.sql": "protected-backup-fixture",
  })) put(app, path, text);
  const payload = join(root, "payload");
  for (const [path, text] of Object.entries({
    "server.cjs": "new", ".next/BUILD_ID": "new-build", "new-only.txt": "new-item",
    ".codexdentist-release-sha": `${sha}\n`,
  })) put(payload, path, text);
  execFileSync("tar", ["-czf", join(root, "release.tar.gz"), "-C", payload, "."]);
  assert.equal(source.split(runtimeDeclaration).length, 2, "fixture replaces only the fixed Node path");
  put(root, "deploy.sh", source.replace(runtimeDeclaration, `NODE_BIN="${bin}"`));
  symlinkSync(process.execPath, join(bin, "node"));
  const command = (name, body) => put(bin, name, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, 0o700);
  command("npm", 'echo "npm $*" >> "$MOCK_EVENTS"; exit "${MOCK_NPM_FAILURE:-0}"');
  command("npx", 'echo "npx $*" >> "$MOCK_EVENTS"');
  command("sleep", ":");
  command("curl", `printf '%s\\n' '{"status":"ok","database":"ok","schema":"ok"}'`);
  command("cloudlinux-selector", `
    echo "$1" >> "$MOCK_EVENTS"
    if [[ "$1" == "stop" && "\${MOCK_STOP_FAILURE:-0}" == "1" ]]; then
      count="$(grep -c '^stop$' "$MOCK_EVENTS")"
      if [[ "$count" -gt 1 ]]; then exit 17; fi
    fi
    if [[ "$1" == "start" && "\${MOCK_START_FAILURE:-1}" == "1" ]]; then
      if [[ "$(cat "$MOCK_APP/server.cjs" 2>/dev/null || true)" == "new" ]]; then exit 42; fi
    fi
  `);
  command("mv", `
    arguments=("$@")
    if [[ "\${1:-}" == "--" ]]; then shift; fi
    if [[ "\${1:-}" == */.codexdentist-rollback-*/server.cjs && "\${MOCK_RESTORE_FAILURE:-0}" == "1" ]]; then
      echo 'Injected restore failure' >&2
      exit 73
    fi
    exec "$MOCK_REAL_MV" "\${arguments[@]}"
  `);
  const events = join(root, "events.log");
  writeFileSync(events, "");
  return {
    root, app, rollback: join(app, `.codexdentist-rollback-${sha}`),
    read: (path) => readFileSync(join(app, path), "utf8"),
    events: () => readFileSync(events, "utf8").trim().split("\n").filter(Boolean),
    run: () => spawnSync("bash", [join(root, "deploy.sh"), sha, app, "release.tar.gz", "fixture.invalid"], {
      cwd: root, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`, MOCK_APP: app,
        MOCK_EVENTS: events, MOCK_REAL_MV: realMv, MOCK_START_FAILURE: "1",
        MOCK_STOP_FAILURE: "0", MOCK_RESTORE_FAILURE: "0", MOCK_NPM_FAILURE: "0", ...options },
    }),
  };
}

function protectedFilesUnchanged(f) {
  assert.equal(f.read(".env"), "protected-environment");
  assert.equal(f.read("storage/patient.bin"), "protected-patient-fixture");
  assert.equal(f.read("backups/database.sql"), "protected-backup-fixture");
}

test("failed cutover restores the old release, removes new-only files, and preserves protected data", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 42, result.stderr);
  assert.equal(f.read("server.cjs"), "old");
  assert.equal(f.read(".next/BUILD_ID"), "old-build");
  assert.equal(existsSync(join(f.app, "new-only.txt")), false);
  assert.equal(existsSync(f.rollback), false);
  assert.deepEqual(f.events().filter((e) => e === "start" || e === "stop"), ["stop", "start", "stop", "start"]);
  protectedFilesUnchanged(f);
});

test("failed restore retains the last good files and does not restart a partially restored tree", (t) => {
  const f = fixture(t, { MOCK_RESTORE_FAILURE: "1" });
  const result = f.run();
  assert.equal(result.status, 42, result.stderr);
  assert.equal(existsSync(join(f.rollback, "server.cjs")), true, "must retain the only recoverable old entrypoint");
  assert.equal(readFileSync(join(f.rollback, "server.cjs"), "utf8"), "old");
  assert.equal(f.events().filter((e) => e === "start").length, 1, "never start a partial rollback");
  assert.match(result.stderr, /manual recovery/i);
  protectedFilesUnchanged(f);
});

test("failure to stop before rollback preserves both trees without an unsafe live restore", (t) => {
  const f = fixture(t, { MOCK_STOP_FAILURE: "1" });
  const result = f.run();
  assert.equal(result.status, 42, result.stderr);
  assert.equal(f.read("server.cjs"), "new");
  assert.equal(readFileSync(join(f.rollback, "server.cjs"), "utf8"), "old");
  assert.equal(f.events().filter((e) => e === "start").length, 1);
  assert.match(result.stderr, /manual recovery/i);
  protectedFilesUnchanged(f);
});

test("an unresolved rollback blocks retries of the same and different release SHAs before any host mutation", (t) => {
  for (const blockedSha of [sha, "b".repeat(40)]) {
    const f = fixture(t);
    const pending = join(f.app, `.codexdentist-rollback-${blockedSha}`);
    put(pending, "server.cjs", "last-good-release");
    const result = f.run();
    assert.equal(result.status, 1, result.stderr);
    assert.equal(readFileSync(join(pending, "server.cjs"), "utf8"), "last-good-release");
    assert.deepEqual(f.events(), []);
    assert.equal(f.read("server.cjs"), "old");
    assert.match(result.stderr, /unresolved rollback/i);
    protectedFilesUnchanged(f);
  }
});

test("dependency preparation failure never stops or mutates the live application", (t) => {
  const f = fixture(t, { MOCK_NPM_FAILURE: "23" });
  const result = f.run();
  assert.equal(result.status, 23, result.stderr);
  assert.equal(f.read("server.cjs"), "old");
  assert.equal(f.events().some((e) => e === "start" || e === "stop"), false);
  protectedFilesUnchanged(f);
});

test("healthy release cleans rollback state only after the readiness and stability checks", (t) => {
  const f = fixture(t, { MOCK_START_FAILURE: "0" });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.read("server.cjs"), "new");
  assert.equal(f.read(".next/BUILD_ID"), "new-build");
  assert.equal(existsSync(f.rollback), false);
  assert.deepEqual(f.events().filter((e) => e === "start" || e === "stop"), ["stop", "start"]);
  protectedFilesUnchanged(f);
});
