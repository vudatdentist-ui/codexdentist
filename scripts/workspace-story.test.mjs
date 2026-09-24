import { headingText } from "./qa-heading.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { workspaceStories, workspaceNavigation, visibleWorkspaceNavigation, normalizeWorkspaceSearch, viewFromPath } from '../src/workspaces/workspace-story.ts';
import { summarizeClinicDay } from '../src/workspaces/clinic-day.ts';
import { accessibleViews, viewRoutes } from '../src/lib/permissions.ts';

test('every route has complete bilingual labels without changing route keys', () => {
  assert.deepEqual(Object.keys(workspaceStories).sort(), Object.keys(viewRoutes).sort());
  for (const story of Object.values(workspaceStories)) for (const field of ['label','title']) for (const language of ['vi','en']) assert.ok(story[field][language].trim().length > 0);
});
test('navigation contains each direct destination once; clinical aliases remain in care journey', () => {
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

test('page titles use the navigation label and cannot acquire a subtitle field', () => {
  for (const entry of Object.values(workspaceStories)) {
    assert.deepEqual(entry.title, entry.label);
    assert.deepEqual(Object.keys(entry).sort(), ['chapter', 'label', 'title']);
  }
});

test('application headings and the brand have no narrative copy layer', () => {
  const source = readFileSync(new URL('src/components/AppShell.tsx', root), 'utf8');
  assert.doesNotMatch(source, /workspace-purpose|workspace-chapter|story\.purpose|The clinic care journal/);
  assert.doesNotMatch(source, /<p className="workspace-caption">\{routeTitle\}/);
  assert.match(source, /id="workspace-content" tabIndex=\{-1\}/);
});

test('dashboard section headings have no descriptive subtitles', () => {
  const source = readFileSync(new URL('src/modules/dashboard/Dashboard.tsx', root), 'utf8');
  assert.doesNotMatch(source, /workspace-chapter|day-scope-note|For the selected clinics/);
  assert.match(source, /item\.detail/);
  assert.match(source, /risk\.detail/);
  assert.match(source, /data-day-total/);
});

test('selection notices keep their states and retry action without a second copy line', () => {
  const source = readFileSync(new URL('src/workspaces/patients/PatientSelectionNotice.tsx', root), 'utf8');
  assert.doesNotMatch(source, /<p[\s>]|\bdetail\s*:/);
  for (const state of ['unselected', 'empty', 'invalid', 'unavailable', 'loading']) assert.match(source, new RegExp(`${state}:`));
  assert.match(source, /onClick=\{onRetry\}/);
  assert.match(source, /aria-busy=/);
});

test('authentication screens contain forms, not slogan panels or time estimates', () => {
  const login = readFileSync(new URL('src/app/(auth)/login/page.tsx', root), 'utf8');
  const signup = readFileSync(new URL('src/app/signup/page.tsx', root), 'utf8');
  assert.doesNotMatch(login, /login-story|workspace-caption|<ol>/);
  assert.doesNotMatch(signup, /styles\.(?:story|lead|benefits|eyebrow)|2 ph\u00fat/);
  assert.match(login, /action=\{loginAction\}/);
  assert.match(login, /action=\{forgotPasswordAction\}/);
  assert.match(login, /role="alert"/);
  assert.match(signup, /minLength=\{12\}/);
  assert.match(signup, /styles\.finePrint/);
});


test('route smoke reads the visible h1 text including escaped symbols, not body labels', () => {
  assert.equal(headingText('<h1 id="workspace-content">People &amp; payroll</h1>'), 'People & payroll');
  assert.equal(headingText('<h1><span>Forms</span> &#38; consent</h1>'), 'Forms & consent');
  assert.equal(headingText('<h1>&lt;Record&gt; &quot;A&quot; &#x27;B&#39;</h1>'), '<Record> "A" \'B\'');
  assert.equal(headingText('<h1>&amp;lt;</h1>'), '&lt;');
  assert.equal(headingText('<h1>Unrelated</h1><nav>People &amp; payroll</nav>'), 'Unrelated');
  assert.equal(headingText('<nav>People &amp; payroll</nav>'), '');
});
