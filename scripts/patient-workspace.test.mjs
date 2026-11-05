import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { patientCodeFor, patientSearchMatches, normalizeSearchText, matchesChartSearch } from '../src/workspaces/patients/patient-search.ts';
import { readBrowserStorage, writeBrowserStorage, removeBrowserStorage } from '../src/shared/browser/storage.ts';
const require = createRequire(import.meta.url);
const { load } = require('./audit-source-loader.cjs');
const { resolvePatientSelection } = load('src/workspaces/patients/patient-selection-state.ts');

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
  const composer = ['DentalSuite.tsx', 'suite-model.tsx', 'suite-view.tsx', 'suite-shared.tsx'].map(file => source(`src/components/${file}`)).join('\n');
  assert.doesNotMatch(composer, /function (PatientSearchCombobox|JourneyPatientMenu|patientSearchMatches)\b/);
  assert.doesNotMatch(composer, /window\.(localStorage|sessionStorage)/);
  const menu = source('src/workspaces/patients/JourneyPatientMenu.tsx');
  assert.match(menu, /<WorkspaceDialog\b/);
  assert.doesNotMatch(menu, /aria-modal|role="dialog"|addEventListener\("keydown"/);
});

test('Journey selection distinguishes unavailable, empty, absent, invalid and pending identities', () => {
  const ready = { available: true, patientIds: ['A', 'B'], selectedPatientId: 'A', requestedPatientId: 'A' };
  for (const [change, expected] of [
    [{}, 'ready'], [{ requestedPatientId: null }, 'unselected'], [{ requestedPatientId: '' }, 'unselected'],
    [{ selectedPatientId: '' }, 'loading'], [{ requestedPatientId: 'B' }, 'loading'],
    [{ requestedPatientId: 'outside-scope' }, 'invalid'], [{ patientIds: ['B'] }, 'invalid'],
    [{ patientIds: [], requestedPatientId: null }, 'empty'], [{ available: false }, 'unavailable'],
  ]) assert.equal(resolvePatientSelection({ ...ready, ...change }), expected);
});

function journeyModelHarness() {
  let values = [], index = 0, effects = [], dirty = false, query = new URLSearchParams('patientId=A');
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
      return [values[slot], next => {
        const value = typeof next === 'function' ? next(values[slot]) : next;
        dirty ||= !Object.is(value, values[slot]); values[slot] = value;
      }];
    },
    useEffect(fn, deps) { effects.push({ fn, deps }); }, useLayoutEffect() {}, useMemo(fn) { return fn(); },
  };
  const clinic = { id: 'C', name: 'Synthetic', production: 0, collection: 0, todayVisits: 0, utilization: 0 };
  const patients = ['A', 'B'].map(id => ({ id, name: `Synthetic ${id}`, clinicId: 'C', phone: '0000000000', flags: [] }));
  const props = { activeView: 'journey', patientWorkspace: { source: 'database', patients, clinics: [clinic] },
    session: { role: 'OWNER', fullName: 'Synthetic', clinicIds: ['C'], clinics: [clinic] } };
  const { useDentalSuiteModel } = load('src/components/suite-model.tsx', {
    react, 'next/navigation': { useRouter: () => ({ push() {}, replace() {} }), usePathname: () => '/journey', useSearchParams: () => query },
    '@/lib/permissions': { accessibleViews: () => ['journey'] },
    './suite-shared': { initialLanguage: 'en', uiText: { en: {}, vi: {} }, saveActionScrollState() {}, restoreActionScrollState() {},
      shouldKeepActionNotice: () => true, normalizeSearchText: value => value.toLowerCase(), patientSearchMatches: list => list,
      matchesChartSearch: () => true, moduleAiOutput: () => '',
      buildModuleAiContext: context => ({ patientId: context.journeySelectedPatient?.id ?? null }), stringifyAiContext: JSON.stringify },
  });
  function render() { index = 0; effects = []; dirty = false; return useDentalSuiteModel(props); }
  function settle() {
    for (let n = 0; n < 8; n++) {
      const model = render();
      for (const effect of effects) if (effect.deps?.includes(`journey:${query.get('patientId') ?? ''}`)) effect.fn();
      if (!dirty) return model;
    }
    throw new Error('Selection did not settle');
  }
  return { props, render, settle, navigate(value) { query = new URLSearchParams(value); } };
}

test('actual composer never exposes stale chart/topbar/AI identity, including before effects and Back/Forward', () => {
  const h = journeyModelHarness();
  assert.equal(h.render().journeySelectedPatient, null, 'Known link waits for composer identity');
  assert.equal(h.settle().journeySelectedPatient.id, 'A');
  for (const query of ['patientId=unknown', 'patientId=outside-scope', '', 'patientId=']) {
    h.navigate(query);
    for (const model of [h.render(), h.settle()]) {
      assert.equal(model.journeySelectedPatient, null);
      assert.equal(JSON.parse(model.moduleAiContextJson).patientId, null);
      assert.equal(model.journeyRecordPatientId, 'A', 'Temporary route mismatch keeps the draft owner mounted');
    }
    h.navigate('patientId=A'); assert.equal(h.settle().journeySelectedPatient.id, 'A');
  }
  h.navigate('patientId=B');
  assert.equal(h.render().journeySelectedPatient, null, 'Hide A during async switch to B');
  assert.equal(h.settle().journeySelectedPatient.id, 'B');
  h.navigate('patientId=A'); assert.equal(h.settle().journeySelectedPatient.id, 'A');
  h.navigate('patientId=B'); assert.equal(h.settle().journeySelectedPatient.id, 'B');
  h.props.patientWorkspace.patients = h.props.patientWorkspace.patients.filter(patient => patient.id === 'A');
  assert.equal(h.render().journeySelectedPatient, null, 'Scope changes cannot retain an unauthorized patient');
  h.props.patientWorkspace = null;
  assert.equal(h.render().journeySelectedPatient, null, 'Unavailable data cannot establish identity');
});

test('actual Journey boundary hides mismatched editable content and keys all record state by patient', () => {
  let query = new URLSearchParams('patientId=A');
  const { Activity } = require('react');
  const { PatientJourneyPanel } = load('src/modules/journey/PatientJourneyPanel.tsx', {
    react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': { useRouter: () => ({ refresh() {} }), useSearchParams: () => query },
    '@/components/AppLanguage': { useAppLanguage: () => ({ language: 'vi' }) },
    './journey-model': { usePatientJourneyPanelModel() {} }, './journey-view': { PatientJourneyPanelView() {} },
  });
  const props = { selectedPatientId: 'A', visiblePatients: [{ id: 'A' }, { id: 'B' }], patientWorkspace: { source: 'database' } };
  function tree(input = props) { const boundary = PatientJourneyPanel(input); return boundary.type(boundary.props).props.children; }
  assert.equal(tree()[1].type, Activity);
  assert.equal(tree()[1].props.mode, 'visible');
  query = new URLSearchParams('patientId=unknown');
  assert.equal(tree()[0].props.children[0].props.children, 'Không thể mở hồ sơ này');
  assert.equal(tree()[1].props.mode, 'hidden');
  assert.equal(tree()[1].props.children.key, 'A');
  query = new URLSearchParams('patientId=A');
  assert.equal(tree()[1].props.children.key, 'A', 'Invalid link and Back preserve the same draft owner');
  query = new URLSearchParams('patientId=B');
  assert.equal(tree()[1].props.mode, 'hidden', 'Pending valid switch also hides A');
  assert.equal(tree({ ...props, selectedPatientId: 'B' })[1].props.children.key, 'B', 'B mounts fresh comments, attachments and dialogs');
});
