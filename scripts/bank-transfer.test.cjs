const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./audit-source-loader.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const globals = { TextEncoder, TextDecoder };
const domain = load('src/domains/revenue/bank-transfer.ts', {}, globals);
// Synthetic fixtures only. These are never seeded or configured in an operational account.
const account = { bankBin: '970436', accountNumber: '000000000000', recipientName: 'SYNTHETIC TEST ONLY' };
const owner = { userId: 'user-a', organizationId: 'org-a', role: 'OWNER', roles: ['OWNER'], roleAssignments: [],
  activeClinicId: null, clinicIds: ['clinic-a'], clinics: [{ id: 'clinic-a', name: 'Synthetic clinic' }], isDemo: false };
const body = { action: 'save', clinicId: 'clinic-a', ...account, accountConfirmed: true };

function decode(text) {
  const data = Buffer.from(text, 'utf8'), fields = new Map(); let cursor = 0;
  while (cursor < data.length) {
    const tag = data.subarray(cursor, cursor + 2).toString(); const length = Number(data.subarray(cursor + 2, cursor + 4).toString());
    assert.match(tag, /^\d{2}$/); assert.ok(length >= 1 && length <= 99); cursor += 4;
    assert.ok(cursor + length <= data.length); assert.ok(!fields.has(tag));
    fields.set(tag, new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(cursor, cursor + length))); cursor += length;
  }
  assert.equal(cursor, data.length); return fields;
}
// Independent bit implementation (polynomial division), not the production CRC routine.
function crcReference(text) {
  let register = 65535;
  for (const byte of Buffer.from(text)) for (let bit = 7; bit >= 0; bit--) {
    const carry = ((register >>> 15) ^ (byte >>> bit)) & 1;
    register = (register * 2) & 65535; if (carry) register ^= 4129;
  }
  return register.toString(16).toUpperCase().padStart(4, '0');
}
test('NAPAS nested account template, amount, purpose and independent CRC decode correctly', () => {
  const payload = domain.createBankTransferPayload(account, 150000, 'CD ABC123'); const root = decode(payload);
  assert.equal(root.get('00'), '01'); assert.equal(root.get('01'), '12'); assert.equal(root.get('53'), '704');
  assert.equal(root.get('54'), '150000'); assert.equal(root.get('58'), 'VN');
  const napas = decode(root.get('38')); assert.equal(napas.get('00'), 'A000000727'); assert.equal(napas.get('02'), 'QRIBFTTA');
  const beneficiary = decode(napas.get('01')); assert.equal(beneficiary.get('00'), account.bankBin); assert.equal(beneficiary.get('01'), account.accountNumber);
  assert.equal(decode(root.get('62')).get('08'), 'CD ABC123');
  assert.equal(root.get('63'), crcReference(payload.slice(0, -4))); assert.ok(payload.endsWith('6304' + crcReference(payload.slice(0, -4))));
  assert.equal(domain.bankTransferCrc('123456789'), '29B1'); assert.ok(!payload.includes(account.recipientName));
});
test('UTF8 TLV uses byte length and rejects invalid strings, lengths and tags', () => {
  const tlv = domain.bankTransferTlv('01', 'Việt'); assert.equal(Number(tlv.slice(2, 4)), Buffer.byteLength('Việt'));
  assert.equal(decode(tlv).get('01'), 'Việt');
  for (const value of ['', 'a'.repeat(100), 'ế'.repeat(34), '\ud800']) assert.throws(() => domain.bankTransferTlv('01', value));
  for (const tag of ['x1', '001', '1', '-1']) assert.throws(() => domain.bankTransferTlv(tag, 'test'));
});
test('matches the NAPAS v1.0 section 6.1.3 published CRC example', () => {
  const published = '00020101021238570010A00000072701270006970403011300110123456780208QRIBFTTA530370454061800005802VN62340107NPS68690819thanh toan don hang6304';
  assert.equal(domain.bankTransferCrc(published), '2E2E');
  assert.equal(crcReference(published), '2E2E');
  const generated = domain.createBankTransferPayload({ bankBin: '970403', accountNumber: '0011012345678', recipientName: 'SPECIFICATION EXAMPLE' }, 180000, 'CD EXAMPLE');
  assert.equal(decode(generated).get('38'), decode(published + '2E2E').get('38'));
});
for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 500000000, '1000', 1e20]) test(`rejects invalid amount ${value}`, () => {
  assert.throws(() => domain.createBankTransferPayload(account, value, 'CD ABC'));
});
test('rejects unsafe account and memo fields; preserves leading zeros', () => {
  for (const change of [{ bankBin: '97043' }, { bankBin: '9704360' }, { accountNumber: '123 45' }, { accountNumber: '1'.repeat(20) },
    { recipientName: '' }, { recipientName: ' x' }, { recipientName: 'A\nB' }, { recipientName: '\ud800' }]) assert.throws(() => domain.validateBankTransferAccount({ ...account, ...change }));
  for (const memo of ['', 'Nguyễn', 'a', 'A'.repeat(26), '<script>']) assert.throws(() => domain.createBankTransferPayload(account, 1, memo));
  assert.equal(domain.validateBankTransferAccount(account).accountNumber, account.accountNumber);
  assert.ok(domain.createBankTransferPayload(account, 499999999, 'CD MAX'));
});

const { harness } = require('./bank-transfer-harness.cjs');
test('real scoped command generates instructions from canonical remaining balance, with no finance mutations', async () => {
  const h = harness(); const response = await h.qr(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json(); assert.equal(result.balance, 150000); assert.equal(result.bankAccountVerified, false);
  assert.equal(result.recipientName, account.recipientName); assert.match(result.memo, /^CD [A-F0-9]{20}$/);
  assert.equal(decode(result.payload).get('54'), '150000'); assert.deepEqual(h.state.writes, []); assert.deepEqual(h.state.audits, []);
});
for (const [name, options, status] of [
  ['login', { session: null }, 401], ['demo', { session: { ...owner, isDemo: true } }, 403],
  ['dentist', { session: { ...owner, role: 'DENTIST', roles: ['DENTIST'] } }, 403],
  ['portal', { session: { ...owner, role: 'PATIENT', roles: ['PATIENT'] } }, 403],
  ['tenant', { patient: { organizationId: 'org-b' } }, 404], ['clinic', { patient: { clinicId: 'clinic-b' } }, 404],
  ['foreign invoice', { invoice: { patientId: 'patient-b' } }, 404], ['VOID', { invoice: { status: 'VOID' } }, 404],
  ['paid', { invoice: { paidAmount: '200000.00' } }, 409], ['missing patient', { missingPatient: true }, 404],
  ['missing invoice', { missingInvoice: true }, 404], ['missing binding', { noConnection: true }, 409],
  ['disabled override', { connection: { status: 'DISABLED' } }, 409], ['foreign binding', { connection: { organizationId: 'org-b' } }, 409],
  ['missing keys', { missingKeys: true }, 409],
]) test(`QR rejects ${name}`, async () => { const h = harness(options); assert.equal((await h.qr()).status, status); assert.equal(h.state.writes.length, 0); });
test('billing role can generate but cannot manage bank settings', async () => {
  const h = harness({ session: { ...owner, role: 'BILLING', roles: ['BILLING'] } });
  assert.equal((await h.qr()).status, 200); assert.equal((await h.save()).status, 403);
});
test('amount is a positive integer within current canonical balance; stale/fractional/unsafe amounts fail', async () => {
  const h = harness(); for (const amount of [0, -1, 0.1, '100', 150001, 500000000, Number.MAX_SAFE_INTEGER + 1]) assert.notEqual((await h.qr({ amount })).status, 200);
  assert.equal((await h.qr({ amount: 1 })).status, 200);
  h.state.invoice.paidAmount = '199999.50'; assert.equal((await h.qr({ amount: 1 })).status, 409);
  h.state.invoice.amount = '200000.005'; assert.equal((await h.qr({ amount: 1 })).status, 503);
});
test('request boundary rejects cross-origin, oversized, non-object and malformed bodies', async () => {
  const h = harness(); assert.equal((await h.qr({}, 'https://evil.test')).status, 403);
  for (const value of [null, [], 'x'.repeat(4097)]) assert.equal((await h.save(value)).status, 400);
  const req = new Request('https://app.test/api', { method: 'POST', headers: { host: 'app.test', origin: 'https://app.test', 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await h.settings.POST(req)).status, 400);
});
test('settings save encrypts all account details, audits no bank data and never claims bank verification', async () => {
  const h = harness(); const response = await h.save(); assert.equal(response.status, 200);
  const result = await response.json(); assert.ok(result.connections[0].configured); assert.equal(result.connections[0].enabled, true);
  assert.equal(h.state.writes[0].lastVerifiedAt, null);
  for (const value of Object.values(account)) {
    assert.ok(!JSON.stringify([result, h.state.writes, h.state.audits, h.state.ciphertext]).includes(value));
  }
  assert.ok(h.state.ciphertext.startsWith('v1.'));
  assert.equal((await h.qr()).status, 200);
  assert.equal((await h.save({ action: 'disable', clinicId: 'clinic-a' })).status, 200);
  assert.equal((await h.qr()).status, 409);
  assert.equal((await h.save({ action: 'enable', clinicId: 'clinic-a' })).status, 200);
});
test('settings require operator confirmation and enforce organization versus clinic role assignments', async () => {
  const h = harness(); assert.equal((await h.save({ ...body, accountConfirmed: false })).status, 400);
  const manager = { ...owner, role: 'CLINIC_MANAGER', roles: ['CLINIC_MANAGER'], activeClinicId: 'clinic-a',
    roleAssignments: [{ organizationId: 'org-a', clinicId: 'clinic-a', role: 'CLINIC_MANAGER' }] };
  const m = harness({ session: manager }); assert.equal((await m.save()).status, 200);
  assert.equal((await m.save({ ...body, clinicId: null })).status, 403);
  assert.equal((await m.save({ ...body, clinicId: 'clinic-b' })).status, 403);
  assert.equal((await harness({ session: { ...owner, isDemo: true } }).save()).status, 403);
  const clinicOwner = harness({ session: { ...manager, role: 'OWNER', roles: ['OWNER'], roleAssignments: [{ organizationId: 'org-a', clinicId: 'clinic-a', role: 'OWNER' }] } });
  assert.equal((await clinicOwner.save({ ...body, clinicId: null })).status, 403);
  assert.equal((await h.save({ ...body, clinicId: null })).status, 200);
});
