import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const commands = [
  [npmCommand, ["run", "encoding:check"]],
  [npmCommand, ["run", "typecheck"]],
  [npmCommand, ["run", "test:seed-users"]],
  [npmCommand, ["run", "test:tenant"]],
  [npmCommand, ["run", "test:actions"]],
  [npmCommand, ["run", "test:roles"]],
  [npmCommand, ["run", "test:pilot-workflows"]],
  [npmCommand, ["run", "test:data-integrity"]],
  [npmCommand, ["run", "test:billing"]],
  [npmCommand, ["run", "test:hardening"]],
  [npmCommand, ["run", "readiness:check"]],
  [npmCommand, ["run", "browser:qa"]],
  [npmCommand, ["run", "build"]],
  [npmCommand, ["run", "agent:health"]],
];

for (const [command, args] of commands) {
  await run(command, args);
}

console.log("ok pilot qa");

function run(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(" ")}`);
    const childCommand = process.platform === "win32" ? "cmd.exe" : command;
    const childArgs =
      process.platform === "win32"
        ? ["/d", "/s", "/c", `${command} ${args.join(" ")}`]
        : args;
    const child = spawn(childCommand, childArgs, {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}
