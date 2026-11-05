const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');

const externalStudyId = 'synthetic-study-a';
const remoteStudy = { ID: externalStudyId, ParentPatient: 'pacs-patient-a', MainDicomTags: {
  StudyInstanceUID: '1.2.826.0.1.999', AccessionNumber: 'SYNTHETIC-A',
  StudyDescription: 'Synthetic organization A study', ModalitiesInStudy: 'CT', StudyDate: '20261105',
} };

// Exercise real transports, permissions, credential resolution, commands, stores
// and provider adapter. Replace only session/environment/database/network I/O.
function fixture() {
  const env = { NODE_ENV: 'production', DEPLOYMENT_MODE: 'hosted',
    ORTHANC_DEFAULT_ORGANIZATION_ID: 'org-a', ORTHANC_DEFAULT_BASE_URL: 'https://pacs.test',
    ORTHANC_DEFAULT_USERNAME: 'synthetic-user', ORTHANC_DEFAULT_PASSWORD: 'synthetic-password',
    ORTHANC_DEFAULT_VIEWER_BASE_URL: 'https://viewer.test/viewer', ORTHANC_DEFAULT_VIEWER_ACCESS_MODE: 'private' };
  let session;
  const connections = [], studies = [], references = [], http = [], audits = [], queries = [];
  let transactions = 0;
  const patients = ['a', 'b'].map(suffix => ({ id: `patient-${suffix}`, organizationId: `org-${suffix}`, clinicId: `clinic-${suffix}` }));
  const matches = (row, where) => (!where.id || row.id === where.id) &&
    (!where.organizationId || row.organizationId === where.organizationId) &&
    (!where.patientId || row.patientId === where.patientId) &&
    (!where.clinicId || where.clinicId.in.includes(row.clinicId));
  const unique = where => studies.find(row => Object.entries(where.organizationId_connectionId_externalStudyId).every(([key, value]) => row[key] === value));
  const db = {
    patient: { findFirst: async ({ where }) => patients.find(row => matches(row, where)) ?? null },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
    imagingStudy: {
      findUnique: async ({ where }) => unique(where) ?? null,
      findUniqueOrThrow: async ({ where }) => { const row = unique(where); assert.ok(row); return row; },
      create: async ({ data }) => {
        assert.ok(patients.some(patient => patient.id === data.patientId && patient.organizationId === data.organizationId && patient.clinicId === data.clinicId));
        studies.push({ ...data }); return studies.at(-1);
      },
      findFirst: async ({ where }) => studies.find(row => matches(row, where)) ?? null,
      findMany: async ({ where }) => studies.filter(row => matches(row, where)),
      update: async ({ where, data }) => { const row = studies.find(row => row.id === where.id); assert.ok(row); Object.assign(row, data); return row; },
    },
    $transaction: async operation => { transactions++; return operation(db); },
    $executeRaw: async () => 1,
    $queryRawUnsafe: async (sql, ...params) => {
      queries.push({ sql, params });
      if (sql.includes('INSERT INTO "IntegrationConnection"')) {
        const row = { id: params[0], organizationId: params[1], clinicId: params[2], provider: params[3], status: params[4],
          capabilities: JSON.parse(params[5]), secretRef: params[6], metadata: JSON.parse(params[7]), lastVerifiedAt: params[8], createdAt: new Date() };
        connections.push(row); return [row];
      }
      if (sql.includes('FROM "IntegrationConnection"')) {
        if (sql.includes('"organizationId" = $1')) return connections.filter(row => row.organizationId === params[0] && row.provider === params[1] &&
          (sql.includes("'ACTIVE'") ? row.status === 'ACTIVE' && (row.clinicId === params[2] || row.clinicId === null) : row.clinicId === params[2])).slice(0, 1);
        return connections.filter(row => row.id === params[0] && (!params[1] || row.provider === params[1]));
      }
      if (sql.includes('FROM "Clinic"')) return patients.filter(row => row.clinicId === params[0] && row.organizationId === params[1]).map(row => ({ id: row.clinicId })).slice(0, 1);
      if (sql.includes('FROM "ExternalReference"')) return references.filter(row => row.organizationId === params[0] && row.provider === params[1] &&
        row.entityType === params[2] && row.connectionId === params[3] && (sql.includes('"externalId" = $5') ? row.externalId === params[4] : row.internalId === params[4]));
      if (sql.includes('INSERT INTO "ExternalReference"')) {
        const row = { id: params[0], organizationId: params[1], clinicId: params[2], connectionId: params[3], provider: params[4],
          entityType: params[5], internalId: params[6], externalId: params[7], metadata: JSON.parse(params[8]) };
        references.push(row); return [row];
      }
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
  };
  const mocks = { 'next/server': { NextResponse: Response }, '@/lib/auth': { getSession: async () => session },
    '@/lib/env': { appBaseUrl: () => 'https://app.test', trustedProxyProvider: () => 'none' },
    '@/lib/prisma': { prisma: db }, '@/lib/error-reporting': { reportApplicationError: (_area, cause) => { throw cause; } } };
  const globals = { process: { env }, Request, Response, Headers, Date, fetch: async (url, init) => {
    assert.equal(String(url), `https://pacs.test/studies/${externalStudyId}`);
    assert.equal(init.headers.get('Authorization'), `Basic ${Buffer.from('synthetic-user:synthetic-password').toString('base64')}`);
    http.push({ organizationId: session.organizationId, url: String(url) });
    return Response.json(remoteStudy);
  } };
  const cache = new Map();
  const read = file => load(file, mocks, globals, cache);
  const connectionsRoute = read('src/app/api/integrations/connections/route.ts');
  const studiesRoute = read('src/app/api/imaging/studies/route.ts');
  const viewerRoute = read('src/app/api/imaging/studies/[studyId]/viewer/route.ts');
  const request = (path, body) => new Request(`https://app.test${path}`, body ? { method: 'POST',
    headers: { host: 'app.test', origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  function as(suffix) {
    session = { userId: `${suffix.repeat(8)}-1111-4111-8111-111111111111`, organizationId: `org-${suffix}`,
      role: 'OWNER', roles: ['OWNER'], clinicIds: [`clinic-${suffix}`], activeClinicId: null, isDemo: false };
    return session;
  }
  as('a');
  return { env, connections, studies, references, http, audits, queries, patients, as,
    transactions: () => transactions, config: read('src/integrations/config.ts'),
    configure: (extra = {}) => connectionsRoute.POST(request('/api/integrations/connections', { provider: 'orthanc', secretRef: 'env:ORTHANC_DEFAULT', ...extra })),
    import: (patientId = session.organizationId === 'org-a' ? 'patient-a' : 'patient-b') => studiesRoute.POST(request('/api/imaging/studies', { patientId, externalStudyId })),
    list: patientId => studiesRoute.GET(request(`/api/imaging/studies?patientId=${patientId}`)),
    viewer: studyId => viewerRoute.GET(request(`/api/imaging/studies/${studyId}/viewer`), { params: Promise.resolve({ studyId }) }),
    seedConnection: suffix => { const row = { id: `legacy-${suffix}`, organizationId: `org-${suffix}`, clinicId: null,
      provider: 'orthanc', status: 'ACTIVE', secretRef: 'env:ORTHANC_DEFAULT', createdAt: new Date() }; connections.push(row); return row; },
  };
}

for (const deploymentMode of ['hosted', 'self-hosted']) {
  for (const binding of [undefined, '', '   ', 'org-b']) {
    test(`${deploymentMode}: missing/foreign binding ${JSON.stringify(binding)} fails closed`, () => {
      const h = fixture(); h.env.DEPLOYMENT_MODE = deploymentMode; h.env.ORTHANC_DEFAULT_ORGANIZATION_ID = binding;
      assert.throws(() => h.config.resolveOrthancConnectionSecrets({ organizationId: 'org-a', secretRef: 'env:ORTHANC_DEFAULT' }),
        error => error.code === 'orthanc-organization-not-bound');
    });
  }
}

test('binding uses stored connection organization and preserves credential/HTTPS validation', () => {
  const h = fixture();
  const connection = { organizationId: 'org-a', secretRef: 'env:ORTHANC_DEFAULT' };
  assert.equal(h.config.resolveOrthancConnectionSecrets(connection).baseUrl, 'https://pacs.test');
  assert.throws(() => h.config.resolveOrthancConnectionSecrets({ ...connection, organizationId: '' }));
  assert.throws(() => h.config.resolveOrthancConnectionSecrets({ ...connection, secretRef: 'env:OTHER_TENANT' }), error => error.code === 'orthanc-secret-ref-invalid');
  h.env.ORTHANC_DEFAULT_BASE_URL = 'http://pacs.test';
  assert.throws(() => h.config.resolveOrthancConnectionSecrets(connection), error => error.code === 'orthanc-base-url-insecure');
  h.env.DEPLOYMENT_MODE = 'self-hosted';
  assert.equal(h.config.resolveOrthancConnectionSecrets(connection).baseUrl, 'http://pacs.test');
  h.env.ORTHANC_DEFAULT_ORGANIZATION_ID = 'org-b';
  assert.throws(() => h.config.resolveOrthancConnectionSecrets(connection), error => error.code === 'orthanc-organization-not-bound');
});

test('unbound/foreign setup rejects before any persistence; request organization cannot override session', async () => {
  const h = fixture();
  for (const binding of [undefined, '', 'org-b']) {
    h.env.ORTHANC_DEFAULT_ORGANIZATION_ID = binding;
    const response = await h.configure({ organizationId: 'org-b', ORTHANC_DEFAULT_ORGANIZATION_ID: 'org-a' });
    assert.equal(response.status, 403); assert.equal((await response.json()).error, 'orthanc-organization-not-bound');
    assert.equal(h.queries.length, 0); assert.equal(h.audits.length, 0); assert.equal(h.connections.length, 0);
  }
  h.env.ORTHANC_DEFAULT_ORGANIZATION_ID = 'org-a';
  assert.equal((await h.configure({ organizationId: 'org-b' })).status, 200);
  assert.equal(h.connections[0].organizationId, 'org-a');
});

test('bound organization retains import, list, stable patient mapping and private viewer contracts', async () => {
  const h = fixture(); assert.equal((await h.configure()).status, 200);
  const response = await h.import(); assert.equal(response.status, 201);
  const { study } = await response.json();
  assert.equal(study.externalPatientId, 'pacs-patient-a'); assert.equal(study.patientId, 'patient-a');
  assert.equal(h.references[0].organizationId, 'org-a'); assert.equal(h.references[0].internalId, 'patient-a');
  assert.equal((await h.import()).status, 201); assert.equal(h.studies.length, 1);
  const listed = await h.list('patient-a'); assert.equal(listed.status, 200); assert.equal((await listed.json()).studies.length, 1);
  const viewer = await h.viewer(study.id); assert.equal(viewer.status, 200);
  assert.equal((await viewer.json()).viewerUrl, 'https://viewer.test/viewer?StudyInstanceUIDs=1.2.826.0.1.999');
  assert.equal(h.studies[0].availability, 'AVAILABLE');
});

for (const missingBinding of [false, true]) test(`foreign re-import and viewer through existing connections fail before provider I/O (missing binding: ${missingBinding})`, async () => {
  const h = fixture(); await h.configure();
  const response = await h.import(); assert.equal(response.status, 201); const original = (await response.json()).study;
  h.as('b');
  const configured = await h.configure({ organizationId: 'org-a' }); assert.equal(configured.status, 403);
  const legacy = h.seedConnection('b');
  // A legacy record may already contain copied metadata. It cannot authorize
  // another PACS request or a viewer URL after enforcement is introduced.
  h.studies.push({ ...h.studies[0], id: 'legacy-copy', organizationId: 'org-b', clinicId: 'clinic-b', patientId: 'patient-b', connectionId: legacy.id });
  if (missingBinding) delete h.env.ORTHANC_DEFAULT_ORGANIZATION_ID;
  const before = { http: h.http.length, transactions: h.transactions(), references: h.references.length, studies: h.studies.length };
  const imported = await h.import(); assert.equal(imported.status, 503); assert.equal((await imported.json()).error, 'orthanc-organization-not-bound');
  const viewer = await h.viewer('legacy-copy'); assert.equal(viewer.status, 503);
  assert.equal((await viewer.json()).error, 'orthanc-organization-not-bound');
  assert.equal(h.http.length, before.http); assert.equal(h.transactions(), before.transactions);
  assert.equal(h.references.length, before.references); assert.equal(h.studies.length, before.studies);
  assert.equal((await h.viewer(original.id)).status, 404);
  assert.equal((await h.import('patient-a')).status, 404);
});

test('missing binding also blocks the formerly bound organization legacy connection', async () => {
  const h = fixture(); h.seedConnection('a'); delete h.env.ORTHANC_DEFAULT_ORGANIZATION_ID;
  const response = await h.import(); assert.equal(response.status, 503);
  assert.equal(h.http.length, 0); assert.equal(h.transactions(), 0);
});

test('inaccessible clinics, mismatched connection ownership and remote identity still deny viewer access', async () => {
  const h = fixture(); await h.configure(); const study = (await (await h.import()).json()).study;
  const before = h.http.length;
  const session = h.as('a'); session.clinicIds = ['clinic-other'];
  assert.equal((await h.viewer(study.id)).status, 404); assert.equal((await h.import()).status, 404);
  assert.equal(h.http.length, before);
  h.as('a'); const connection = h.connections[0]; connection.organizationId = 'org-b';
  assert.equal((await h.viewer(study.id)).status, 503); assert.equal(h.http.length, before);
  connection.organizationId = 'org-a'; connection.clinicId = 'clinic-other';
  assert.equal((await h.viewer(study.id)).status, 503); assert.equal(h.http.length, before);
  connection.clinicId = null; h.studies[0].studyInstanceUid = '1.2.999';
  const mismatch = await h.viewer(study.id); assert.equal(mismatch.status, 503);
  assert.equal((await mismatch.json()).error, 'orthanc-study-identity-mismatch'); assert.equal(h.studies[0].availability, 'UNAVAILABLE');
});

test('existing authorization, demo, clinic setup and disabled-viewer guards remain intact', async () => {
  const h = fixture(); const session = h.as('a');
  session.isDemo = true; assert.equal((await h.configure()).status, 403);
  session.isDemo = false; session.role = 'DENTIST'; session.roles = ['DENTIST'];
  assert.equal((await h.configure()).status, 403); assert.equal(h.queries.length, 0);
  h.as('a'); assert.equal((await h.configure({ clinicId: 'clinic-b' })).status, 403); assert.equal(h.queries.length, 0);
  assert.equal((await h.configure()).status, 200); const study = (await (await h.import()).json()).study;
  h.env.ORTHANC_DEFAULT_VIEWER_ACCESS_MODE = 'disabled'; const before = h.http.length;
  assert.equal((await h.viewer(study.id)).status, 503); assert.equal(h.http.length, before);
});
