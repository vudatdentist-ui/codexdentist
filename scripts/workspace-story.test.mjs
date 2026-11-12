import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { workspaceStories, workspaceNavigation, visibleWorkspaceNavigation, normalizeWorkspaceSearch, viewFromPath } from '../src/workspaces/workspace-story.ts';
import { summarizeClinicDay } from '../src/workspaces/clinic-day.ts';
import { accessibleViews, viewRoutes } from '../src/lib/permissions.ts';
import { headingText } from './qa-heading.mjs';

test('every route has complete bilingual functional titles without changing route keys', () => {
  assert.deepEqual(Object.keys(workspaceStories).sort(), Object.keys(viewRoutes).sort());
  for (const story of Object.values(workspaceStories)) for (const language of ['vi','en']) {
    assert.ok(story.label[language].trim().length > 0);
    assert.equal(story.title[language], story.label[language]);
  }
});
test('navigation contains each direct destination once; clinical aliases remain in care journey', () => {
  assert.deepEqual(workspaceNavigation.map(group => group.chapter), ['day', 'care', 'practice', 'team']);
  const views = workspaceNavigation.flatMap(group => group.views);
  assert.equal(new Set(views).size, views.length);
  assert.deepEqual([...views, 'clinical', 'treatment'].sort(), Object.keys(viewRoutes).sort());
});
test('navigation never exposes a view outside the session permissions', () => {
  for (const role of ['OWNER','AREA_MANAGER','CLINIC_MANAGER','DENTIST','HYGIENIST','FRONT_DESK','BILLING','PATIENT']) {
    const allowed = new Set(accessibleViews(role));
    const groups = visibleWorkspaceNavigation(allowed, 'vi');
    for (const group of groups) { assert.ok(group.views.length > 0); for (const view of group.views) assert.ok(allowed.has(view)); }
  }
  assert.deepEqual(visibleWorkspaceNavigation(new Set(), 'vi'), []);
  assert.deepEqual(visibleWorkspaceNavigation(new Set(['patient-app']), 'en').flatMap(group => group.views), ['patient-app']);
});
test('Vietnamese accent-insensitive search and explicit empty results', () => {
  assert.equal(normalizeWorkspaceSearch('Đơn thuốc'), 'don thuoc');
  const all = new Set(Object.keys(viewRoutes));
  assert.deepEqual(visibleWorkspaceNavigation(all,'vi','ho so').flatMap(group => group.views), ['patients']);
  assert.deepEqual(visibleWorkspaceNavigation(all,'vi','does-not-exist'), []);
});
test('route parsing ignores query/hash without accepting unknown destinations', () => {
  assert.equal(viewFromPath('/patients?patientId=123#record'),'patients');
  assert.equal(viewFromPath('/journey'),'journey');
  assert.equal(viewFromPath('/missing'),undefined);
});
test('day totals use complete selected-clinic aggregates, not the capped preview', () => {
  const clinics = [{clinicId:'a',todayAppointments:37,inChair:3,completed:11,collectedToday:100}, {clinicId:'b',todayAppointments:26,inChair:2,completed:8,collectedToday:200}, {clinicId:'other',todayAppointments:900,inChair:0,completed:0,collectedToday:999}];
  assert.deepEqual(summarizeClinicDay(clinics,new Set(['a','b'])),{appointments:63,inChair:5,completed:19,collected:300});
  assert.equal(summarizeClinicDay(clinics,new Set(['b'])).appointments,26);
  assert.deepEqual(summarizeClinicDay(clinics,new Set()),{appointments:0,inChair:0,completed:0,collected:0});
});
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
test('UI changes retain the locked runtime and development dependencies', () => {
  for (const key of ['dependencies', 'devDependencies']) assert.deepEqual(pkg[key], lock.packages[''][key], key);
});
test('package scripts reference existing repository files', () => {
  for (const [name, command] of Object.entries(pkg.scripts)) {
    for (const match of command.matchAll(/scripts\/[\w.-]+\.(?:mjs|ps1)/g)) {
      assert.ok(existsSync(new URL(match[0], root)), `${name}: ${match[0]}`);
    }
  }
});

test('route smoke reads the visible h1 text including escaped symbols, not body labels', () => {
  assert.equal(headingText('<h1 id="workspace-content">People &amp; payroll</h1>'), 'People & payroll');
  assert.equal(headingText('<h1><span>Forms</span> &#38; consent</h1>'), 'Forms & consent');
  assert.equal(headingText('<h1>&lt;Record&gt; &quot;A&quot; &#x27;B&#39;</h1>'), '<Record> "A" \'B\'');
  assert.equal(headingText('<h1>&amp;lt;</h1>'), '&lt;');
  assert.equal(headingText('<h1>Unrelated</h1><nav>People &amp; payroll</nav>'), 'Unrelated');
  assert.equal(headingText('<nav>People &amp; payroll</nav>'), '');
});
