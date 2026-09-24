import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patientCodeFor, patientSearchMatches, normalizeSearchText, matchesChartSearch } from '../src/workspaces/patients/patient-search.ts';
import { readBrowserStorage, writeBrowserStorage, removeBrowserStorage } from '../src/shared/browser/storage.ts';

const a = { id: 'a', patientCode: 'PT001', name: 'Nguy\u1ec5n An', phone: '0901000000', flags: [], age: 30 };
const b = { id: 'b', patientCode: 'PT002', name: 'L\u00ea B\u00ecnh', phone: '0902000000', flags: [], age: 40, visitReason: '\u0110au r\u0103ng' };
const c = { id: 'c', patientCode: 'PT003', name: 'An Nguy\u1ec5n', phone: '0903000000', flags: [], age: 28 };
test('patient lookup preserves codes, accent-insensitive matching, stable order and source records', () => {
  const patients = [a, b, c];
  assert.equal(patientCodeFor(a), 'PT001');
  assert.equal(patientCodeFor({ id: 'patient-42' }), 'PT000042');
  assert.equal(normalizeSearchText('\u0110AU R\u0102NG'), 'dau rang');
  assert.deepEqual(patientSearchMatches(patients, 'nguyen'), [a, c]);
  assert.deepEqual(patientSearchMatches(patients, '0902'), [b]);
  assert.deepEqual(patientSearchMatches(patients, 'pt002'), [b]);
  assert.deepEqual(patientSearchMatches(patients, 'dau rang'), [b]);
  assert.deepEqual(patientSearchMatches(patients, 'no-match'), []);
  assert.equal(patientSearchMatches(patients, ''), patients);
  assert.deepEqual(patients, [a, b, c]);
  assert.equal(matchesChartSearch('binh', [undefined, null, b.name]), true);
});

test('optional browser storage supports normal access and isolates local/session stores', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const mock = () => {
    const data = new Map();
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: mock(), sessionStorage: mock() } });
  try {
    assert.equal(writeBrowserStorage('local', 'language', 'en'), true);
    assert.equal(readBrowserStorage('local', 'language'), 'en');
    assert.equal(readBrowserStorage('session', 'language'), null);
    assert.equal(writeBrowserStorage('session', 'scroll', '12'), true);
    assert.equal(removeBrowserStorage('session', 'scroll'), true);
    assert.equal(readBrowserStorage('session', 'scroll'), null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window;
  }
});

test('optional storage survives denied property access, quota errors and no browser', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const denied = () => { throw new Error('Storage denied'); };
  for (const value of [{ get localStorage() { return denied(); }, get sessionStorage() { return denied(); } },
    { localStorage: { getItem: denied, setItem: denied, removeItem: denied }, sessionStorage: { getItem: denied, setItem: denied, removeItem: denied } }, undefined]) {
    Object.defineProperty(globalThis, 'window', { configurable: true, value });
    try {
      for (const kind of ['local', 'session']) {
        assert.equal(readBrowserStorage(kind, 'preference'), null);
        assert.equal(writeBrowserStorage(kind, 'preference', 'value'), false);
        assert.equal(removeBrowserStorage(kind, 'preference'), false);
      }
    } finally {
      if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window;
    }
  }
});

test('patient lookup has one workspace owner and uses the shared native dialog', () => {
  const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const composer = source('src/components/DentalSuite.tsx');
  assert.doesNotMatch(composer, /function (PatientSearchCombobox|JourneyPatientMenu|patientSearchMatches)\b/);
  assert.doesNotMatch(composer, /window\.(localStorage|sessionStorage)/);
  const menu = source('src/workspaces/patients/JourneyPatientMenu.tsx');
  assert.match(menu, /<WorkspaceDialog\b/);
  assert.doesNotMatch(menu, /aria-modal|role="dialog"|addEventListener\("keydown"/);
});
