import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

type StorageEnvironment = Record<string, string | undefined>;
const fail = (code: string): never => { throw new Error(code); };
function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

export function durableLocalRootRequired(env: StorageEnvironment = process.env) {
  return env.PATIENT_FILE_LOCAL_DURABLE === "true" ||
    (env.NODE_ENV === "production" && env.DEPLOYMENT_MODE?.trim().toLowerCase() !== "self-hosted");
}

export function durableLocalRootConfiguration(env: StorageEnvironment = process.env, cwd = process.cwd(), platform: string = process.platform) {
  if (env.PATIENT_FILE_LOCAL_DURABLE !== "true") fail("patient-file-durable-storage-not-enabled");
  const configured = env.PATIENT_FILE_STORAGE_ROOT?.trim();
  if (platform !== "linux" || !configured || !path.posix.isAbsolute(configured)) fail("patient-file-durable-root-invalid");
  const root = path.posix.resolve(configured!);
  const app = path.posix.resolve(cwd);
  if (root === "/" || app === "/" || root === app || root.startsWith(app + "/") || app.startsWith(root + "/") || /^\/(?:tmp|var\/tmp|run|dev|proc|sys)(?:\/|$)/.test(root)) {
    fail("patient-file-durable-root-invalid");
  }
  return root;
}

export function hasDurableMount(root: string, mountInfo: string) {
  return mountInfo.split("\n").some(line => {
    const [left, right] = line.split(" - ");
    if (!left || !right) return false;
    const mount = left.split(" ")[4]?.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)));
    const filesystem = right.split(" ")[0];
    return mount === root && Boolean(filesystem) && !["overlay", "tmpfs", "ramfs", "squashfs", "proc", "sysfs", "devtmpfs"].includes(filesystem);
  });
}

export async function verifyDurableLocalRoot(options: { env?: StorageEnvironment; probeWrite?: boolean } = {}) {
  const env = options.env ?? process.env;
  const root = durableLocalRootConfiguration(env);
  const info = await lstat(root);
  const uid = process.getuid?.();
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700 || uid === undefined || uid === 0 || info.uid !== uid) {
    fail("patient-file-durable-root-permissions-invalid");
  }
  if (await realpath(root) !== root || !hasDurableMount(root, await readFile("/proc/self/mountinfo", "utf8"))) {
    fail("patient-file-durable-volume-not-mounted");
  }
  if (options.probeWrite) {
    const probe = path.join(root, ".readiness-" + randomUUID());
    const handle = await open(probe, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.sync(); } finally { await handle.close(); await unlink(probe); }
  }
  return root;
}

// Filesystem access stays within one private root. Reject links before creating
// subdirectories; restore artifacts cannot redirect writes into another tenant.
export async function resolvePrivateStoragePath(root: string, storageKey: string, createParents = false) {
  const normalized = storageKey.replaceAll("\\", "/").replace(/^patient-files\//, "");
  const segments = normalized.split("/");
  if (!normalized || path.isAbsolute(normalized) || segments.some(part => !part || part === "." || part === ".." || /[\u0000-\u001f:]/.test(part))) {
    fail("patient-file-storage-key-invalid");
  }
  const target = path.resolve(root, ...segments);
  if (target === root || !inside(root, target)) fail("patient-file-storage-key-invalid");
  if (createParents) await mkdir(root, { recursive: true, mode: 0o700 });
  let parent = root;
  for (let i = 0; i < segments.length; i++) {
    const next = path.join(parent, segments[i]);
    let info;
    try { info = await lstat(next); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      if (i === segments.length - 1 || !createParents) return target;
      try { await mkdir(next, { mode: 0o700 }); }
      catch (created) { if (!(created && typeof created === "object" && "code" in created && created.code === "EEXIST")) throw created; }
      info = await lstat(next);
    }
    if (info.isSymbolicLink() || (i < segments.length - 1 ? !info.isDirectory() : !info.isFile())) fail("patient-file-storage-link-invalid");
    parent = next;
  }
  return target;
}
