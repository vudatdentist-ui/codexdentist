const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');

function fixture(options = {}) {
  const uid = '1.2.826.0.1.999.1', series = '1.2.826.0.1.999.2', instance = '1.2.826.0.1.999.3';
  const env = { NODE_ENV: 'test', OPTIONAL_OHIF_BASE_URL: 'https://ohif.test', OPTIONAL_PROVIDER_ALLOWED_ORIGINS: 'https://pacs.test,https://ohif.test',
    ORTHANC_DEFAULT_ORGANIZATION_ID: 'org-a', ORTHANC_DEFAULT_BASE_URL: 'https://pacs.test',
    ORTHANC_DEFAULT_USERNAME: 'synthetic-user', ORTHANC_DEFAULT_PASSWORD: 'synthetic-password',
    ORTHANC_DEFAULT_VIEWER_ACCESS_MODE: 'private' };
  const connection = { id: 'connection-a', organizationId: 'org-a', clinicId: 'clinic-a', provider: 'orthanc',
    status: 'ACTIVE', secretRef: 'vault:v1', lastVerifiedAt: new Date(),
    metadata: { configurationVersion: 'synthetic-version', verifiedVersion: 'synthetic-version', providerIdentity: 'SYNTHETIC' } };
  const study = { id: 'study-a', organizationId: 'org-a', clinicId: 'clinic-a', patientId: 'patient-a',
    connectionId: connection.id, provider: 'orthanc', externalStudyId: 'orthanc-a',
    externalPatientId: 'pacs-patient-a', studyInstanceUid: uid, availability: 'AVAILABLE' };
  const studies = [study, { ...study, id: 'study-b', organizationId: 'org-b', clinicId: 'clinic-b', patientId: 'patient-b', connectionId: 'connection-b', studyInstanceUid: '1.2.826.0.1.999.4' },
    { ...study, id: 'study-a2', clinicId: 'clinic-a2', patientId: 'patient-a2', studyInstanceUid: '1.2.826.0.1.999.5' }];
  let session = actor('a');
  const providerCalls = [], loaded = [], databaseReads = [];
  const secrets = { baseUrl: 'https://pacs.test', username: 'synthetic-user', password: 'synthetic-password',
    viewerBaseUrl: 'https://attacker.test/tenant-url-is-never-used' };
  const remote = { ID: study.externalStudyId, ParentPatient: study.externalPatientId, MainDicomTags: { StudyInstanceUID: uid } };
  const metadata = [{ '0020000D': { vr: 'UI', Value: [uid] }, '0020000E': { vr: 'UI', Value: [series] },
    '00080018': { vr: 'UI', Value: [instance] }, '7FE00010': { vr: 'OW', BulkDataURI: `https://pacs.test/dicom-web/studies/${uid}/series/${series}/instances/${instance}/bulk/7FE00010` } }];
  const state = { verified: true, loadedConnection: connection, remote, metadata, providerStatus: 200,
    html: '<!doctype html><html><head><script src="/imaging/ohif/app-config.js"></script></head><body><div id="root"></div><script src="/imaging/ohif/app.bundle.js"></script></body></html>',
    script: 'console.log("synthetic static asset");', binaryType: 'multipart/related; type="application/octet-stream"; boundary=synthetic',
    binary: Buffer.from('--synthetic\r\nContent-Type: application/octet-stream\r\n\r\nSYNTHETIC-PIXELS\r\n--synthetic--\r\n') };
  const network = async (url, init = {}) => {
    const parsed = new URL(url);
    providerCalls.push({ url: String(url), headers: new Headers(init.headers), init });
    assert.ok(['https://pacs.test', 'https://ohif.test', options.httpOrigin].includes(parsed.origin), 'no browser/tenant upstream URL');
    assert.equal(new Headers(init.headers).has('cookie'), false);
    if (options.network) return options.network(url, init, state);
    if (parsed.origin === 'https://ohif.test') {
      assert.equal(new Headers(init.headers).has('authorization'), false, 'PACS credentials never sent to static server');
      return new Response(parsed.pathname === '/index.html' ? state.html : state.script, {
        headers: { 'content-type': parsed.pathname === '/index.html' ? 'text/html' : 'application/javascript' } });
    }
    assert.equal(new Headers(init.headers).get('authorization'), `Basic ${Buffer.from(`${secrets.username}:${secrets.password}`).toString('base64')}`);
    if (parsed.pathname === '/studies/orthanc-a') return Response.json(state.remote);
    if (parsed.pathname === '/system') return Response.json({ Version: 'synthetic', DicomAet: 'SYNTHETIC', Name: 'Synthetic archive' });
    if (parsed.pathname === '/plugins/dicom-web') return Response.json({ ID: 'dicom-web' });
    if (state.providerStatus !== 200) return new Response('UPSTREAM-PHI-AND-SECRET', { status: state.providerStatus });
    if (/\/frames\/|\/bulk\//.test(parsed.pathname)) return new Response(state.binary, { headers: { 'content-type': state.binaryType,
      'set-cookie': 'provider=secret', 'location': 'https://private.test', 'access-control-allow-origin': '*' } });
    return Response.json(state.metadata, { headers: { 'content-type': 'application/dicom+json' } });
  };
  const optionalHttp = { optionalProviderFetch: async (url, init = {}, options = {}) => {
    assert.ok((options.maxBytes ?? 2097152) <= 64 * 1024 * 1024);
    return network(url, { ...init, cache: 'no-store', redirect: 'manual' });
  } };
  const db = { organization: { findUnique: async ({ where }) => where.id === 'org-a' ? { isDemo: session.isDemo } : null },
    clinic: { findFirst: async ({ where }) => where.id === 'clinic-a' && where.organizationId === 'org-a' ? { id: 'clinic-a' } : null },
    imagingStudy: {
    findFirst: async ({ where }) => { databaseReads.push(where); return studies.find(row => row.id === where.id && row.organizationId === where.organizationId && where.clinicId.in.includes(row.clinicId)) || null; },
    update: async ({ where, data }) => { const row = studies.find(s => s.id === where.id); Object.assign(row, data); return row; },
  }, $queryRawUnsafe: async (sql, ...params) => /"organizationId"\s*=\s*\$1/.test(sql)
    ? (params[0] === connection.organizationId && params[1] === 'orthanc' &&
      (!/"status"\s*=\s*'ACTIVE'/.test(sql) || connection.status === 'ACTIVE') ? [state.loadedConnection] : [])
    : params[0] === connection.id ? [connection] : [] };
  const mocks = { 'next/server': { NextResponse: Response }, '@/lib/auth': { getSession: async () => session }, '@/lib/prisma': { prisma: db },
    '@/integrations/optional-http': optionalHttp,
    '@/lib/application/integrations/optional-provider-settings': { loadOptionalProviderConnection: async (actor, provider, clinicId) => {
      loaded.push({ actor, provider, clinicId });
      assert.equal(actor.organizationId, connection.organizationId); assert.equal(provider, 'orthanc');
      assert.ok(actor.clinicIds.includes(clinicId));
      if (!state.verified) throw Object.assign(new Error(), { code: 'integration-connection-not-ready' });
      return { connection: state.loadedConnection, secrets };
    } },
  };
  if (options.realHelpers) {
    delete mocks['@/integrations/optional-http'];
    delete mocks['@/lib/application/integrations/optional-provider-settings'];
    mocks['@/infrastructure/integrations/credential-vault'] = { readIntegrationSecrets: async (_db, scope) => {
      assert.equal(scope.organizationId, 'org-a'); assert.equal(scope.connectionId, connection.id); assert.equal(scope.provider, 'orthanc');
      loaded.push(scope); return secrets;
    } };
  }
  const cache = new Map();
  const read = path => load(path, mocks, { process: { env }, Request, Response, Headers, Date, fetch: network }, cache);
  const dicomRoute = read('src/app/api/imaging/dicomweb/[studyId]/[[...path]]/route.ts');
  const ohifRoute = read('src/app/(app)/imaging/ohif/[[...path]]/route.ts');
  const viewerRoute = read('src/app/api/imaging/studies/[studyId]/viewer/route.ts');
  const req = url => new Request(`https://app.test${url}`, { headers: { cookie: 'codexdentist_session=synthetic', authorization: 'Bearer browser-token', 'x-forwarded-host': 'attacker.test' } });
  function actor(suffix) { return { userId: `user-${suffix}`, organizationId: `org-${suffix}`, role: 'OWNER', roles: ['OWNER'], clinicIds: [`clinic-${suffix}`], activeClinicId: null, isDemo: false }; }
  return { uid, series, instance, env, study, studies, connection, secrets, state, loaded, providerCalls, databaseReads, read, network,
    get session() { return session; }, set session(value) { session = value; }, actor,
    get providerDicomCalls() { return providerCalls.filter(call => new URL(call.url).pathname.startsWith('/dicom-web/')); },
    dicom: (path = `studies/${uid}/metadata`, query = '', id = study.id) => dicomRoute.GET(req(`/api/imaging/dicomweb/${id}/${path}${query}`), { params: Promise.resolve({ studyId: id, path: path.split('/') }) }),
    ohif: (path = 'viewer', query = `?studyId=${study.id}&StudyInstanceUIDs=${uid}`) => ohifRoute.GET(req(`/imaging/ohif/${path}${query}`), { params: Promise.resolve({ path: path.split('/') }) }),
    viewer: () => viewerRoute.GET(req(`/api/imaging/studies/${study.id}/viewer`), { params: Promise.resolve({ studyId: study.id }) }),
  };
}
module.exports = { fixture };
