const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./imaging-private-fixture.cjs');

test('viewer link stays same-origin and never includes credentials or the tenant viewer URL', async () => {
  const h = fixture(); const response = await h.viewer(); assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.viewerUrl, `/imaging/ohif/viewer?studyId=study-a&StudyInstanceUIDs=${h.uid}`);
  assert.ok(!JSON.stringify(result).includes(h.secrets.password));
  delete h.env.OPTIONAL_OHIF_BASE_URL; assert.equal((await h.viewer()).status, 503);
});

for (const surface of ['metadata', 'frame', 'static', 'viewer', 'config']) test(`unauthenticated ${surface} access denies before DB/provider access`, async () => {
  const h = fixture(); h.session = null;
  const response = surface === 'metadata' ? await h.dicom() : surface === 'frame' ? await h.dicom(`studies/${h.uid}/series/${h.series}/instances/${h.instance}/frames/1`)
    : surface === 'static' ? await h.ohif('app.bundle.js', '') : surface === 'config' ? await h.ohif('app-config.js') : await h.ohif();
  assert.equal(response.status, 401); assert.equal(h.providerCalls.length, 0); assert.equal(h.databaseReads.length, 0);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

for (const scenario of ['tenant', 'clinic', 'connection-org', 'connection-clinic', 'disabled', 'unverified', 'wrong-selected-connection', 'demo', 'role', 'remote-uid', 'remote-patient']) {
  test(`${scenario}: metadata, frames, config and shell remain denied`, async () => {
    const h = fixture();
    if (scenario === 'tenant') h.session = h.actor('b');
    if (scenario === 'clinic') h.session.clinicIds = ['clinic-a2'];
    if (scenario === 'connection-org') h.connection.organizationId = 'org-b';
    if (scenario === 'connection-clinic') h.connection.clinicId = 'clinic-a2';
    if (scenario === 'disabled') h.connection.status = 'DISABLED';
    if (scenario === 'unverified') h.state.verified = false;
    if (scenario === 'wrong-selected-connection') h.state.loadedConnection = { ...h.connection, id: 'replacement' };
    if (scenario === 'demo') h.session.isDemo = true;
    if (scenario === 'role') { h.session.role = 'PATIENT'; h.session.roles = ['PATIENT']; }
    if (scenario === 'remote-uid') h.state.remote.MainDicomTags.StudyInstanceUID = '1.2.999';
    if (scenario === 'remote-patient') h.state.remote.ParentPatient = 'foreign-pacs-patient';
    const responses = [await h.dicom(), await h.dicom(`studies/${h.uid}/series/${h.series}/instances/${h.instance}/frames/1`), await h.ohif(), await h.ohif('app-config.js')];
    for (const response of responses) assert.ok(response.status >= 400, `${scenario}: ${response.status}`);
    assert.equal(h.providerDicomCalls.length, 0);
    assert.equal(h.providerCalls.filter(c => new URL(c.url).origin === 'https://ohif.test').length, 0);
    if (!scenario.startsWith('remote-')) assert.equal(h.providerCalls.length, 0);
  });
}

test('every PHI read reauthorizes; revocation after successful metadata denies the next frame', async () => {
  const h = fixture(); assert.equal((await h.dicom()).status, 200); const count = h.providerCalls.length;
  h.session.clinicIds = ['clinic-a2']; assert.equal((await h.dicom(`studies/${h.uid}/series/${h.series}/instances/${h.instance}/frames/1`)).status, 404);
  assert.equal(h.providerCalls.length, count);
});

test('scoped QIDO and metadata use the vault transport and rewrite bulk URLs', async () => {
  const h = fixture();
  for (const [path, query] of [[`studies`, `?StudyInstanceUID=${h.uid}&includefield=all`], [`studies/${h.uid}/series`, '?includefield=00080060&includefield=0020000E&limit=100'],
    [`studies/${h.uid}/metadata`, ''], [`studies/${h.uid}/series/${h.series}/metadata`, ''], [`studies/${h.uid}/series/${h.series}/instances/${h.instance}/metadata`, '']]) {
    const response = await h.dicom(path, query); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/dicom+json');
    const text = await response.text(); assert.ok(text.includes(`/api/imaging/dicomweb/study-a/studies/${h.uid}`));
    assert.ok(!text.includes('pacs.test')); assert.match(response.headers.get('cache-control'), /no-store/);
  }
  assert.equal(h.loaded.length, 5); assert.equal(h.providerDicomCalls.length, 5);
  for (const call of h.providerDicomCalls) { assert.equal(call.init.redirect, 'manual'); assert.equal(call.headers.get('accept'), 'application/dicom+json'); }
});

for (const tail of ['', '?StudyInstanceUID=1.2.999', '?StudyInstanceUID=1.2.826.0.1.999.1&StudyInstanceUID=1.2.999', '?PatientName=*', '?url=https://evil.test', '?StudyInstanceUID=1.2.826.0.1.999.1&limit=999999']) {
  test(`unrestricted or tampered root QIDO ${tail} is denied`, async () => {
    const h = fixture(); assert.equal((await h.dicom('studies', tail)).status, 400); assert.equal(h.providerDicomCalls.length, 0);
  });
}

for (const path of ['patients', 'system', 'tools/find', 'studies/1.2.999/metadata', 'studies/1.2.826.0.1.999.1/../../system',
  'studies/1.2.826.0.1.999.1/series/%2Fsystem', 'studies/1.2.826.0.1.999.1/series/1.2.3/instances/1.2.4/frames/0',
  'studies/1.2.826.0.1.999.1/series/1.2.3/instances/1.2.4/frames/1%2C2', 'studies/1.2.826.0.1.999.1/rendered']) {
  test(`DICOMweb path denied: ${path}`, async () => { const h = fixture(); assert.equal((await h.dicom(path)).status, 400); assert.equal(h.providerDicomCalls.length, 0); });
}

for (const query of ['?url=http://evil.test', '?StudyInstanceUID=1.2.999', '?includefield=all', '?accept=application/json', '?requestType=WADO']) {
  test(`metadata query denied: ${query}`, async () => { const h = fixture(); assert.equal((await h.dicom(undefined, query)).status, 400); assert.equal(h.providerDicomCalls.length, 0); });
}

for (const uri of ['https://evil.test/x', '//evil.test/x', 'http://169.254.169.254/latest', 'data:application/json,secret',
  'https://pacs.test/system', 'https://pacs.test/dicom-web/studies/1.2.999/series/1.2.3/instances/1.2.4/bulk/7FE00010',
  'https://pacs.test/dicom-web/studies/1.2.826.0.1.999.1/series/1.2.3/instances/1.2.4/bulk/7FE00010?url=http://evil.test',
  'https://pacs.test/dicom-web/studies/../system', 'https://pacs.test/dicom-web/%73tudies/1.2.3']) {
  test(`foreign/unsafe BulkDataURI fails closed: ${uri}`, async () => {
    const h = fixture(); h.state.metadata[0]['7FE00010'].BulkDataURI = uri;
    const response = await h.dicom(); assert.equal(response.status, 503); assert.ok(!(await response.text()).includes(uri));
  });
}

test('nested sequence bulk locators are rewritten and mismatched metadata UID is denied', async () => {
  const h = fixture(); const bulk = h.state.metadata[0]['7FE00010']; h.state.metadata[0]['00480105'] = { vr: 'SQ', Value: [{ '00282000': { ...bulk, BulkDataURI: bulk.BulkDataURI.replace('/bulk/7FE00010', '/bulk/00480105/1/00282000') } }] };
  assert.equal((await h.dicom()).status, 200);
  h.state.metadata[0]['0020000D'].Value = ['1.2.999']; assert.equal((await h.dicom()).status, 503);
});

test('frame and bulk binary contract preserves synthetic payload; strips upstream headers', async () => {
  const h = fixture();
  for (const resource of ['frames/1,2', 'bulk/7FE00010', 'bulk/00480105/1/00282000']) {
    const response = await h.dicom(`studies/${h.uid}/series/${h.series}/instances/${h.instance}/${resource}`);
    assert.equal(response.status, 200); assert.equal(await response.text(), h.state.binary.toString());
    assert.equal(response.headers.get('content-type'), h.state.binaryType);
    for (const key of ['set-cookie', 'location', 'access-control-allow-origin']) assert.equal(response.headers.has(key), false);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  }
  h.state.binaryType = 'text/html'; assert.equal((await h.dicom(`studies/${h.uid}/series/${h.series}/instances/${h.instance}/frames/1`)).status, 503);
});

test('provider errors never relay error bodies, PHI or secrets', async () => {
  const h = fixture(); h.state.providerStatus = 500; const response = await h.dicom();
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('UPSTREAM-PHI'));
});

test('legacy env resolver retains exact organization binding on every proxy request', async () => {
  const h = fixture(); h.connection.secretRef = 'env:ORTHANC_DEFAULT';
  assert.equal((await h.dicom()).status, 200); assert.equal(h.loaded.length, 0);
  delete h.env.ORTHANC_DEFAULT_ORGANIZATION_ID; const before = h.providerCalls.length;
  assert.equal((await h.dicom()).status, 503); assert.equal(h.providerCalls.length, before);
});

test('OHIF shell/config use the scoped same-origin DICOMweb source and isolation headers', async () => {
  const h = fixture(); const shell = await h.ohif(); assert.equal(shell.status, 200);
  const html = await shell.text(); assert.match(html, /app-config\.js\?studyId=study-a&amp;StudyInstanceUIDs=/);
  assert.equal(shell.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.match(shell.headers.get('content-security-policy'), /wasm-unsafe-eval/);
  assert.ok(!shell.headers.get('content-security-policy').includes('https:'));
  const config = await h.ohif('app-config.js'); assert.equal(config.status, 200); const script = await config.text();
  const parsed = JSON.parse(script.slice('window.config = '.length, -1));
  assert.equal(parsed.routerBasename, '/imaging/ohif'); assert.equal(parsed.showStudyList, false);
  const source = parsed.dataSources[0].configuration;
  for (const key of ['wadoRoot', 'qidoRoot', 'wadoUriRoot']) assert.equal(source[key], '/api/imaging/dicomweb/study-a');
  assert.equal(source.dicomUploadEnabled, false); assert.ok(!script.includes(h.secrets.password)); assert.ok(!script.includes('pacs.test')); assert.ok(!script.includes('attacker.test'));
});

for (const path of ['api/studies.js', 'dicom-web/metadata.js', 'studies/1.2.3.json', 'config/default.js', 'system', 'index.html',
  'service-worker.js', 'sw.js', 'workbox-123.js', 'data.json', 'foo.js.map', '../system.js', '%2e%2e/app.js']) {
  test(`OHIF static path denied: ${path}`, async () => { const h = fixture(); assert.equal((await h.ohif(path, '')).status, 400); assert.equal(h.providerCalls.length, 0); });
}

for (const query of ['?url=https://evil.test', '?studyId=study-a&StudyInstanceUIDs=1.2.999', '?studyId=study-a&StudyInstanceUIDs=1.2.826.0.1.999.1&StudyInstanceUIDs=1.2.999', '?studyId=study-a&StudyInstanceUIDs=1.2.826.0.1.999.1&dataSources=dicomjson']) {
  test(`viewer query denied: ${query}`, async () => { const h = fixture(); assert.equal((await h.ohif('viewer', query)).status, 400); assert.equal(h.providerDicomCalls.length, 0); });
}

test('static assets are authenticated-global and never resolve or forward PACS credentials', async () => {
  const h = fixture(); h.session = h.actor('b');
  const response = await h.ohif('assets/decoder.wasm', ''); assert.equal(response.status, 200); assert.equal(h.loaded.length, 0); assert.equal(h.databaseReads.length, 0);
  assert.equal(h.providerCalls.length, 1); assert.equal(h.providerCalls[0].headers.has('authorization'), false);
});

test('wrong asset base, missing config and PWA/service-worker builds fail safely', async () => {
  const h = fixture();
  for (const html of ['<script src="/app-config.js"></script><script src="/app.js"></script>', '<div>No config script</div>', h.state.html + '<script>navigator.serviceWorker.register("sw.js")</script>']) {
    h.state.html = html; assert.equal((await h.ohif()).status, 503);
  }
  h.state.script = 'navigator.serviceWorker.register("sw.js")'; assert.equal((await h.ohif('app.bundle.js', '')).status, 503);
});

test('free OSS settings probe uses Orthanc system/plugin API and requires paired credentials', async () => {
  const h = fixture(); const adapter = h.read('src/integrations/orthanc/connection.ts');
  assert.match((await adapter.verifyOrthancConnection(h.secrets)).identity, /^orthanc:[0-9a-f]{64}$/);
  assert.deepEqual(h.providerCalls.map(c => new URL(c.url).pathname), ['/system', '/plugins/dicom-web']);
  await assert.rejects(adapter.verifyOrthancConnection({ baseUrl: 'https://pacs.test', username: 'no-password' }), error => error.code === 'orthanc-credentials-incomplete');
});

test('real shared helpers enforce matching verification version and root origin approval for imaging', async () => {
  const h = fixture({ realHelpers: true });
  assert.equal((await h.dicom()).status, 200); assert.equal(h.loaded.length, 1);
  h.connection.metadata.verifiedVersion = 'old-version'; const before = h.providerCalls.length;
  assert.equal((await h.dicom()).status, 503); assert.equal(h.providerCalls.length, before);
  h.connection.metadata.verifiedVersion = h.connection.metadata.configurationVersion;
  h.env.OPTIONAL_PROVIDER_ALLOWED_ORIGINS = 'https://ohif.test';
  assert.equal((await h.dicom()).status, 503); assert.equal(h.providerCalls.length, before);
});

test('official separate PWA initializer and manifest are removed from the viewer shell', async () => {
  const h = fixture(); h.state.html = h.state.html.replace('</head>', '<link rel="manifest" href="/imaging/ohif/manifest.json"><script type="module" src="/imaging/ohif/init-service-worker.js"></script></head>');
  const response = await h.ohif(); assert.equal(response.status, 200); const html = await response.text();
  assert.ok(!html.includes('init-service-worker')); assert.ok(!html.includes('manifest.json'));
});

test('dot Orthanc resource IDs and oversized/malformed DICOM UIDs reject before HTTP', async () => {
  const h = fixture(); const client = h.read('src/integrations/orthanc/client.ts');
  for (const id of ['.', '..', '../../system', 'x%2Fsystem']) await assert.rejects(client.fetchOrthancStudy({ baseUrl: 'https://pacs.test' }, id), error => error.code === 'orthanc-study-id-invalid');
  const { isDicomUid } = h.read('src/integrations/orthanc/dicomweb-policy.ts');
  for (const uid of ['1.02.3', '1..2', '1.2.', '1.2/3', '1.2,3', '1.'.repeat(40) + '1']) assert.equal(isDicomUid(uid), false);
  assert.equal(h.providerCalls.length, 0);
});

test('settings probe rejects a missing DICOMweb plugin and ignores version upgrades in archive identity', async () => {
  let version = '1.0', pluginAvailable = true;
  const h = fixture({ realHelpers: true, network: async (url) => {
    if (new URL(url).pathname === '/system') return Response.json({ Version: version, DicomAet: 'SYNTHETIC', Name: 'Stable synthetic archive' });
    return pluginAvailable ? Response.json({ ID: 'dicom-web' }) : new Response('not available', { status: 404 });
  } });
  const adapter = h.read('src/integrations/orthanc/connection.ts');
  const first = await adapter.verifyOrthancConnection(h.secrets); version = '2.0';
  assert.equal((await adapter.verifyOrthancConnection(h.secrets)).identity, first.identity);
  pluginAvailable = false; await assert.rejects(adapter.verifyOrthancConnection(h.secrets), error => error.code === 'orthanc-dicomweb-unavailable');
});

test('HEAD cannot retrieve DICOM or viewer bodies', async () => {
  const h = fixture();
  for (const path of ['src/app/api/imaging/dicomweb/[studyId]/[[...path]]/route.ts', 'src/app/(app)/imaging/ohif/[[...path]]/route.ts']) {
    const response = await h.read(path).HEAD(); assert.equal(response.status, 405); assert.equal(await response.text(), '');
  }
  assert.equal(h.providerCalls.length, 0);
});
