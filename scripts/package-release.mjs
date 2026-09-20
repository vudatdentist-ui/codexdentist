import { execFileSync } from "node:child_process";
import {
  copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const runtimeEntries = [
  ".next", "public", "prisma", "src", "scripts", "package.json",
  "package-lock.json", "prisma.config.ts", "next.config.ts", "server.cjs",
  "tsconfig.json", "next-env.d.ts", "LICENSE",
];
const excludedNames = new Set([
  ".git", "node_modules", ".tmp", "storage", "backups", "output",
  "coverage", "playwright-report", "test-results",
]);
const manifestName = ".codexdentist-release-sha";

function excluded(path) {
  const parts = path.split(sep);
  return parts.some((part) => excludedNames.has(part) || /^\.env(?:\.|$)/.test(part))
    || (parts[0] === ".next" && parts[1] === "cache")
    || /\.(?:log|tsbuildinfo)$/.test(path);
}

function requireRegularFile(root, path, nonempty = false) {
  const target = join(root, path);
  if (!existsSync(target) || !lstatSync(target).isFile()
      || (nonempty && statSync(target).size === 0)) {
    throw new Error(`Release requires a regular${nonempty ? " non-empty" : ""} file: ${path}`);
  }
}

// Only clean CI builds with synthetic test data are release inputs. Never use a
// live application directory: generated HTML can contain application data.
export function packageRelease({ sourceDir = process.cwd(), outputPath = "release.tar.gz", sha }) {
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Release SHA must be a full 40-character lowercase Git commit SHA.");
  }
  const source = resolve(sourceDir);
  const output = resolve(outputPath);
  for (const entry of runtimeEntries) {
    if (!existsSync(join(source, entry))) throw new Error(`Missing release input: ${entry}`);
  }
  for (const directory of [".next/server", ".next/static", "public", "prisma", "src", "scripts"]) {
    if (!existsSync(join(source, directory)) || !lstatSync(join(source, directory)).isDirectory()) {
      throw new Error(`Release requires a directory: ${directory}`);
    }
  }
  for (const file of [".next/BUILD_ID", "package.json", "package-lock.json", "server.cjs", "prisma/schema.prisma"]) {
    requireRegularFile(source, file, true);
  }
  // Publishing must not replace an input, nor add archives to runtime folders.
  const outputRelative = relative(source, output);
  if (runtimeEntries.some((entry) => outputRelative === entry || outputRelative.startsWith(`${entry}${sep}`))) {
    throw new Error("Release output must be outside runtime input paths.");
  }
  const temporary = mkdtempSync(join(tmpdir(), "codexdentist-release-"));
  let publishDir;
  try {
    const staging = join(temporary, "app");
    const archive = join(temporary, "release.tar.gz");
    mkdirSync(staging);
    for (const entry of runtimeEntries) {
      cpSync(join(source, entry), join(staging, entry), {
        recursive: true,
        filter: (path) => {
          if (excluded(relative(source, path))) return false;
          const info = lstatSync(path);
          if (!info.isFile() && !info.isDirectory()) {
            throw new Error(`Unsupported release input (symlink or special file): ${relative(source, path)}`);
          }
          return true;
        },
      });
    }
    writeFileSync(join(staging, manifestName), `${sha}\n`, { flag: "wx" });
    // The archive is outside the snapshot. Do not suppress tar errors: a file
    // changing while being read means the release is not a trustworthy snapshot.
    execFileSync("tar", ["-czf", archive, "-C", staging, "."], { stdio: "pipe" });
    const archivedSha = execFileSync("tar", ["-xOzf", archive, `./${manifestName}`], { encoding: "utf8" });
    const archivedBuild = execFileSync("tar", ["-xOzf", archive, "./.next/BUILD_ID"], { encoding: "utf8" });
    if (archivedSha !== `${sha}\n` || !archivedBuild.trim()) {
      throw new Error("Release archive failed identity/build verification.");
    }
    // Publish on the destination filesystem only after verification, preserving
    // any previous archive if copying, tar, or verification fails.
    mkdirSync(dirname(output), { recursive: true });
    publishDir = mkdtempSync(join(dirname(output), ".release-publish-"));
    const ready = join(publishDir, basename(output));
    copyFileSync(archive, ready);
    renameSync(ready, output);
    return output;
  } finally {
    if (publishDir) rmSync(publishDir, { recursive: true, force: true });
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , sha, outputPath = "release.tar.gz", sourceDir = process.cwd()] = process.argv;
    console.log(`Verified release archive: ${packageRelease({ sha, outputPath, sourceDir })}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
