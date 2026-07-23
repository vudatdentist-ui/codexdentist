import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["src/app", "src/components", "src/modules", "src/lib"];
const technicalCopyPatterns = [
  /PostgreSQL/i,
  /Database is connected/i,
  /Database live/i,
  /Demo mode/i,
  /server console/i,
  /Workspace error/i,
  /Dữ liệu thật/i,
];
const mojibakePatterns = [
  /Ch\?/,
  /\?\?\?/,
  /\uFFFD/,
];

const allowedTechnical = [
  "src/lib/env.ts",
  "src/lib/runtime-guards.ts",
  "src/lib/prisma.ts",
  "src/app/(app)/actions.ts",
];

const findings = [];

for (const root of roots) {
  walk(root);
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (!["node_modules", ".next"].includes(name)) {
        walk(fullPath);
      }
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|css)$/.test(name)) continue;

    const text = readFileSync(fullPath, "utf8");
    const normalized = fullPath.replaceAll("\\", "/");
    const isAllowedTechnical = allowedTechnical.some((allowed) => normalized.endsWith(allowed));

    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      for (const pattern of technicalCopyPatterns) {
        if (
          pattern.test(line) &&
          !isAllowedTechnical &&
          !isLegacyMessageKey(line) &&
          !isNonUserFacingLine(line)
        ) {
          findings.push(`${normalized}:${lineNumber}: technical copy pattern ${pattern}`);
        }
      }

      for (const pattern of mojibakePatterns) {
        if (pattern.test(line) && !isNonUserFacingLine(line)) {
          findings.push(`${normalized}:${lineNumber}: possible encoding issue ${pattern}`);
        }
      }
    });
  }
}

function isLegacyMessageKey(line) {
  return /^\s*"[^"]*(PostgreSQL|Database is connected|Demo mode|server console|Workspace error)[^"]*":\s*$/.test(line);
}

function isNonUserFacingLine(line) {
  return (
    line.includes("className=") ||
    line.includes("const technicalCopyPatterns") ||
    line.includes("technical copy pattern") ||
    /^\s*\/\//.test(line) ||
    /^\s*import /.test(line)
  );
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("agent-module-audit: ok");
}
