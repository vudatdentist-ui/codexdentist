import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const output = 'output/workspace-qa';
await mkdir(output, { recursive: true });
await writeFile(`${output}/odontogram-vendor.css`, await readFile(new URL(import.meta.resolve('codexdentist-odontogram/style.css')), 'utf8'));
const results = [];
// Independent suites share the isolated seeded database but retain their own
// browser contexts. A failing suite must not suppress later failure evidence.
for (const script of ['browser-qa-audit.mjs', 'workspace-narrative-qa.mjs', 'workspace-redesign-qa.mjs', 'workspace-odontogram-qa.mjs', 'workspace-interaction-qa.mjs', 'workspace-selection-qa.mjs']) {
  const result = spawnSync(process.execPath, [`scripts/${script}`], { stdio: 'inherit' });
  results.push({ script, exitCode: result.status, error: result.error?.message, signal: result.signal });
}
await writeFile(`${output}/suite-results.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, results }, null, 2));
if (results.some(result => result.exitCode !== 0)) process.exitCode = 1;
