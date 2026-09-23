import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const assets = [
  {
    file: "be-vietnam-pro-400.ttf",
    url: "https://fonts.gstatic.com/s/bevietnampro/v12/QdVPSTAyLFyeg_IDWvOJmVES_Eww.ttf",
    sha256: "4ad53eac036092be79a34b5fa0aa32d0ebb3c7e5df4bc058764f5614fbf148a0",
  },
  {
    file: "be-vietnam-pro-500.ttf",
    url: "https://fonts.gstatic.com/s/bevietnampro/v12/QdVMSTAyLFyeg_IDWvOJmVES_HTEJl8y.ttf",
    sha256: "557a1c42a7f8eb83f84255d475017b1235c1101b899367f974a1cbfa19cd7c3d",
  },
  {
    file: "be-vietnam-pro-600.ttf",
    url: "https://fonts.gstatic.com/s/bevietnampro/v12/QdVMSTAyLFyeg_IDWvOJmVES_HToIV8y.ttf",
    sha256: "cbf437bf71c8536a7aaed632dce2583ea5ec97c07efffc625c31991d1027ba3b",
  },
  {
    file: "be-vietnam-pro-700.ttf",
    url: "https://fonts.gstatic.com/s/bevietnampro/v12/QdVMSTAyLFyeg_IDWvOJmVES_HSMIF8y.ttf",
    sha256: "aef76cd15b8c9faa1ff21951bb71963a774aa381526c557e5a52f38d430c4650",
  },
  {
    file: "noto-serif-400.ttf",
    url: "https://fonts.gstatic.com/s/notoserif/v33/ga6iaw1J5X9T9RW6j9bNVls-hfgvz8JcMofYTa32J4wsL2JAlAhZqFCjwA.ttf",
    sha256: "5473d2e43bdd018ee124a4addba8091fd0a29894b121cbb741023af6549662b6",
  },
];

const directory = fileURLToPath(new URL("../public/fonts/", import.meta.url));
await mkdir(directory, { recursive: true });

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verified(path, expected) {
  try {
    return digest(await readFile(path)) === expected;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

for (const asset of assets) {
  const target = `${directory}/${asset.file}`;
  if (await verified(target, asset.sha256)) continue;

  const response = await fetch(asset.url, {
    headers: { "User-Agent": "CodexDentist-font-assets/1.0" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${asset.file}: HTTP ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = digest(bytes);
  if (actual !== asset.sha256) {
    throw new Error(`${asset.file}: checksum mismatch (expected ${asset.sha256}, got ${actual})`);
  }

  const temporary = `${target}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

console.log("Verified complete self-hosted Vietnamese font assets.");
