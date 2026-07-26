import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(
  repoRoot,
  "node_modules",
  "@artidev",
  "odontogram-core",
);
const sourceDirectory = path.join(packageRoot, "assets", "teeth-svgs");
const outputDirectory = path.join(repoRoot, "public", "odontogram-assets");
const templates = ["11", "13", "14", "16"];

const primaryDentitionStyles = `
  <style id="codexdentist-primary-dentition">
    #tooth-base,
    #tooth-base-beauty,
    #tooth-healthy-pulp,
    #tooth-inflam-pulp,
    #tooth-bruxism-wear,
    #tooth-bruxism-neck-wear {
      display: none !important;
    }

    #milktooth,
    #milktooth-base,
    #milktooth-beauty,
    #milktooth-healthy-pulp {
      display: inline !important;
    }

    #milktooth-inflam-pulp {
      display: none !important;
    }
  </style>
`;

await mkdir(outputDirectory, { recursive: true });

for (const template of templates) {
  const sourcePath = path.join(sourceDirectory, `${template}.svg`);
  const svg = await readFile(sourcePath, "utf8");

  if (!svg.includes("<defs>")) {
    throw new Error(`Unexpected SVG structure: ${sourcePath}`);
  }

  const primarySvg = svg.replace(
    "<defs>",
    `${primaryDentitionStyles}\n  <defs>`,
  );

  await Promise.all([
    writeFile(
      path.join(outputDirectory, `${template}-adult.svg`),
      svg,
      "utf8",
    ),
    writeFile(
      path.join(outputDirectory, `${template}-primary.svg`),
      primarySvg,
      "utf8",
    ),
  ]);
}

const license = await readFile(path.join(packageRoot, "LICENSE"), "utf8");
await writeFile(
  path.join(outputDirectory, "ARTIDEV-LICENSE.txt"),
  license,
  "utf8",
);
