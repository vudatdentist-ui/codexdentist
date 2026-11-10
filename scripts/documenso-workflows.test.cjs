const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');

test('new signing envelopes explicitly use Vietnamese calendar presentation and timezone', async () => {
  let payload;
  const client=load('src/integrations/documenso/client.ts',{}, {Response,FormData,Blob,fetch:async(url,init)=>{
    if(url.endsWith('/envelope/create')){payload=JSON.parse(init.body.get('payload'));return Response.json({id:'synthetic-envelope'});}
    return Response.json({id:'synthetic-envelope',recipients:[{signingUrl:'https://sign.example.test/sign/synthetic'}]});
  }});
  await client.createDocumensoSigningEnvelope({baseUrl:'https://sign.example.test/api/v2',apiToken:'synthetic',webhookSecret:'synthetic'},
    {externalId:'synthetic',title:'Synthetic PDF',pdfBytes:Buffer.from('%PDF-1.4\nSynthetic only'),fileName:'synthetic.pdf',recipientEmail:'synthetic@example.test',recipientName:'Synthetic signer'});
  assert.equal(payload.meta.timezone,'Asia/Ho_Chi_Minh');assert.equal(payload.meta.dateFormat,'dd/MM/yyyy HH:mm');
});

test('signed PDF import rejects a foreign completed envelope before downloading any file', async () => {
  let requests=0;
  const client=load('src/integrations/documenso/client.ts',{}, {Response,fetch:async()=>{
    requests++;return Response.json({id:'foreign-envelope',status:'COMPLETED',envelopeItems:[{id:'foreign-file'}]});
  }});
  await assert.rejects(client.downloadDocumensoSignedPdf({baseUrl:'https://sign.example.test/api/v2',apiToken:'synthetic',webhookSecret:'synthetic'},'expected-envelope'),error=>error.code==='documenso-envelope-id-mismatch');
  assert.equal(requests,1);
});

test('provider JSON has a streaming size limit and provider error details never enter thrown messages', async () => {
  let cancelled=false,pulls=0;
  const client=load('src/integrations/documenso/client.ts',{}, {Response,fetch:async()=>new Response(new ReadableStream({
    pull(controller){pulls++;controller.enqueue(new Uint8Array(16*1024));},cancel(){cancelled=true;},
  }))});
  const secrets={baseUrl:'https://sign.example.test/api/v2',apiToken:'synthetic',webhookSecret:'synthetic'};
  await assert.rejects(client.downloadDocumensoSignedPdf(secrets,'expected'),error=>error.code==='documenso-response-too-large');
  assert.equal(cancelled,true);assert.ok(pulls<10);
  const rejected=load('src/integrations/documenso/client.ts',{}, {Response,fetch:async()=>Response.json({message:'Synthetic private body must stay upstream'},{status:403})});
  await assert.rejects(rejected.downloadDocumensoSignedPdf(secrets,'expected'),error=>error.code==='documenso-envelope-fetch-failed'&&!error.message.includes('private body'));
});

test('an actual HTTP redirect cannot forward a source PDF to another destination', async () => {
  const http=require('node:http');let forwarded=0;
  const destination=http.createServer((request,response)=>{forwarded++;response.end('{}');});
  const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  await listen(destination);
  const origin=http.createServer((request,response)=>{request.resume();response.writeHead(307,{location:`http://127.0.0.1:${destination.address().port}/unexpected`});response.end();});
  await listen(origin);
  try{
    const client=load('src/integrations/documenso/client.ts',{}, {fetch,Response,FormData,Blob});
    await assert.rejects(client.createDocumensoSigningEnvelope({baseUrl:`http://127.0.0.1:${origin.address().port}/api/v2`,apiToken:'synthetic',webhookSecret:'synthetic'},
      {externalId:'synthetic',title:'Synthetic PDF',pdfBytes:Buffer.from('%PDF-1.4\nSynthetic only'),fileName:'synthetic.pdf',recipientEmail:'synthetic@example.test',recipientName:'Synthetic signer'}));
    assert.equal(forwarded,0);
  }finally{
    await Promise.all([origin,destination].map(server=>new Promise(resolve=>server.close(resolve))));
  }
});

test('server-rendered signing trigger stays disabled until its client handlers are ready', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { DocumensoConsentSigning } = load('src/workspaces/integrations/DocumensoConsentSigning.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/shared/ui/WorkspaceDialog/WorkspaceDialog': { WorkspaceDialog: () => null },
    './PayOSWorkspace.module.css': { secondary: 'secondary' },
  });
  const html = renderToStaticMarkup(React.createElement(DocumensoConsentSigning, { patientFormId: 'synthetic-form', language: 'vi' }));
  assert.match(html, /<button[^>]*disabled=""/);
  assert.match(html, /Ký qua Documenso/);
});

// Actual transports, commands, vault crypto and provider client run against
// deterministic SQL/HTTP boundaries; no app, provider or operational data is used.
function fixture({ configured = true, role = 'OWNER', demo = false } = {}) {
  const session = { organizationId: 'org', userId: 'owner', role, roles: [role], isDemo: demo,
    clinicIds: ['clinic'], activeClinicId: 'clinic', clinics: [{ id: 'clinic', name: 'Synthetic' }] };
  const form = { id: 'form', formNo: 'FRM-1', organizationId: 'org', clinicId: 'clinic', patientId: 'patient',
    status: 'SENT', signatureUrl: null, expiresAt: null, attachments: [],
    template: { requiresSignature: true, name: 'Synthetic consent' },
    patient: { clinicId: 'clinic', fullName: 'Synthetic signer', email: 'synthetic@example.test' } };
  const files = [{ id: 'source', organizationId: 'org', clinicId: 'clinic', patientId: 'patient',
    mimeType: 'application/pdf', title: 'Synthetic PDF', fileName: 'consent.pdf', virusScanStatus: 'CLEAN',
    retentionUntil: null, storageProvider: 'local', sourceType: 'LOCAL_UPLOAD', storageKey: 'synthetic/source.pdf' }];
  let connection = configured ? { id: 'connection', organizationId: 'org', clinicId: 'clinic', provider: 'documenso',
    status: 'ACTIVE', secretRef: 'vault:v1', metadata: {}, lastVerifiedAt: null, createdAt: new Date(), updatedAt: new Date() } : null;
  let ciphertext = null, txDepth = 0, locked = false;
  const refs = [], audit = [], calls = [], locks = [];
  const counts = { writes: 0, sourceReads: 0 };
  const credentials = { apiToken: 'synthetic-api-token', webhookSecret: 'synthetic-webhook-secret' };
  let providerFailure = null, beforeLock = () => {};
  const copy = value => structuredClone(value);
  const scopedFile = where => files.find(file => file.id === (where.id ?? file.id) &&
    file.organizationId === where.organizationId && file.clinicId === where.clinicId && file.patientId === where.patientId &&
    file.mimeType === (where.mimeType ?? file.mimeType) && (!file.retentionUntil || file.retentionUntil > new Date()) &&
    (['local', 'r2'].includes(file.storageProvider) || ['LOCAL_UPLOAD', 'R2_UPLOAD'].includes(file.sourceType)));
  const formRead = async ({ where }) => where.id === form.id && where.organizationId === form.organizationId &&
    (where.clinicId?.in ? where.clinicId.in.includes(form.clinicId) : !where.clinicId || where.clinicId === form.clinicId)
    ? copy(form) : null;
  const db = {
    patientForm: { findFirst: formRead, update: async ({ data }) => { assert.ok(locked); counts.writes++; Object.assign(form, data); return copy(form); } },
    patientFile: { findFirst: async ({ where }) => { const file = scopedFile(where); return file ? copy(file) : null; },
      findMany: async ({ where }) => files.filter(file => scopedFile({ ...where, id: file.id })).map(copy) },
    auditLog: { create: async ({ data }) => { counts.writes++; audit.push(copy(data)); return {}; } },
    $transaction: async operation => {
      txDepth++; locked = false;
      try { return await operation(db); } finally { txDepth--; locked = false; }
    },
    $executeRaw: async (strings) => { assert.match(strings.join('?'), /FROM "PatientForm"[\s\S]*FOR UPDATE/); locked = true; locks.push('form'); return 1; },
    $queryRaw: async (strings, ...params) => { assert.ok(locked); assert.match(strings.join('?'), /DOCUMENSO_REQUEST/); return refs.filter(ref => ref.entityType === 'DOCUMENSO_REQUEST' && ref.internalId === params[1]).map(copy); },
    $executeRawUnsafe: async (sql) => {
      if (sql.startsWith('SELECT')) { if (sql.includes('"PatientForm"')) { locked = true; locks.push('form'); } return 1; }
      counts.writes++; throw new Error('Unexpected SQL mutation');
    },
    $queryRawUnsafe: async (sql, ...params) => {
      if (sql.includes('SELECT EXISTS')) {
        const terminal = [...sql.match(/NOT IN \(([^)]+)\)/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
        return [{ active: refs.some(ref => ref.organizationId === params[0] && ref.connectionId === params[1] &&
          ref.entityType === 'DOCUMENSO_REQUEST' && !terminal.includes(ref.metadata.status)) }];
      }
      if (sql.includes('SELECT s."ciphertext"')) {
        if (!connection || params[0] !== connection.id || params[1] !== connection.organizationId || params[2] !== connection.provider) return [];
        return [{ ciphertext, secretRef: connection.secretRef }];
      }
      if (sql.startsWith('WITH scoped AS')) {
        assert.ok(txDepth > 0); assert.equal(params[1], 'org'); assert.equal(params[2], 'documenso');
        ciphertext = params[3]; connection.secretRef = 'vault:v1'; counts.writes++; return [{ id: connection.id }];
      }
      if (sql.trimStart().startsWith('SELECT') && sql.includes('"IntegrationConnection"')) {
        if (sql.includes('FOR UPDATE')) { beforeLock(); locks.push('connection'); }
        return connection ? [copy(connection)] : [];
      }
      if (sql.includes('FROM "Clinic"')) return params[0] === 'clinic' && params[1] === 'org' ? [{ id: 'clinic' }] : [];
      if (sql.includes('FROM "PatientFile"')) { locks.push('source'); return [{ id: params[0] }]; }
      if (sql.includes('FROM "Patient"')) { locks.push('patient'); return form.patient.clinicId === params[2] ? [{ id: 'patient' }] : []; }
      if (sql.startsWith('UPDATE "IntegrationConnection"')) {
        counts.writes++; Object.assign(connection, { status: params[1], capabilities: JSON.parse(params[2]), secretRef: params[3],
          metadata: JSON.parse(params[4]), lastVerifiedAt: params[5] }); return [copy(connection)];
      }
      if (sql.startsWith('INSERT INTO "IntegrationConnection"')) {
        counts.writes++; connection = { id: params[0], organizationId: params[1], clinicId: params[2], provider: params[3],
          status: params[4], capabilities: JSON.parse(params[5]), secretRef: params[6], metadata: JSON.parse(params[7]),
          lastVerifiedAt: params[8], createdAt: new Date(), updatedAt: new Date() }; return [copy(connection)];
      }
      if (sql.trimStart().startsWith('SELECT') && sql.includes('"ExternalReference"')) {
        if (sql.includes('ORDER BY')) return refs.filter(ref => ref.organizationId === params[0] && ref.internalId === params[1] && ref.entityType === 'DOCUMENSO_REQUEST').map(copy);
        const storeLookup = sql.includes('"connectionId" = $2');
        return refs.filter(ref => ref.organizationId === params[0] && ref.connectionId === params[storeLookup ? 1 : 3] && ref.entityType === params[storeLookup ? 3 : 2] &&
          (sql.includes('"externalId" = $5') ? ref.externalId === params[4] : ref.internalId === params[4])).map(copy);
      }
      if (sql.startsWith('INSERT INTO "ExternalReference"')) {
        if (params[5] === 'DOCUMENSO_REQUEST') assert.ok(locked && locks.includes('connection'));
        counts.writes++; const ref = { id: params[0], organizationId: params[1], clinicId: params[2], connectionId: params[3],
          provider: params[4], entityType: params[5], internalId: params[6], externalId: params[7], metadata: JSON.parse(params[8]), updatedAt: new Date() };
        refs.push(ref); return [copy(ref)];
      }
      if (sql.includes('UPDATE "ExternalReference"')) {
        counts.writes++; const ref = refs.find(value => value.id === params[0]);
        if (ref.metadata.status !== 'SIGNED') ref.metadata = JSON.parse(params[1]);
        return [copy(ref)];
      }
      throw new Error('Unexpected SQL in Documenso fixture');
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    'next/cache': { revalidatePath: () => {} },
    'next/navigation': { redirect: path => { throw Object.assign(new Error(path), { digest: 'NEXT_REDIRECT' }); } },
    '@/lib/auth': { getSession: async () => session, requireViewSession: async () => session },
    '@/lib/env': { appBaseUrl: () => 'https://app.test', authSecret: () => 'synthetic-credential-master-20261105' },
    '@/lib/prisma': { prisma: db },
    '@/lib/forms': { canMutateForms: actor => actor.role !== 'PATIENT' },
    '@/lib/actions/permissions': { canPerformAction: actor => ['OWNER', 'CLINIC_MANAGER'].includes(actor.role) },
    '@/lib/permissions': { hasAnyRole: (actor, roles) => roles.includes(actor.role) },
    '@/lib/tenant-scope': { accessibleClinicIds: actor => actor.clinicIds },
    '@/lib/patient-access': { allowedClinicIds: actor => actor.clinicIds },
    '@/lib/request-security': { hasSameOrigin: () => true },
    '@/lib/error-reporting': { reportApplicationError: () => {} },
    '@/lib/patient-file-storage': { readStoredPatientFile: async () => { assert.equal(txDepth, 0); counts.sourceReads++; return Buffer.from('%PDF-1.4\nsynthetic'); } },
  };
  const globals = { Request, Response, FormData, Blob, File, Object, JSON, process: { env: { NODE_ENV: 'test' } },
    fetch: async (url, init) => {
      assert.equal(txDepth, 0, 'Provider HTTP must occur after commit'); assert.ok(init.signal instanceof AbortSignal);
      calls.push({ url, method: init.method ?? 'GET' });
      if (providerFailure) return providerFailure(url);
      if (url.endsWith('/create')) return Response.json({ id: 'envelope' });
      if (url.endsWith('/distribute')) return Response.json({ recipients: [{ signingUrl: 'https://sign.example.test/ceremony' }] });
      return Response.json({ id: 'envelope', status: 'PENDING', recipients: [{ signingUrl: 'https://sign.example.test/ceremony' }] });
    } };
  const cache = new Map(), module = file => load(file, mocks, globals, cache);
  const vault = module('src/infrastructure/integrations/credential-vault.ts');
  // The source loader gives each module a different VM realm. Normalize only
  // that artificial cross-realm dictionary boundary; keep real sealing/storage.
  mocks['@/infrastructure/integrations/credential-vault'] = {
    writeIntegrationSecrets: (db, scope, values) => vault.writeIntegrationSecrets(db, scope, JSON.parse(JSON.stringify(values))),
    readIntegrationSecrets: vault.readIntegrationSecrets,
  };
  if (configured) ciphertext = vault.sealIntegrationSecrets({ organizationId: 'org', connectionId: connection.id, provider: 'documenso' }, credentials);
  const route = module('src/app/api/integrations/documenso/signing-requests/route.ts');
  const settings = module('src/lib/application/integrations/documenso-settings.ts');
  const request = body => new Request('https://app.test/api/integrations/documenso/signing-requests', { method: 'POST', body: JSON.stringify(body) });
  return { session, form, files, refs, calls, counts, audit, locks, module, settings, credentials,
    connection: () => connection, ciphertext: () => ciphertext,
    failProvider: fn => { providerFailure = fn; }, beforeLock: fn => { beforeLock = fn; },
    get: () => route.GET(new Request('https://app.test/api/integrations/documenso/signing-requests?patientFormId=form')),
    post: body => route.POST(request({ patientFormId: 'form', sourcePatientFileId: 'source', idempotencyKey: 'same-ceremony-key', ...body })),
    save: (body = {}) => settings.saveDocumensoSettings(session, { action: 'save', clinicId: 'clinic', credentials, ...body }),
  };
}

test('settings writes sealed scoped credentials, resets observation, and never returns secret values', async () => {
  const h = fixture({ configured: false }); const workspace = await h.save();
  assert.equal(workspace.connections[0].configured, true); assert.equal(workspace.connections[0].verifiedAt, null);
  assert.equal(h.connection().secretRef, 'vault:v1');
  for (const secret of Object.values(h.credentials)) {
    assert.ok(!h.ciphertext().includes(secret)); assert.ok(!JSON.stringify(workspace).includes(secret)); assert.ok(!JSON.stringify(h.audit).includes(secret));
  }
  assert.match(h.ciphertext(), /^v1\./); assert.equal(h.calls.length, 0);
});

test('settings denies demo, patient and inaccessible or organization scope before writes', async () => {
  for (const options of [{ demo: true }, { role: 'PATIENT' }, { role: 'CLINIC_MANAGER' }]) {
    const h = fixture(options); await assert.rejects(h.save(options.role === 'CLINIC_MANAGER' ? { clinicId: null } : {}), { status: 403 }); assert.equal(h.counts.writes, 0);
  }
  const h = fixture(); await assert.rejects(h.save({ clinicId: 'other' }), { code: 'integration-clinic-forbidden' }); assert.equal(h.counts.writes, 0);
});

test('attach preserves other attachments, returns eligible sources, then send/reload/replay owns one ceremony', async () => {
  const h = fixture(); h.form.attachments = ['https://example.test/retained-reference'];
  assert.equal((await h.post({ action: 'attach-source' })).status, 200);
  assert.deepEqual(Array.from(h.form.attachments), ['https://example.test/retained-reference', '/patient-files/source']);
  const before = await (await h.get()).json(); assert.equal(before.canRequest, true); assert.equal(before.sourcePatientFileId, 'source');
  assert.deepEqual(before.sources, [{ id: 'source', name: 'consent.pdf' }]);
  const sent = await h.post(); assert.equal(sent.status, 200); assert.equal((await sent.json()).duplicate, false);
  assert.ok(h.locks.indexOf('connection') < h.locks.lastIndexOf('form'));
  const get = await (await h.get()).json(); assert.equal(get.request.idempotencyKey, 'same-ceremony-key'); assert.equal(get.request.status, 'PENDING');
  assert.equal((await (await h.post()).json()).duplicate, true); assert.equal(h.calls.filter(call => call.url.endsWith('/create')).length, 1);
  assert.equal(h.calls.filter(call => call.url.endsWith('/distribute')).length, 1);
  for (const action of ['save', 'disable']) await assert.rejects(h.save({ action }), { code: 'documenso-ceremonies-unresolved' });
  assert.equal((await h.post({ action: 'attach-source' })).status, 409);
});

test('manual complete and void take the form lock and reject an active signing ceremony', async () => {
  for (const action of ['completePatientFormAction', 'voidPatientFormAction']) {
    const h = fixture(); h.form.attachments = ['/patient-files/source']; await h.post();
    const writes = h.counts.writes;
    const data = new FormData(); data.set('patientFormId', 'form'); data.set('responses', 'Synthetic response');
    data.set('signatureUrl', '/patient-files/source'); data.set('voidReason', 'Synthetic reason');
    const actions = h.module('src/app/(app)/forms/actions.ts');
    await assert.rejects(actions[action](data), { message: '/forms?notice=forms-signing-active' });
    assert.equal(h.form.status, 'SENT'); assert.equal(h.counts.writes, writes);
  }
});

test('demo signing and source attachment deny before any request or write', async () => {
  const h = fixture({ demo: true });
  for (const action of ['send', 'attach-source']) assert.equal((await h.post({ action })).status, 403);
  assert.equal(h.counts.writes, 0); assert.equal(h.calls.length, 0); assert.equal((await (await h.get()).json()).canRequest, false);
});

test('cross-tenant, inaccessible clinic, quarantined and moved sources cannot send', async () => {
  for (const mutate of [h => { h.session.organizationId = 'other'; }, h => { h.session.clinicIds = ['other']; },
    h => { h.files[0].virusScanStatus = 'QUARANTINED'; }, h => { h.files[0].clinicId = 'other'; }]) {
    const h = fixture(); h.form.attachments = ['/patient-files/source']; mutate(h);
    assert.ok((await h.post()).status >= 400); assert.equal(h.calls.length, 0); assert.equal(h.counts.writes, 0);
  }
});

test('source governance and patient clinic are rechecked after the connection lock before reservation', async () => {
  for (const mutate of [h => { h.files[0].virusScanStatus = 'QUARANTINED'; }, h => { h.form.patient.clinicId = 'other'; }]) {
    const h = fixture(); h.form.attachments = ['/patient-files/source']; h.beforeLock(() => mutate(h));
    assert.equal((await h.post()).status, 409); assert.equal(h.calls.length, 0); assert.equal(h.refs.length, 0);
  }
});

test('ambiguous creation response remains unresolved and cannot create a second envelope or replace credentials', async () => {
  const h = fixture(); h.form.attachments = ['/patient-files/source'];
  h.failProvider(async () => { throw new DOMException('Synthetic lost creation response', 'TimeoutError'); });
  assert.equal((await h.post()).status, 502); assert.equal(h.refs[0].metadata.creationUncertain, true);
  assert.equal((await h.post()).status, 409); assert.equal(h.calls.length, 1);
  await assert.rejects(h.save(), { code: 'documenso-ceremonies-unresolved' });
});

test('definitive first create rejection permits key repair without exposing provider text', async () => {
  const h = fixture(); h.form.attachments = ['/patient-files/source'];
  h.failProvider(async () => Response.json({ message: 'NEVER-SHOW synthetic private diagnostic' }, { status: 401 }));
  const response = await h.post(); assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('NEVER-SHOW'));
  assert.equal(h.refs[0].metadata.status, 'FAILED'); await h.save(); assert.equal(h.connection().secretRef, 'vault:v1');
});

test('definitive FAILED permits manual completion/void but keeps the reserved source immutable', async () => {
  for (const action of ['completePatientFormAction', 'voidPatientFormAction']) {
    const h = fixture(); h.form.attachments = ['/patient-files/source'];
    h.failProvider(async () => Response.json({ message: 'Synthetic rejection' }, { status: 401 }));
    await h.post(); assert.equal(h.refs[0].metadata.status, 'FAILED');
    assert.equal((await h.post({ action: 'attach-source' })).status, 409);
    const data = new FormData(); data.set('patientFormId', 'form'); data.set('responses', 'Synthetic manual completion');
    data.set('signatureUrl', '/patient-files/source'); data.set('voidReason', 'Synthetic abandoned request');
    const expected = action === 'completePatientFormAction' ? 'COMPLETED' : 'VOID';
    await assert.rejects(h.module('src/app/(app)/forms/actions.ts')[action](data),
      { message: `/forms?notice=${expected === 'VOID' ? 'forms-voided' : 'forms-completed'}` });
    assert.equal(h.form.status, expected); assert.equal(h.calls.length, 1);
  }
});

test('FAILED with an envelope or uncertainty still cannot authorize manual completion', async () => {
  for (const evidence of [{ envelopeId: 'known-envelope' }, { creationUncertain: true }]) {
    const h = fixture(); h.form.attachments = ['/patient-files/source']; await h.post();
    h.refs[0].metadata = { status: 'FAILED', ...evidence };
    const data = new FormData(); data.set('patientFormId', 'form'); data.set('voidReason', 'Synthetic');
    await assert.rejects(h.module('src/app/(app)/forms/actions.ts').voidPatientFormAction(data), { message: '/forms?notice=forms-signing-active' });
    assert.equal(h.form.status, 'SENT');
  }
});

test('GET filters unsafe signing URLs/errors and authorizes protected signed PDF links', async () => {
  const h = fixture(); h.form.attachments = ['/patient-files/source']; await h.post();
  h.refs[0].metadata.signingUrl = 'javascript:alert(1)'; h.refs[0].metadata.errorCode = 'NEVER-SHOW private provider text';
  let reply = await (await h.get()).json(); assert.equal(reply.request.signingUrl, null); assert.equal(reply.request.errorCode, 'documenso-request-needs-attention');
  assert.ok(!JSON.stringify(reply).includes('NEVER-SHOW'));
  h.form.status = 'COMPLETED'; h.form.signatureUrl = '/patient-files/source'; h.refs[0].metadata.status = 'SIGNED';
  h.refs[0].metadata.patientFileId = 'source'; h.files[0].category = 'SIGNED_CONSENT';
  const envelope = h.refs.find(ref => ref.entityType === 'DOCUMENSO_ENVELOPE');
  envelope.metadata = { ...envelope.metadata, status: 'SIGNED', patientFileId: 'source', completedEventId: 'signed-event' };
  reply = await (await h.get()).json(); assert.equal(reply.signedFileUrl, '/patient-files/source');
  h.files[0].virusScanStatus = 'INFECTED'; reply = await (await h.get()).json(); assert.equal(reply.signedFileUrl, null);
});

test('changed recipient after failed distribution blocks resume before any provider I/O; restoring identity resumes one draft', async () => {
  for (const field of ['email', 'fullName']) {
    const h = fixture(); h.form.attachments = ['/patient-files/source']; let distributions = 0;
    h.failProvider(async url => {
      if (url.endsWith('/create')) return Response.json({ id: 'envelope' });
      if (url.endsWith('/distribute')) return ++distributions === 1
        ? Response.json({ message: 'Synthetic delivery failure' }, { status: 503 })
        : Response.json({ recipients: [{ signingUrl: 'https://sign.example.test/ceremony' }] });
      return Response.json({ id: 'envelope', status: 'DRAFT', recipients: [{ email: 'synthetic@example.test', name: 'Synthetic signer' }] });
    });
    assert.equal((await h.post()).status, 502);
    const metadata = h.refs[0].metadata;
    assert.equal(metadata.recipientName, 'Synthetic signer'); assert.equal(metadata.recipientEmail, 'synthetic@example.test');
    const original = h.form.patient[field]; h.form.patient[field] = field === 'email' ? 'corrected@example.test' : 'Corrected signer';
    const snapshot = await (await h.get()).json(); assert.equal(snapshot.canRequest, false);
    assert.equal(snapshot.request.canRetry, false); assert.equal(snapshot.request.errorCode, 'documenso-recipient-changed');
    assert.equal(snapshot.recipient.email, 'synthetic@example.test');
    const calls = h.calls.length, writes = h.counts.writes;
    const denied = await h.post(); assert.equal(denied.status, 409); assert.equal((await denied.json()).error, 'documenso-recipient-changed');
    assert.equal(h.calls.length, calls); assert.equal(h.counts.writes, writes);
    h.form.patient[field] = original; assert.equal((await h.post()).status, 200);
    assert.equal(h.calls.filter(call => call.url.endsWith('/create')).length, 1);
    assert.equal(h.refs[0].metadata.recipientName, 'Synthetic signer'); assert.equal(h.refs[0].metadata.recipientEmail, 'synthetic@example.test');
    assert.ok(h.audit.every(entry => !JSON.stringify(entry).includes('synthetic@example.test')), 'Recipient identity belongs only in ceremony metadata, never audit');
  }
});

test('known legacy ceremony without recipient identity fails closed and suppresses its signing link', async () => {
  const h = fixture(); h.form.attachments = ['/patient-files/source']; await h.post();
  delete h.refs[0].metadata.recipientEmail; delete h.refs[0].metadata.recipientName;
  const dto = await (await h.get()).json(); assert.equal(dto.canRequest, false); assert.equal(dto.request.signingUrl, null);
  assert.equal(dto.request.errorCode, 'documenso-recipient-changed');
  const calls = h.calls.length;
  assert.equal((await h.post()).status, 409); assert.equal(h.calls.length, calls);
});

test('manual completion with an eligible source PDF never claims a reconciled signed document', async () => {
  const h = fixture(); h.form.attachments = ['/patient-files/source'];
  h.failProvider(async () => Response.json({}, { status: 401 })); await h.post();
  const data = new FormData(); data.set('patientFormId', 'form'); data.set('responses', 'Synthetic manually completed');
  data.set('signatureUrl', '/patient-files/source');
  await assert.rejects(h.module('src/app/(app)/forms/actions.ts').completePatientFormAction(data), { message: '/forms?notice=forms-completed' });
  const dto = await (await h.get()).json(); assert.equal(dto.status, 'COMPLETED');
  assert.equal(dto.request.status, 'FAILED'); assert.equal(dto.signedFileUrl, null); assert.equal(dto.request.signedFileUrl, null);
});

test('signed provenance rejects missing, wrong-category, mismatched or unrelated envelope/file evidence', async () => {
  const mutations = [
    h => { h.files[0].category = 'CONSENT'; },
    h => { h.refs[0].metadata.patientFileId = 'different-file'; },
    h => { h.refs[1].metadata.patientFileId = 'different-file'; },
    h => { h.refs[1].metadata.patientId = 'other-patient'; },
    h => { h.refs[1].internalId = 'other-form'; },
    h => { h.refs[1].clinicId = 'other-clinic'; },
    h => { h.refs[1].metadata.status = 'PENDING'; },
    h => { delete h.refs[1].metadata.completedEventId; },
    h => { h.refs.splice(1, 1); },
  ];
  for (const mutate of mutations) {
    const h = fixture(); h.form.attachments = ['/patient-files/source']; await h.post();
    h.form.status = 'COMPLETED'; h.form.signatureUrl = '/patient-files/source'; h.files[0].category = 'SIGNED_CONSENT';
    h.refs[0].metadata = { ...h.refs[0].metadata, status: 'SIGNED', patientFileId: 'source' };
    h.refs[1].metadata = { ...h.refs[1].metadata, status: 'SIGNED', patientFileId: 'source', completedEventId: 'signed-event' };
    mutate(h); const dto = await (await h.get()).json(); assert.equal(dto.signedFileUrl, null); assert.equal(dto.request.signedFileUrl, null);
  }
});

test('legacy Documenso configuration is rejected and environment fallback requires an organization binding', async () => {
  const h = fixture(); const route = h.module('src/app/api/integrations/connections/route.ts');
  const response = await route.POST(new Request('https://app.test/api/integrations/connections', { method: 'POST', body: JSON.stringify({ provider: 'documenso', secretRef: 'env:DOCUMENSO_DEFAULT' }) }));
  assert.equal(response.status, 409); assert.equal((await response.json()).error, 'documenso-use-settings'); assert.equal(h.counts.writes, 0);
  const api = h.module('src/app/api/integrations/documenso/connection-secrets.ts');
  await assert.rejects(api.documensoConnectionSecrets({ ...h.connection(), secretRef: 'env:DOCUMENSO_DEFAULT' }), { code: 'documenso-connection-not-configured' });
});

test('native PostgreSQL: reservation locks preserve sealed credentials, one send, source and manual-action guards',
  { skip: process.env.DOCUMENSO_WORKFLOWS_POSTGRES !== '1', timeout: 120000 }, async () => {
    const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
    assert.ok(process.env.NODE_ENV === 'test' && url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      ![...url.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service|user|password|connectionstring)$/i.test(key)), 'Explicit loopback test administrator required');
    const { randomBytes } = require('node:crypto');
    const { execFileSync } = require('node:child_process');
    const { Client } = require('pg');
    const { PrismaClient } = require('@prisma/client');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const name = 'documenso_operator_test_' + randomBytes(8).toString('hex');
    const target = new URL(url); target.pathname = '/' + name;
    const admin = new Client({ connectionString: url.toString() });
    let created = false, prisma, pending, releaseProvider;
    const providerGate = new Promise(resolve => { releaseProvider = resolve; });
    let entered;
    const providerEntered = new Promise(resolve => { entered = resolve; });
    try {
      await admin.connect(); assert.match(name, /^documenso_operator_test_[a-f0-9]{16}$/);
      await admin.query(`CREATE DATABASE "${name}"`); created = true;
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: target.toString() },
        stdio: 'pipe', timeout: 60000, windowsHide: true,
      });
      prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
      const org = await prisma.organization.create({ data: { name: 'Synthetic isolated Documenso' } });
      const clinic = await prisma.clinic.create({ data: { organizationId: org.id, name: 'Synthetic', city: 'QA', address: 'QA' } });
      const actor = await prisma.user.create({ data: { organizationId: org.id, fullName: 'Synthetic owner', email: 'documenso-native@example.test', passwordHash: 'synthetic-not-a-login', role: 'OWNER' } });
      const patient = await prisma.patient.create({ data: { organizationId: org.id, clinicId: clinic.id, fullName: 'Synthetic signer', email: 'synthetic@example.test', phone: '0000000000', medicalAlerts: [] } });
      const template = await prisma.formTemplate.create({ data: { organizationId: org.id, type: 'CONSENT', code: 'NATIVE', name: 'Synthetic consent', version: '1', schema: {}, requiresSignature: true } });
      const form = await prisma.patientForm.create({ data: { organizationId: org.id, clinicId: clinic.id, patientId: patient.id, templateId: template.id, formNo: 'NATIVE-FRM-1', status: 'SENT', attachments: [] } });
      const file = await prisma.patientFile.create({ data: { organizationId: org.id, clinicId: clinic.id, patientId: patient.id, title: 'Synthetic PDF', url: '/patient-files/synthetic', fileName: 'synthetic.pdf', mimeType: 'application/pdf', virusScanStatus: 'CLEAN', storageProvider: 'local', storageKey: 'synthetic.pdf', sourceType: 'LOCAL_UPLOAD' } });
      const session = { organizationId: org.id, userId: actor.id, role: 'OWNER', roles: ['OWNER'], isDemo: false,
        clinicIds: [clinic.id], activeClinicId: clinic.id, clinics: [{ id: clinic.id, name: clinic.name }] };
      let providerCalls = 0;
      const mocks = {
        'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
        'next/cache': { revalidatePath: () => {} },
        'next/navigation': { redirect: path => { throw Object.assign(new Error(path), { digest: 'NEXT_REDIRECT' }); } },
        '@/lib/prisma': { prisma }, '@/lib/auth': { getSession: async () => session, requireViewSession: async () => session },
        '@/lib/env': { appBaseUrl: () => 'https://app.test', authSecret: () => 'synthetic-native-master-20261105' },
        '@/lib/forms': { canMutateForms: () => true }, '@/lib/request-security': { hasSameOrigin: () => true },
        '@/lib/error-reporting': { reportApplicationError: () => {} },
        '@/lib/patient-file-storage': { readStoredPatientFile: async () => Buffer.from('%PDF-1.4\nsynthetic') },
      };
      const globals = { Object, JSON, Request, Response, FormData, Blob, File, process: { env: { NODE_ENV: 'test', DOCUMENSO_DEFAULT_BASE_URL: 'https://provider.test/api/v2' } },
        fetch: async (url, init) => {
          providerCalls++; assert.ok(init.signal instanceof AbortSignal);
          if (url.endsWith('/create')) {
            const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "ExternalReference" WHERE "organizationId"=$1 AND "entityType"='DOCUMENSO_REQUEST'`, org.id);
            assert.equal(rows.length, 1, 'Reservation is committed before provider I/O'); entered(); await providerGate;
            return Response.json({ id: 'native-envelope' });
          }
          return Response.json({ recipients: [{ signingUrl: 'https://sign.example.test/native' }] });
        } };
      const cache = new Map(), module = path => load(path, mocks, globals, cache);
      const vault = module('src/infrastructure/integrations/credential-vault.ts');
      mocks['@/infrastructure/integrations/credential-vault'] = {
        writeIntegrationSecrets: (db, scope, values) => vault.writeIntegrationSecrets(db, scope, JSON.parse(JSON.stringify(values))),
        readIntegrationSecrets: vault.readIntegrationSecrets,
      };
      const settings = module('src/lib/application/integrations/documenso-settings.ts');
      const credentials = { apiToken: 'synthetic-native-token', webhookSecret: 'synthetic-native-webhook-secret' };
      const workspace = await settings.saveDocumensoSettings(session, { action: 'save', clinicId: clinic.id, credentials });
      assert.equal(workspace.connections[0].verifiedAt, null);
      const stored = await prisma.$queryRawUnsafe(`SELECT ciphertext FROM "IntegrationCredential" WHERE "connectionId"=$1`, workspace.connections[0].id);
      for (const value of Object.values(credentials)) assert.ok(!JSON.stringify(stored).includes(value));
      const commands = module('src/lib/application/integrations/documenso-signing.ts');
      await commands.attachDocumensoSource(session, form.id, file.id);
      const route = module('src/app/api/integrations/documenso/signing-requests/route.ts');
      const post = () => route.POST(new Request('https://app.test/api/integrations/documenso/signing-requests', {
        method: 'POST', body: JSON.stringify({ patientFormId: form.id, sourcePatientFileId: file.id, idempotencyKey: 'native-same-ceremony' }),
      }));
      pending = post();
      await Promise.race([providerEntered, pending.then(async response => { throw new Error(`Reservation failed before provider: ${response.status} ${await response.text()}`); })]);
      for (const action of ['save', 'disable']) await assert.rejects(settings.saveDocumensoSettings(session, { action, clinicId: clinic.id, credentials }), { code: 'documenso-ceremonies-unresolved' });
      assert.equal((await post()).status, 409, 'Concurrent request cannot create another envelope');
      await assert.rejects(commands.attachDocumensoSource(session, form.id, file.id), { code: 'documenso-ceremony-active' });
      const manual = module('src/app/(app)/forms/actions.ts');
      for (const action of ['completePatientFormAction', 'voidPatientFormAction']) {
        const data = new FormData(); data.set('patientFormId', form.id); data.set('responses', 'Synthetic'); data.set('signatureUrl', `/patient-files/${file.id}`); data.set('voidReason', 'Synthetic');
        await assert.rejects(manual[action](data), { message: '/forms?notice=forms-signing-active' });
      }
      releaseProvider(); assert.equal((await pending).status, 200);
      assert.equal((await (await post()).json()).duplicate, true); assert.equal(providerCalls, 2, 'One create and one distribution only');
      assert.equal((await prisma.patientForm.findUniqueOrThrow({ where: { id: form.id } })).status, 'SENT');
      const snapshot = await commands.getDocumensoConsent(session, form.id); assert.equal(snapshot.request.status, 'PENDING');
      assert.equal(snapshot.request.idempotencyKey, 'native-same-ceremony');
    } finally {
      releaseProvider(); if (pending) await pending.catch(() => {});
      if (prisma) await prisma.$disconnect();
      if (created) { assert.match(name, /^documenso_operator_test_[a-f0-9]{16}$/); await admin.query(`DROP DATABASE "${name}"`); }
      await admin.end();
    }
  });
