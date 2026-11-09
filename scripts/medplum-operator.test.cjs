const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { AsyncLocalStorage } = require('node:async_hooks');
const { load } = require('./audit-source-loader.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const owner = { userId: 'owner-a', organizationId: 'org-a', role: 'OWNER', roles: ['OWNER'],
  roleAssignments: [], clinicIds: ['clinic-a'], activeClinicId: null, isDemo: false };
const source = { id: 'synthetic-patient', organizationId: 'org-a', clinicId: 'clinic-a',
  fullName: 'Nguyễn Tôn Nữ Minh Anh', dateOfBirth: new Date('1990-01-02Z'), gender: 'NU',
  phone: '0000000000', email: 'synthetic@example.test', address: 'Synthetic address' };
const secrets = { baseUrl: 'https://medplum.test', clientId: 'client-a', clientSecret: 'synthetic-secret', projectId: 'project-a' };

function harness(options = {}) {
  const transactionContext = new AsyncLocalStorage();
  const state = { patient: { ...source, ...options.patient }, session: options.session === undefined ? owner : options.session,
    row: null, audits: [], calls: [], remote: null, transaction: false, updatedAt: new Date('2026-11-06Z') };
  const connection = () => ({ id: 'conn-a', organizationId: 'org-a', clinicId: 'clinic-a', provider: 'medplum',
    status: 'ACTIVE', lastVerifiedAt: new Date(), secretRef:'vault:v1', updatedAt: state.updatedAt,
    metadata:{configurationVersion:'version-A',verifiedVersion:'version-A',providerIdentity:'Project/project-a'}, ...options.connection });
  const findPatient = async ({ where }) => {
    assert.equal(where.organizationId, state.session.organizationId);
    if (options.missing || where.id !== state.patient.id || where.organizationId !== state.patient.organizationId ||
      !where.clinicId?.in.includes(state.patient.clinicId)) return null;
    return { ...state.patient };
  };
  const db = { patient: { findFirst: findPatient }, integrationConnection: { findFirst: async () => connection() },
    externalReference: {
      findFirst: async () => state.row && copy(state.row),
      upsert: async ({ create, update }) => { state.row = copy(state.row ? { ...state.row, ...update } : create); },
      update: async ({ data }) => { state.row = copy({ ...state.row, ...data }); },
    }, auditLog: { create: async ({ data }) => { if (options.auditFails) throw new Error('audit'); state.audits.push(copy(data)); } },
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('IntegrationConnection')) return [{ ...connection(), now: new Date(), ...(options.reservationConnection || {}) }];
      assert.equal(args[1], 'org-a');
      return state.row ? [copy(state.row)] : [];
    },
  };
  const providerFetch = async (url, init) => {
    assert.ok(!transactionContext.getStore(), 'provider I/O must be outside transactions');
    state.calls.push({ url, init });
    if (options.fetch) return options.fetch(url, init, state);
    if (url.endsWith('/oauth2/token')) return Response.json({ token_type: 'Bearer', access_token: 'synthetic-access' });
    if (url.endsWith('/auth/me')) return Response.json({ project: { resourceType: 'Project', id: options.projectId ?? 'project-a' }, profile: { resourceType: 'ClientApplication', id: 'client-a' } });
    if (url.includes('/Patient?')) return Response.json({ resourceType:'Bundle', total:state.remote ? 1 : 0,
      entry:state.remote ? [{resource:state.remote}] : [] });
    if (init.method === 'PUT' || init.method === 'POST') {
      state.remote = { ...JSON.parse(init.body), id: 'remote-a', meta:{versionId:'version-'+(state.calls.length)} };
      if (options.changeInFlight) state.patient.fullName = 'Changed synthetic name';
      if (options.changeConnection) state.updatedAt = new Date('2026-11-07Z');
      if (options.lost && !state.lost) { state.lost = true; throw new Error('lost response with PRIVATE token'); }
    }
    return Response.json(state.remote);
  };
  let queue = Promise.resolve();
  const mocks = {
    '@/lib/auth': { getSession: async () => state.session },
    '@/lib/prisma': { prisma: db },
    '@/lib/transaction': { runSerializableTransaction: fn => {
      const next = queue.then(() => transactionContext.run(true, () => fn(db)));
      queue = next.catch(() => {}); return next;
    } },
    '@/lib/application/integrations/optional-provider-settings': { loadOptionalProviderConnection: async (session, provider, clinicId) => {
      assert.equal(session.organizationId, 'org-a'); assert.equal(provider, 'medplum'); assert.equal(clinicId, 'clinic-a');
      if (options.noBinding) throw Object.assign(new Error(), { code: 'integration-not-configured', status: 409 });
      return { connection: connection(), secrets: { ...secrets, ...options.secrets } };
    } },
    '@/integrations/optional-http': { optionalProviderFetch: providerFetch },
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
  };
  const route = load('src/app/api/integrations/medplum/patients/[patientId]/route.ts', mocks);
  const adapter = load('src/integrations/medplum/client.ts', mocks);
  const request = async (method = 'POST', origin = 'https://app.test') => route[method](new Request('https://app.test/api/integrations/medplum/patients/synthetic-patient', {
    method, headers: { origin, host: 'app.test' },
  }), { params: Promise.resolve({ patientId: 'synthetic-patient' }) });
  return { state, request, adapter };
}

test('scoped export uses lossless mapper, explicit identifier conditional creation and verified readback', async () => {
  const h = harness(); const response = await h.request();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).status, 'VERIFIED');
  const put = h.state.calls.find(call => call.init.method === 'POST' && call.url.endsWith('/Patient'));
  assert.equal(new URLSearchParams(put.init.headers['If-None-Exist']).get('identifier'), 'https://codexdentist.com/fhir/organization/org-a/patient|synthetic-patient');
  const body = JSON.parse(put.init.body);
  assert.deepEqual(body.name, [{ use: 'official', text: source.fullName }]);
  assert.equal(body.id, undefined);
  assert.equal(body.identifier.length, 2);
  assert.equal(h.state.row.externalId, 'remote-a');
  for (const value of [source.fullName, source.phone, source.email, source.address, secrets.clientSecret, 'synthetic-access']) {
    assert.ok(!JSON.stringify([h.state.row, h.state.audits]).includes(value));
  }
});
for (const [label, options, status] of [
  ['authentication', { session: null }, 401],
  ['permission', { session: { ...owner, role: 'FRONT_DESK', roles: ['FRONT_DESK'] } }, 403],
  ['demo', { session: { ...owner, isDemo: true } }, 403],
  ['tenant', { patient: { organizationId: 'org-b' } }, 404],
  ['clinic', { patient: { clinicId: 'clinic-b' } }, 404],
  ['missing patient', { missing: true }, 404],
  ['missing binding', { noBinding: true }, 409],
  ['disabled connection', { connection: { status: 'DISABLED' } }, 409],
  ['unverified connection', { connection: { lastVerifiedAt: null } }, 409],
  ['wrong connection tenant', { connection: { organizationId: 'org-b' } }, 409],
  ['wrong connection clinic', { connection: { clinicId: 'clinic-b' } }, 409],
  ['patient portal', { session: { ...owner, role: 'PATIENT', roles: ['PATIENT'] } }, 403],
  ['missing credentials', { secrets: { clientSecret: '' } }, 409],
]) test(`rejects ${label} before provider access`, async () => {
  const h = harness(options); assert.equal((await h.request()).status, status); assert.equal(h.state.calls.length, 0);
});
test('GET checks status without exporting; cross-origin POST denied', async () => {
  const h = harness(); assert.equal((await (await h.request('GET')).json()).status, 'NEVER');
  assert.equal((await h.request('POST', 'https://evil.test')).status, 403); assert.equal(h.state.calls.length, 0);
});
test('lost response retains retry metadata and repeats same identity without duplicate remote patient', async () => {
  const h = harness({ lost: true });
  assert.equal((await (await h.request()).json()).status, 'RETRY');
  assert.equal((await (await h.request()).json()).status, 'VERIFIED');
  const writes = h.state.calls.filter(call => /\/(Patient|Patient\/remote-a)$/.test(call.url) && ['POST','PUT'].includes(call.init.method));
  assert.equal(writes[0].init.method,'POST'); assert.equal(writes[1].init.method,'PUT');
  assert.match(writes[1].init.headers['If-Match'],/^W\/"version-/);
  assert.equal(h.state.row.metadata.attempts, 2); assert.ok(!JSON.stringify(h.state.row).includes('PRIVATE'));
});
test('patient edit in flight or after verified export never claims current sync', async () => {
  const h = harness({ changeInFlight: true }); assert.equal((await (await h.request()).json()).status, 'SOURCE_CHANGED');
  const current = harness(); await current.request(); current.state.patient.email = 'changed@example.test';
  assert.equal((await (await current.request('GET')).json()).status, 'SOURCE_CHANGED');
});
test('credential replacement during flight cannot verify current binding', async () => {
  const h = harness({ changeConnection: true }); assert.equal((await (await h.request()).json()).status, 'SOURCE_CHANGED');
});

test('a configuration change with the same timestamp is fenced before provider access', async () => {
  for (const metadata of [{configurationVersion:'version-B',verifiedVersion:'version-B',providerIdentity:'Project/project-a'},
    {configurationVersion:'version-A',verifiedVersion:'old',providerIdentity:'Project/project-a'},
    {configurationVersion:'version-A',verifiedVersion:'version-A',providerIdentity:'Project/other'}]) {
    const h = harness({reservationConnection:{metadata}});
    assert.equal((await h.request()).status,409); assert.equal(h.state.calls.length,0);
  }
});

test('late export cannot overwrite newer remote demographics after concurrent source updates', async () => {
  let remote = {resourceType:'Patient',id:'remote-a',meta:{versionId:'v1'},identifier:[{system:'urn:qa',value:'patient'}],name:[{text:'initial'}]};
  let readers=0, bothRead, newerDone;
  const aligned = new Promise(resolve=>{bothRead=resolve}), committed = new Promise(resolve=>{newerDone=resolve});
  const api = load('src/integrations/medplum/client.ts',{'@/integrations/optional-http':{optionalProviderFetch:async(url,init)=>{
    if(url.endsWith('/oauth2/token'))return Response.json({token_type:'Bearer',access_token:'synthetic'});
    if(url.endsWith('/auth/me'))return Response.json({project:{resourceType:'Project',id:'project-a'},profile:{resourceType:'ClientApplication',id:'client-a'}});
    if(url.includes('/Patient?')){const snapshot=copy(remote);if(++readers===2)bothRead();await aligned;return Response.json({resourceType:'Bundle',entry:[{resource:snapshot}],total:1});}
    if(init.method==='PUT'){
      const body=JSON.parse(init.body);if(body.name[0].text==='older')await committed;
      if(init.headers['If-Match']!==`W/"${remote.meta.versionId}"`)return Response.json({}, {status:412});
      remote={...body,meta:{versionId:'v2'}};newerDone();return Response.json(remote);
    }
    return Response.json(remote);
  }}});
  const identity={system:'urn:qa',value:'patient'};
  const results=await Promise.allSettled(['older','newer'].map(text=>api.upsertMedplumPatient(secrets,
    {resourceType:'Patient',identifier:[identity],name:[{text}]},identity)));
  assert.equal(results[0].status,'rejected');assert.match(results[0].reason.message,/medplum-identity-conflict/);
  assert.equal(results[1].status,'fulfilled');assert.equal(remote.name[0].text,'newer');
});
test('concurrent attempts reserve only one external write', async () => {
  const h = harness(); const responses = await Promise.all([h.request(), h.request()]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(h.state.calls.filter(c => /\/(Patient|Patient\/remote-a)$/.test(c.url) && ['POST','PUT'].includes(c.init.method)).length, 1);
});
test('project mismatch never sends patient data', async () => {
  const h = harness({ projectId: 'wrong-project' });
  assert.equal((await (await h.request()).json()).status, 'RETRY');
  assert.equal(h.state.calls.length, 2);
  await assert.rejects(() => h.adapter.verifyMedplumConnection(secrets), /medplum-project-mismatch/);
});
test('verification returns actual project identity with no token readback', async () => {
  const h = harness(); assert.deepEqual(copy(await h.adapter.verifyMedplumConnection(secrets)), { identity: 'Project/project-a' });
});
test('audit failure prevents external side effects', async () => {
  const h = harness({ auditFails: true }); assert.equal((await h.request()).status, 503); assert.equal(h.state.calls.length, 0);
});

test('expired pending attempts recover after process loss; active pending remains reserved', async () => {
  const h = harness(); await h.request();
  h.state.row.metadata.status = 'PENDING'; h.state.row.metadata.lastAttemptAt = new Date().toISOString();
  assert.equal((await h.request()).status, 409);
  h.state.row.metadata.lastAttemptAt = '2020-01-01T00:00:00Z';
  assert.equal((await (await h.request()).json()).status, 'VERIFIED');
  assert.equal(h.state.row.metadata.attempts, 2);
});
for (const scenario of ['rejection', 'invalid-token', 'malformed', 'readback-mismatch']) {
  test(`provider ${scenario} fails closed with safe retry status`, async () => {
    const h = harness({ fetch: async (url, init, state) => {
      if (scenario === 'rejection') return Response.json({ secret: 'PRIVATE' }, { status: 401 });
      if (url.endsWith('/oauth2/token')) return Response.json({ token_type: 'Bearer', access_token: scenario === 'invalid-token' ? '' : 'synthetic' });
      if (url.endsWith('/auth/me')) return Response.json({ project: { resourceType: 'Project', id: 'project-a' }, profile: { resourceType: 'ClientApplication', id: 'client-a' } });
      if (scenario === 'malformed') return new Response('PRIVATE');
      if (url.includes('/Patient?')) return Response.json({resourceType:'Bundle',entry:[]});
      if (init.method === 'PUT' || init.method === 'POST') { state.remote = { ...JSON.parse(init.body), id: 'remote-a' }; return Response.json(state.remote); }
      return Response.json({ ...state.remote, name: [{ text: 'different' }] });
    } });
    const response = await h.request(); const body = await response.json();
    assert.equal(body.status, 'RETRY'); assert.equal(body.lastVerifiedAt, null);
    assert.ok(!JSON.stringify([body, h.state.row, h.state.audits]).includes('PRIVATE'));
  });
}

test('real adapter loopback contract: OAuth Basic, project identity, conditional writes, lost response, conflicts and timeout', async () => {
  const patients = new Map(); let mode = ''; let tokenHeader;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/oauth2/token') {
      tokenHeader = req.headers.authorization;
      assert.equal(new URLSearchParams(body).get('grant_type'), 'client_credentials');
      if (mode === 'timeout') return;
      if (mode === 'auth') { res.writeHead(401).end('{}'); return; }
      res.end(JSON.stringify({ access_token: 'loopback-token', token_type: 'Bearer' })); return;
    }
    assert.equal(req.headers.authorization, 'Bearer loopback-token');
    if (req.url === '/auth/me') { res.end(JSON.stringify({ project: { resourceType: 'Project', id: 'project-a' }, profile: { resourceType: 'ClientApplication', id: 'client-a' } })); return; }
    if (req.url.startsWith('/fhir/R4/Patient?')) {
      assert.equal(new URL(req.url,'http://localhost').searchParams.get('identifier'),'urn:synthetic|patient-a');
      res.end(JSON.stringify({resourceType:'Bundle',entry:[...patients.values()].map(resource=>({resource})),total:patients.size})); return;
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      if (req.method === 'POST') assert.equal(new URLSearchParams(req.headers['if-none-exist']).get('identifier'),'urn:synthetic|patient-a');
      else assert.equal(req.headers['if-match'],'W/"v1"');
      if (mode === 'conflict') { res.writeHead(412).end('{}'); return; }
      const patient = { ...JSON.parse(body), id: 'remote-a',meta:{versionId:'v1'} }; patients.set('urn:synthetic|patient-a', patient);
      if (mode === 'lost') { req.socket.destroy(); return; }
      res.end(JSON.stringify(patient)); return;
    }
    res.end(JSON.stringify(patients.get('urn:synthetic|patient-a')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const adapter = load('src/integrations/medplum/client.ts', { '@/integrations/optional-http': {
    optionalProviderFetch: (url, init) => { assert.equal(new URL(url).origin, baseUrl); return fetch(url, { ...init, signal: AbortSignal.timeout(100) }); },
  } });
  const credentials = { ...secrets, baseUrl };
  const identity = { system: 'urn:synthetic', value: 'patient-a' };
  const patient = { resourceType: 'Patient', identifier: [identity], name: [{ text: 'Synthetic Patient' }], telecom: [] };
  try {
    assert.equal((await adapter.verifyMedplumConnection(credentials)).identity, 'Project/project-a');
    assert.equal(tokenHeader, `Basic ${Buffer.from('client-a:synthetic-secret').toString('base64')}`);
    mode = 'lost'; await assert.rejects(() => adapter.upsertMedplumPatient(credentials, patient, identity));
    mode = ''; await adapter.upsertMedplumPatient(credentials, patient, identity); assert.equal(patients.size, 1);
    for (const value of ['conflict', 'auth', 'timeout']) {
      mode = value; await assert.rejects(() => adapter.upsertMedplumPatient(credentials, patient, identity), /medplum-/);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
