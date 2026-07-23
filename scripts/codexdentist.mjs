import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { networkInterfaces } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(projectRoot, ".env.selfhost");
const composeFile = join(projectRoot, "compose.selfhost.yml");
const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);

switch (command) {
  case "install":
    ensureDocker();
    ensureSelfHostEnv();
    compose(["up", "-d", "--build"]);
    await waitForHealth();
    printAccessUrls();
    console.log("Mở /setup để tạo phòng khám và tài khoản Chủ hệ thống.");
    break;
  case "start":
    requireSelfHostEnv();
    compose(["up", "-d"]);
    await waitForHealth();
    printAccessUrls();
    break;
  case "stop":
    requireSelfHostEnv();
    compose(["stop"]);
    break;
  case "status":
    requireSelfHostEnv();
    compose(["ps"]);
    break;
  case "doctor":
    requireSelfHostEnv();
    await doctor();
    break;
  case "backup":
    requireSelfHostEnv();
    backup();
    break;
  case "restore":
    requireSelfHostEnv();
    restore(args);
    break;
  case "update":
    requireSelfHostEnv();
    backup();
    update();
    break;
  default:
    printHelp();
}

function compose(composeArgs, options = {}) {
  const result = spawnSync(
    "docker",
    ["compose", "--env-file", envPath, "-f", composeFile, ...composeArgs],
    {
      cwd: projectRoot,
      encoding: options.encoding ?? "utf8",
      stdio: options.stdio ?? "inherit",
      input: options.input,
    },
  );

  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`docker compose ${composeArgs.join(" ")} failed`);
  }

  return result;
}

function ensureDocker() {
  const result = spawnSync("docker", ["version"], {
    encoding: "utf8",
    stdio: "ignore",
  });

  if (result.status !== 0) {
    throw new Error("Docker chưa chạy. Hãy mở Docker Desktop hoặc Docker Engine.");
  }
}

function ensureSelfHostEnv() {
  if (existsSync(envPath)) {
    return;
  }

  const requestedPort = process.env.CODEXDENTIST_PORT?.trim() || "3000";
  const port = Number(requestedPort);

  if (!/^\d{1,5}$/.test(requestedPort) || port < 1 || port > 65535) {
    throw new Error("CODEXDENTIST_PORT phải là một cổng hợp lệ từ 1 đến 65535.");
  }

  const secret = () => randomBytes(48).toString("base64url");
  const content = [
    `POSTGRES_PASSWORD="${secret()}"`,
    `AUTH_SECRET="${secret()}"`,
    `JOB_SECRET="${secret()}"`,
    `CODEXDENTIST_PORT="${requestedPort}"`,
    `APP_BASE_URL="http://127.0.0.1:${requestedPort}"`,
    'APP_ROOT_DOMAIN="codexdentist.local"',
    'SESSION_COOKIE_SECURE="false"',
    'NOTIFICATION_DELIVERY_MODE="disabled"',
    'CODEXMED_AI_ENABLED="false"',
    'CODEXDENTIST_IMAGE="codexdentist:local"',
    "",
  ].join("\n");

  writeFileSync(envPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log("Đã tạo .env.selfhost với khóa ngẫu nhiên.");
}

function requireSelfHostEnv() {
  ensureDocker();

  if (!existsSync(envPath)) {
    throw new Error("Chưa có .env.selfhost. Chạy lệnh install trước.");
  }
}

async function waitForHealth() {
  const port = envValue("CODEXDENTIST_PORT") || "3000";
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);

      if (response.ok) {
        console.log(`Codexdentist đã sẵn sàng: ${healthUrl}`);
        return;
      }
    } catch {
      // Container may still be applying migrations.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }

  compose(["logs", "--tail", "80", "app"]);
  throw new Error("Ứng dụng chưa sẵn sàng sau 120 giây.");
}

async function doctor() {
  const port = envValue("CODEXDENTIST_PORT") || "3000";
  compose(["ps"]);

  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  console.log(health.status, await health.text());
  printAccessUrls();

  if (!health.ok) {
    throw new Error("Health check thất bại.");
  }
}

function backup() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const backupDir = join(projectRoot, "backups", `codexdentist-${timestamp}`);
  const databasePath = join(backupDir, "postgres.dump");
  const filesPath = join(backupDir, "patient-files.tar.gz");
  const containerFilesPath = `/tmp/patient-files-${timestamp}.tar.gz`;
  mkdirSync(backupDir, { recursive: true });

  const databaseFd = openSync(databasePath, "wx");
  const databaseResult = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      envPath,
      "-f",
      composeFile,
      "exec",
      "-T",
      "postgres",
      "pg_dump",
      "-Fc",
      "--no-owner",
      "--no-privileges",
      "-U",
      "codexdentist",
      "-d",
      "codexdentist",
    ],
    {
      cwd: projectRoot,
      stdio: ["ignore", databaseFd, "inherit"],
    },
  );
  closeSync(databaseFd);

  if (databaseResult.status !== 0) {
    throw new Error("Không tạo được backup PostgreSQL.");
  }

  compose([
    "exec",
    "-T",
    "app",
    "tar",
    "-czf",
    containerFilesPath,
    "-C",
    "/data",
    "patient-files",
  ]);
  compose([
    "cp",
    `app:${containerFilesPath}`,
    relative(projectRoot, filesPath),
  ]);
  compose(["exec", "-T", "app", "rm", "-f", containerFilesPath]);
  console.log(`Backup hoàn tất: ${backupDir}`);

  return backupDir;
}

function restore(restoreArgs) {
  const backupDirArg = restoreArgs.find((value) => !value.startsWith("--"));

  if (!backupDirArg || !restoreArgs.includes("--confirm")) {
    throw new Error("Dùng: restore <backup-folder> --confirm");
  }

  const backupDir = resolve(projectRoot, backupDirArg);
  const databasePath = join(backupDir, "postgres.dump");
  const filesPath = join(backupDir, "patient-files.tar.gz");

  if (!existsSync(databasePath) || !existsSync(filesPath)) {
    throw new Error("Backup phải có postgres.dump và patient-files.tar.gz.");
  }

  compose(["stop", "app"]);
  const databaseFd = openSync(databasePath, "r");
  const restoreResult = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      envPath,
      "-f",
      composeFile,
      "exec",
      "-T",
      "postgres",
      "pg_restore",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "-U",
      "codexdentist",
      "-d",
      "codexdentist",
    ],
    {
      cwd: projectRoot,
      stdio: [databaseFd, "inherit", "inherit"],
    },
  );
  closeSync(databaseFd);

  if (restoreResult.status !== 0) {
    throw new Error("Khôi phục PostgreSQL thất bại; ứng dụng vẫn đang dừng.");
  }

  const filesMount = `./${relative(projectRoot, filesPath).replaceAll("\\", "/")}:/tmp/patient-files.tar.gz:ro`;
  compose([
    "run",
    "--rm",
    "--no-deps",
    "--volume",
    filesMount,
    "--entrypoint",
    "sh",
    "app",
    "-c",
    "find /data/patient-files -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /tmp/patient-files.tar.gz -C /data",
  ]);
  compose(["start", "app"]);
  console.log(`Đã khôi phục backup: ${basename(backupDir)}`);
}

function update() {
  const image = envValue("CODEXDENTIST_IMAGE");

  if (image && image !== "codexdentist:local") {
    compose(["pull", "app"]);
    compose(["up", "-d", "--no-deps", "app"]);
  } else {
    compose(["up", "-d", "--build", "app"]);
  }

  console.log("Cập nhật hoàn tất. Chạy doctor để kiểm tra.");
}

function printAccessUrls() {
  const port = envValue("CODEXDENTIST_PORT") || "3000";
  console.log(`Local: http://127.0.0.1:${port}`);

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        console.log(`LAN:   http://${address.address}:${port}`);
      }
    }
  }
}

function envValue(name) {
  if (!existsSync(envPath)) {
    return "";
  }

  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));

  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") ?? "";
}

function printHelp() {
  console.log(`Codexdentist self-host CLI

  install                 Tạo cấu hình và cài ứng dụng
  start                   Khởi động các container
  stop                    Dừng ứng dụng
  status                  Xem trạng thái container
  doctor                  Kiểm tra health và địa chỉ LAN
  backup                  Sao lưu PostgreSQL và tệp
  restore <dir> --confirm Khôi phục một backup
  update                  Backup rồi cập nhật ứng dụng`);
}
