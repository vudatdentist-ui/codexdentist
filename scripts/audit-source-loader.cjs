// Run checked-out application functions while replacing only their I/O boundaries.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function load(file, mocks = {}, globals = {}) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    exports: module.exports, module,
    require(name) {
      if (name === "server-only") return {};
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("node:") || name === "crypto") return require(name);
      throw new Error(`Unmocked dependency ${name} in ${file}`);
    },
    process: { env: { SUPER_ADMIN_EMAILS: "reserved-admin@example.test" } },
    Buffer, URL, URLSearchParams, AbortSignal, console, setTimeout, clearTimeout,
    ...globals,
  }, { filename: file });
  return module.exports;
}
module.exports = { load };
