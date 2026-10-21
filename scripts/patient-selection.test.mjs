import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePatientSelection } from '../src/workspaces/patients/patient-selection-state.ts';
import { patientLookupCommand } from '../src/workspaces/patients/patient-search-keyboard.ts';

const input = { available: true, patientIds: ['a', 'b'], selectedPatientId: '' };
test('loaded patient data without a selection is not an empty directory', () => {
  assert.equal(resolvePatientSelection(input), 'unselected');
  assert.equal(resolvePatientSelection({ ...input, patientIds: [] }), 'empty');
});
test('unavailable data cannot be presented as an empty or ready record', () => {
  for (const patientIds of [[], ['a']]) {
    assert.equal(resolvePatientSelection({ ...input, patientIds, available: false, selectedPatientId: 'a' }), 'unavailable');
  }
});
test('unknown and out-of-scope links do not silently select another patient', () => {
  assert.equal(resolvePatientSelection({ ...input, requestedPatientId: 'missing', selectedPatientId: 'a' }), 'invalid');
  assert.equal(resolvePatientSelection({ ...input, patientIds: [], requestedPatientId: 'missing' }), 'invalid');
  assert.equal(resolvePatientSelection({ ...input, selectedPatientId: 'missing' }), 'invalid');
});
test('a known requested patient is pending until composer selection agrees', () => {
  assert.equal(resolvePatientSelection({ ...input, requestedPatientId: 'b', selectedPatientId: 'a' }), 'loading');
  assert.equal(resolvePatientSelection({ ...input, requestedPatientId: 'b', selectedPatientId: 'b' }), 'ready');
  assert.equal(resolvePatientSelection({ ...input, selectedPatientId: 'a' }), 'ready');
});
test('selection resolution does not change the authorized input collection', () => {
  const patientIds = Object.freeze(['a', 'b']);
  resolvePatientSelection({ ...input, patientIds });
  assert.deepEqual(patientIds, ['a', 'b']);
});
test('plain patient lookup commands and native editing keys remain distinct', () => {
  for (const [key, command] of [['ArrowDown', 'next'], ['ArrowUp', 'previous'], ['Enter', 'select'], ['Escape', 'dismiss'], ['Tab', 'leave']]) {
    assert.equal(patientLookupCommand({ key }), command);
  }
  for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Dead', 'a']) assert.equal(patientLookupCommand({ key }), null);
});
test('modified keys stay with the platform; Shift+Tab still exits the lookup', () => {
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) assert.equal(patientLookupCommand({ key, [modifier]: true }), null);
  }
  assert.equal(patientLookupCommand({ key: 'Tab', shiftKey: true }), 'leave');
});
test('composition owns Enter, Escape and navigation until text is committed', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    assert.equal(patientLookupCommand({ key, isComposing: true }), null);
    assert.equal(patientLookupCommand({ key, keyCode: 229 }), null);
  }
  assert.equal(patientLookupCommand({ key: 'Enter', isComposing: false }), 'select');
});
