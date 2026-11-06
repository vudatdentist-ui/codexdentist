const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./audit-source-loader.cjs');

const owner = { userId: 'owner-a', organizationId: 'org-a', role: 'OWNER', roles: ['OWNER'],
  clinicIds: ['clinic-a'], activeClinicId: null, isDemo: false };
const source = { id: 'synthetic-patient', organizationId: 'org-a', clinicId: 'clinic-a',
  fullName: 'Nguyễn Văn An', dateOfBirth: new Date('1990-01-02T00:00:00Z'), gender: 'NAM',
  phone: '0000000000', email: 'synthetic@example.test', address: 'Synthetic address' };
const json = value => JSON.parse(JSON.stringify(value));

for (const fullName of ['Nguyễn Văn An', 'Nguyễn Tôn Nữ Minh Anh', 'María del Carmen García López',
  'Jean-Pierre van der Meer', 'Sukarno', '王小明']) {
  test(`FHIR retains unstructured name without inventing parts: ${fullName}`, () => {
    const { toFhirPatient } = load('src/integrations/fhir/patient.ts');
    const resource = toFhirPatient({ ...source, fullName });
    assert.deepEqual(json(resource.name), [{ use: 'official', text: fullName }]);
    assert.equal(resource.identifier[0].value, source.id);
    assert.equal(resource.gender, 'male');
    assert.equal(resource.birthDate, '1990-01-02');
    assert.equal(Object.hasOwn(resource, 'organizationId'), false);
    assert.equal(Object.hasOwn(resource, 'clinicId'), false);
  });
}

function harness({ session = owner, enabled = true, patient = source, auditFails = false } = {}) {
  const reads = [], audits = [];
  const mocks = {
    '@/lib/auth': { getSession: async () => session },
    '@/lib/env': { fhirExportEnabled: () => enabled },
    '@/lib/prisma': { prisma: {
      patient: { findFirst: async query => {
        reads.push(json(query));
        const where = query.where;
        // Keep authorization and scope construction real; replace database I/O.
        return patient && where.organizationId === patient.organizationId && where.id === patient.id &&
          where.clinicId?.in.includes(patient.clinicId) ? patient : null;
      } },
      auditLog: { create: async input => {
        audits.push(json(input));
        if (auditFails) throw new Error('Synthetic audit failure');
      } },
    } },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
  };
  const route = load('src/app/api/integrations/fhir/patients/[patientId]/route.ts', mocks);
  return { reads, audits, get: (id = source.id) => route.GET(new Request('https://app.test/fhir'), {
    params: Promise.resolve({ patientId: id }),
  }) };
}
async function outcome(h, status, code) {
  const response = await h.get();
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /^application\/fhir\+json/);
  const body = await response.json();
  assert.equal(body.resourceType, 'OperationOutcome');
  assert.equal(body.issue[0].code, code);
  assert.ok(!JSON.stringify(body).includes(source.fullName));
  return body;
}

test('FHIR route returns scoped identity and PHI-minimized audit', async () => {
  const h = harness();
  const response = await h.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /^application\/fhir\+json/);
  const resource = await response.json();
  assert.equal(resource.name[0].text, source.fullName);
  assert.deepEqual(h.reads[0].where, { organizationId: 'org-a', clinicId: { in: ['clinic-a'] }, id: source.id });
  assert.deepEqual(h.audits[0].data, { organizationId: 'org-a', actorId: 'owner-a',
    action: 'interop.patient_exported', entityType: 'Patient', entityId: source.id,
    metadata: { format: 'FHIR', resourceType: 'Patient' } });
  for (const value of [source.fullName, source.phone, source.email, source.address]) {
    assert.ok(!JSON.stringify(h.audits).includes(value));
  }
});
test('FHIR stays disabled without reading or auditing patient data', async () => {
  const h = harness({ enabled: false });
  await outcome(h, 404, 'not-supported');
  assert.equal(h.reads.length + h.audits.length, 0);
});
test('FHIR requires authentication before querying or exporting', async () => {
  const h = harness({ session: null });
  await outcome(h, 401, 'login');
  assert.equal(h.reads.length + h.audits.length, 0);
});
test('FHIR action permission denies front desk before database access', async () => {
  const h = harness({ session: { ...owner, role: 'FRONT_DESK', roles: ['FRONT_DESK'] } });
  await outcome(h, 403, 'forbidden');
  assert.equal(h.reads.length + h.audits.length, 0);
});
for (const [label, patient] of [['another organization', { ...source, organizationId: 'org-b' }],
  ['inaccessible clinic', { ...source, clinicId: 'clinic-b' }], ['missing record', null]]) {
  test(`FHIR conceals ${label} and records no export audit`, async () => {
    const h = harness({ patient });
    await outcome(h, 404, 'not-found');
    assert.equal(h.reads.length, 1);
    assert.equal(h.audits.length, 0);
  });
}
test('FHIR does not return patient data when the required export audit fails', async () => {
  const h = harness({ auditFails: true });
  await outcome(h, 503, 'processing');
  assert.equal(h.audits.length, 1);
});
