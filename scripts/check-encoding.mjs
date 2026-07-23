import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const roots = ["src", "scripts", "prisma", "tools"];
const checkedExtensions = new Set([
  ".css",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".prisma",
  ".ps1",
  ".sh",
  ".ts",
  ".tsx",
]);
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "output",
  "storage",
  "backups",
  "test-results",
]);

const mojibakePattern = new RegExp(
  [
    "\\u00c3",
    "\\u00c4",
    "\\u00c6",
    "\\u00e1[\\u00ba-\\u00bf]",
    "\\u00c2[\\u00a0-\\u00bf]",
    "\\ufffd",
  ].join("|"),
  "u",
);
const findings = [];

async function walk(directory) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        await walk(fullPath);
      }
      continue;
    }

    if (!entry.isFile() || !checkedExtensions.has(path.extname(entry.name))) {
      continue;
    }

    const content = await readFile(fullPath, "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (mojibakePattern.test(line)) {
        findings.push({
          file: fullPath,
          line: index + 1,
          text: line.trim().slice(0, 180),
        });
      }
    });
  }
}

for (const root of roots) {
  await walk(root);
}

if (findings.length > 0) {
  console.error("Encoding check failed: possible mojibake found.");
  for (const finding of findings.slice(0, 60)) {
    console.error(`${finding.file}:${finding.line}: ${finding.text}`);
  }

  if (findings.length > 60) {
    console.error(`...and ${findings.length - 60} more.`);
  }

  process.exitCode = 1;
} else {
  console.log("Encoding check passed: no mojibake patterns found.");
}
