import ts from "typescript";
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
  "src/infrastructure",
  "src/integrations",
  "src/workspaces",
];

const architectureRoots = [
  "src/shared",
  "src/domains",
  "src/features",
  "src/infrastructure",
  "src/integrations",
  "src/workspaces",
];

const migratedTransportFiles = new Set([
  "src/app/(app)/settings/actions.ts",
  "src/app/(app)/staff/actions.ts",
  "src/app/(app)/inventory/actions.ts",
  "src/app/(app)/billing/actions.ts",
  "src/app/(app)/clinical/actions.ts",
  "src/app/(app)/journey/actions.ts",
  "src/app/(app)/patients/actions.ts",
  "src/app/(app)/schedule/actions.ts",
]);

const applicationRoot = "src/lib/application";
const forbiddenTransportImports = new Set([
  "@/lib/actions/permissions",
  "@/lib/document-sequence",
  "@/lib/notification-templates",
  "@/lib/patient-access",
  "@/lib/patient-file-storage",
  "@/lib/prisma",
  "@/lib/transaction",
  "@prisma/client",
  "@prisma/adapter-pg",
]);

const technicalCopyPatterns = [
  /PostgreSQL/i,
  /Database is connected/i,
  /Database live/i,
  /Demo mode/i,
  /server console/i,
  /Workspace error/i,
  /Dữ liệu thật/i,
];

const mojibakePatterns = [/Ch\?/, /\?\?\?/, /\uFFFD/];

const allowedTechnical = [
  "src/lib/env.ts",
  "src/lib/runtime-guards.ts",
  "src/lib/prisma.ts",
  "src/app/(app)/actions.ts",
  "src/app/page.tsx",
  "src/app/docs/page.tsx",
  "src/app/features/page.tsx",
];

const findings = [];
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
      if (!["node_modules", ".next"].includes(name)) walk(fullPath);
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
  const imports = collectImports(file.text, file.path);
  auditApplicationBoundary(file, imports);

  const sourceLayer = architectureLayer(file.path);
  if (!sourceLayer) return;

  for (const item of imports) {
    const target = resolveImportPath(file.path, item.specifier);
    const violation = boundaryViolation(sourceLayer, target, item.specifier) ||
      (["features", "domains", "shared", "workspaces"].includes(sourceLayer) ? legacyImplementationViolation(target, new Set()) : null);
    if (violation) {
      findings.push(
        `${file.path}:${item.line}: architecture boundary ${sourceLayer} -> ${target ?? item.specifier}: ${violation}`,
      );
    }
  }
}

function auditApplicationBoundary(file, imports) {
  if (migratedTransportFiles.has(file.path)) {
    const hasApplicationCommand = imports.some((item) => {
      const target = resolveImportPath(file.path, item.specifier);
      return target ? isInside(target, applicationRoot) : false;
    });
    if (!hasApplicationCommand) {
      findings.push(`${file.path}: migrated transport must delegate to src/lib/application commands`);
    }

    for (const item of imports) {
      if (forbiddenTransportImports.has(item.specifier)) {
        findings.push(
          `${file.path}:${item.line}: migrated transport must not import ${item.specifier}; delegate through the application boundary`,
        );
      }
    }
  }

  if (isInside(file.path, applicationRoot)) {
    for (const item of imports) {
      const specifier = item.specifier.trim();
      if (specifier === "next" || specifier.startsWith("next/")) {
        findings.push(
          `${file.path}:${item.line}: application commands must be reusable outside Next.js transports`,
        );
      }
    }
    if (/\bFormData\b/.test(file.text)) {
      findings.push(`${file.path}: application commands must accept typed inputs, not FormData`);
    }
  }
}

function legacyImplementationViolation(target, visited) {
  if (!target || visited.has(target)) return null;
  visited.add(target);
  if (["src/lib/prisma", "src/lib/auth", "src/lib/env", "src/lib/patient-file-storage", "src/lib/transaction"].includes(target)) return 'legacy concrete implementation must be accessed through an application port';
  const dependency = files.find(file => file.path.replace(/\.(ts|tsx|js|jsx)$/, '') === target);
  if (!dependency) return null;
  for (const edge of collectImports(dependency.text, dependency.path)) {
    if (isFrameworkOrPersistenceImport(edge.specifier)) return 'transitive concrete framework/persistence dependency is not an application contract';
    const violation = legacyImplementationViolation(resolveImportPath(dependency.path, edge.specifier), visited);
    if (violation) return violation;
  }
  return null;
}

function boundaryViolation(sourceLayer, target, specifier) {
  const external = normalizedExternalSpecifier(specifier);

  if (sourceLayer === "shared") {
    if (
      target &&
      [
        "src/domains",
        "src/features",
        "src/infrastructure",
        "src/integrations",
        "src/workspaces",
        "src/app",
        "src/modules",
        "src/components",
      ].some((root) => isInside(target, root))
    ) {
      return "shared must remain business-agnostic and may not depend on higher layers";
    }
  }

  if (sourceLayer === "domains") {
    if (
      target &&
      [
        "src/features",
        "src/infrastructure",
        "src/integrations",
        "src/workspaces",
        "src/app",
        "src/components",
        "src/modules",
      ].some((root) => isInside(target, root))
    ) {
      return "domains must remain independent of application orchestration, implementations, providers, and UI";
    }

    if (isFrameworkOrPersistenceImport(external)) {
      return "domains must not import Next.js, Prisma, storage SDKs, or provider frameworks";
    }
  }

  if (sourceLayer === "features") {
    if (
      target &&
      ["src/infrastructure", "src/integrations", "src/workspaces", "src/app", "src/components"].some(
        (root) => isInside(target, root),
      )
    ) {
      return "features/application may depend on domain contracts and ports, not concrete implementations, providers, or UI composition";
    }
  }

  if (sourceLayer === "infrastructure") {
    if (
      target &&
      ["src/integrations", "src/workspaces", "src/app", "src/components"].some((root) =>
        isInside(target, root),
      )
    ) {
      return "infrastructure implements technical ports and must not depend on provider or UI composition layers";
    }
  }

  if (sourceLayer === "integrations") {
    if (
      target &&
      ["src/workspaces", "src/app", "src/components"].some((root) => isInside(target, root))
    ) {
      return "integrations must not depend on app/workspace UI";
    }

    if (
      (target && (target === "src/lib/prisma" || isInside(target, "src/infrastructure/db"))) ||
      external === "@prisma/client" ||
      external === "@prisma/adapter-pg"
    ) {
      return "integration adapters must invoke application contracts instead of mutating canonical data through Prisma directly";
    }
  }

  if (sourceLayer === "workspaces") {
    if (
      target &&
      ["src/app", "src/infrastructure", "src/integrations"].some((root) => isInside(target, root))
    ) {
      return "workspaces compose UI and must not depend on app routes, infrastructure implementations, or concrete providers";
    }

    if (external === "@prisma/client" || external === "@prisma/adapter-pg") {
      return "workspaces must not access Prisma directly";
    }
  }

  return null;
}

function architectureLayer(path) {
  for (const root of architectureRoots) {
    if (isInside(path, root)) return root.slice("src/".length);
  }
  return null;
}

function isFrameworkOrPersistenceImport(specifier) {
  return (
    specifier === "next" ||
    specifier.startsWith("next/") ||
    specifier === "@prisma/client" ||
    specifier === "@prisma/adapter-pg" ||
    specifier.startsWith("@aws-sdk/")
  );
}

function normalizedExternalSpecifier(specifier) {
  return specifier.trim();
}

function collectImports(text, filename) {
  if (filename.endsWith('.css')) return [];
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const items = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const onlyTypes = clause?.isTypeOnly || node.isTypeOnly ||
        (!clause?.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly));
      if (!onlyTypes) items.push({ specifier: node.moduleSpecifier.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      items.push({ specifier: node.arguments[0].text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
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

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("agent-module-audit: ok");
}
