import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const roots = [
  "src/app",
  "src/components",
  "src/modules",
  "src/lib",
  "src/shared",
  "src/domains",
  "src/features",
  "src/workspaces",
];
const architectureRoots = ["src/shared", "src/domains", "src/features", "src/workspaces"];
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
  // Public product and installation pages may explain the self-host stack.
  "src/app/page.tsx",
  "src/app/docs/page.tsx",
  "src/app/features/page.tsx",
];

const findings = [];
const advisories = [];
const files = [];

for (const root of roots) {
  if (existsSync(root)) walk(root);
}

for (const file of files) {
  auditArchitecture(file);
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
    const normalized = normalizePath(fullPath);
    files.push({ path: normalized, text });
    auditCopy(normalized, text);
  }
}

function auditCopy(normalized, text) {
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

function auditArchitecture(file) {
  const sourceLayer = architectureLayer(file.path);
  const imports = collectImports(file.text);

  if (sourceLayer) {
    for (const item of imports) {
      const target = resolveImportPath(file.path, item.specifier);
      if (!target) continue;

      const violation = boundaryViolation(sourceLayer, target);
      if (violation) {
        findings.push(
          `${file.path}:${item.line}: architecture boundary ${sourceLayer} -> ${target}: ${violation}`,
        );
      }
    }
  }

  const guardedRoute = isMigrationRouteFile(file.path) || imports.some((item) => {
    const target = resolveImportPath(file.path, item.specifier);
    return target ? isInside(target, "src/workspaces") : false;
  });
  const newArchitectureFile = architectureRoots.some((root) => isInside(file.path, root));

  if (guardedRoute || newArchitectureFile) {
    for (const item of imports) {
      const target = resolveImportPath(file.path, item.specifier);
      if (
        (target && target === "src/components/DentalSuite") ||
        item.specifier.includes("DentalSuite") ||
        item.statement.includes("AppViewPage")
      ) {
        findings.push(
          `${file.path}:${item.line}: new architecture must not depend on DentalSuite/AppViewPage`,
        );
      }
    }
  }

  if (isMigrationRoutePage(file.path)) {
    const delegatesToWorkspace = imports.some((item) => {
      const target = resolveImportPath(file.path, item.specifier);
      return target ? isInside(target, "src/workspaces") : false;
    });

    if (!delegatesToWorkspace) {
      const message = `${file.path}: migration route should delegate through a workspace-specific loader/workspace`;
      if (process.env.ARCHITECTURE_AUDIT_STRICT_ROUTES === "1") {
        findings.push(message);
      } else {
        advisories.push(message);
      }
    }
  }
}

function boundaryViolation(sourceLayer, target) {
  if (sourceLayer === "shared") {
    if (
      ["src/domains", "src/features", "src/workspaces", "src/app", "src/modules"].some((root) =>
        isInside(target, root),
      )
    ) {
      return "shared must remain business-agnostic";
    }
  }

  if (sourceLayer === "domains") {
    if (isInside(target, "src/workspaces") || isInside(target, "src/app") || isInside(target, "src/components")) {
      return "domains must not depend on workspace/app UI";
    }
    if (isFeatureUi(target)) {
      return "domains must not depend on feature UI";
    }
  }

  if (sourceLayer === "features") {
    if (isInside(target, "src/workspaces") || isInside(target, "src/app")) {
      return "features may depend downward on shared/domains/server contracts, not workspaces/app routes";
    }
  }

  if (sourceLayer === "workspaces" && isInside(target, "src/app")) {
    return "workspaces must not depend on app routes";
  }

  return null;
}

function architectureLayer(path) {
  if (isInside(path, "src/shared")) return "shared";
  if (isInside(path, "src/domains")) return "domains";
  if (isInside(path, "src/features")) return "features";
  if (isInside(path, "src/workspaces")) return "workspaces";
  return null;
}

function isFeatureUi(path) {
  return /^src\/features\/[^/]+\/(?:ui|components)(?:\/|$)/.test(path);
}

function isMigrationRouteFile(path) {
  return (
    /^src\/app\/(?:[^/]+\/)*today(?:\/|$)/.test(path) ||
    /^src\/app\/(?:[^/]+\/)*work(?:\/|$)/.test(path) ||
    /^src\/app\/(?:[^/]+\/)*schedule(?!(?:\/legacy)(?:\/|$))(?:\/|$)/.test(path) ||
    /^src\/app\/(?:[^/]+\/)*care(?:\/|$)/.test(path) ||
    /^src\/app\/(?:[^/]+\/)*patients(?:\/|$)/.test(path) ||
    /^src\/app\/(?:[^/]+\/)*journey(?:\/|$)/.test(path) ||
    /^src\/app\/(?:[^/]+\/)*clinical(?:\/|$)/.test(path) ||
    /^src\/app\/(?:[^/]+\/)*treatment(?:\/|$)/.test(path) ||
    /^src\/app\/(?:[^/]+\/)*operations(?:\/|$)/.test(path) ||
    /^src\/app\/(?:[^/]+\/)*employee-app(?:\/|$)/.test(path)
  );
}

function isMigrationRoutePage(path) {
  return isMigrationRouteFile(path) && /\/page\.(?:ts|tsx|js|jsx)$/.test(path);
}

function collectImports(text) {
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const items = [];
  const seen = new Set();

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const key = `${match.index}:${match[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        specifier: match[1],
        statement: match[0],
        line: lineNumberAt(text, match.index ?? 0),
      });
    }
  }

  return items;
}

function resolveImportPath(sourcePath, specifier) {
  if (specifier.startsWith("@/")) {
    return normalizePath(`src/${specifier.slice(2)}`).replace(/\.(?:ts|tsx|js|jsx)$/, "");
  }

  if (!specifier.startsWith(".")) return null;

  const absoluteTarget = resolve(dirname(resolve(sourcePath)), specifier);
  const repoRelative = normalizePath(relative(process.cwd(), absoluteTarget));
  if (!repoRelative || repoRelative.startsWith("../")) return null;
  return repoRelative.replace(/\.(?:ts|tsx|js|jsx)$/, "");
}

function isInside(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
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

if (advisories.length > 0) {
  console.warn(["architecture advisories:", ...advisories].join("\n"));
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("agent-module-audit: ok");
}
