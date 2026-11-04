import test from 'node:test';
import assert from 'node:assert/strict';
import { patientLookupCommand } from '../src/workspaces/patients/patient-search-keyboard.ts';

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
