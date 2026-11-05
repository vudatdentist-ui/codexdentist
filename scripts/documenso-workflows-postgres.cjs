const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['--test', 'scripts/documenso-workflows.test.cjs'], {
  env: { ...process.env, DOCUMENSO_WORKFLOWS_POSTGRES: '1' }, stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
