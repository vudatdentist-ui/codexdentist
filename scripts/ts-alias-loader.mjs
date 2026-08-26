import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sourceRoot = path.resolve(process.cwd(), "src");
const serverOnlyStub = pathToFileURL(
  path.resolve(process.cwd(), "scripts", "server-only-stub.mjs"),
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: serverOnlyStub, shortCircuit: true };
  }

  if (specifier.startsWith("@/")) {
    const basePath = path.resolve(sourceRoot, specifier.slice(2));
    if (!basePath.startsWith(`${sourceRoot}${path.sep}`)) {
      throw new Error(`Blocked test alias traversal: ${specifier}`);
    }

    for (const candidate of candidates(basePath)) {
      if (await exists(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }

    throw new Error(`Could not resolve test alias ${specifier}`);
  }

  return nextResolve(specifier, context);
}

function candidates(basePath) {
  if (path.extname(basePath)) return [basePath];
  return [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mts`,
    `${basePath}.mjs`,
    `${basePath}.js`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.mjs"),
    path.join(basePath, "index.js"),
  ];
}

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}
