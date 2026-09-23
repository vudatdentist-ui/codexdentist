import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { nextTabIndex } from '../src/shared/ui/tab-navigation.ts';

const root = new URL('../', import.meta.url);
const text = path => readFileSync(new URL(path, root), 'utf8');
function sources(directory) {
  return readdirSync(new URL(directory, root), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sources(path) : path.endsWith('.tsx') ? [path] : [];
  });
}
test('tab arrows wrap; Home and End reach boundaries; other keys keep native behavior', () => {
  assert.equal(nextTabIndex('ArrowRight', 2, 3), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2);
  assert.equal(nextTabIndex('Home', 2, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
  assert.equal(nextTabIndex('Tab', 0, 3), null);
  assert.equal(nextTabIndex('ArrowRight', 0, 0), null);
  assert.equal(nextTabIndex('ArrowLeft', 0, 1), 0);
});
test('operational modals cannot regress to unfocused div backdrops', () => {
  let native = 0;
  for (const path of sources('src/modules')) {
    const source = text(path);
    assert.ok(!source.includes('className="progress-modal-backdrop'), path);
    assert.ok(!source.includes('<SourceBadge'), `${path}: internal data-source labels are not product copy`);
    native += [...source.matchAll(/<OperationalDialog\b/g)].length;
  }
  assert.equal(native, 33);
});
test('font families use checksum-pinned complete self-hosted Vietnamese faces', () => {
  const assets = text('scripts/fetch-font-assets.mjs');
  const globals = text('src/app/globals.css');
  const packageJson = JSON.parse(text('package.json'));
  assert.equal([...assets.matchAll(/sha256: "[0-9a-f]{64}"/g)].length, 5);
  assert.equal([...globals.matchAll(/@font-face/g)].length, 5);
  assert.match(globals, /--font-body: "Be Vietnam Pro"/);
  assert.match(globals, /--font-editorial: "Noto Serif"/);
  assert.match(packageJson.scripts.build, /npm run fonts:assets/);
  assert.doesNotMatch(text('src/app/layout.tsx'), /next\/font|bodyFont\.variable|editorialFont\.variable/);
  assert.match(text('src/styles/workspace.css'), /font-synthesis: none/);
});
test('navigation has no stale second grouping or icon registry in the application composer', () => {
  assert.doesNotMatch(text('src/components/DentalSuite.tsx'), /const navGroups/);
  assert.doesNotMatch(text('src/components/AppShell.tsx'), /AppShellNavGroup/);
});
