import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const packageJsonPath = "package.json";
const packageLockPath = "package-lock.json";
const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

if (pkg.dependencies?.sharp) {
  delete pkg.dependencies.sharp;
}

for (const dependencyName of [
  "@capacitor/android",
  "@capacitor/cli",
  "@capacitor/core",
  "eslint",
  "eslint-config-next",
]) {
  if (pkg.dependencies?.[dependencyName]) {
    delete pkg.dependencies[dependencyName];
  }

  if (pkg.devDependencies?.[dependencyName]) {
    delete pkg.devDependencies[dependencyName];
  }
}

pkg.scripts = {
  ...pkg.scripts,
  "start:phone": "next start -H 0.0.0.0 -p 3000",
};

writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);

if (existsSync(packageLockPath)) {
  rmSync(packageLockPath, { force: true });
}

console.log("Prepared package.json for Termux phone runtime.");
