const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { fixture } = require('./imaging-private-fixture.cjs');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });

// Real route/command/provider code and shared HTTP transport over loopback sockets.
// Only authentication persistence, canonical DB and vault storage are fixture I/O.
// This is NOT the real Orthanc/OHIF viewer acceptance gate.
test('loopback API + synthetic PACS HTTP contract (two tenants, frames, config, static and revocation)', async () => {
  let h;
  const providerRequests = [];
  const provider = createServer(async (req, res) => {
    try {
      providerRequests.push(req.url);
      assert.equal(req.headers.cookie, undefined);
      assert.equal(req.headers['x-forwarded-host'], undefined);
      if (!req.url.startsWith('/static/')) assert.equal(req.headers.authorization, `Basic ${Buffer.from('synthetic-user:synthetic-password').toString('base64')}`);
      else assert.equal(req.headers.authorization, undefined);
      if (req.url === '/system') return json({ Version: 'synthetic', DicomAet: 'SYNTHETIC', Name: 'Synthetic archive' });
      if (req.url === '/plugins/dicom-web') return json({ ID: 'dicom-web' });
      if (req.url === '/studies/orthanc-a') return json(h.state.remote);
      if (req.url === '/static/index.html') { res.setHeader('content-type', 'text/html'); return res.end(h.state.html); }
      if (req.url === '/static/app.bundle.js') { res.setHeader('content-type', 'application/javascript'); return res.end(h.state.script); }
      if (req.url.startsWith('/dicom-web/studies/')) {
        if (/\/frames\/|\/bulk\//.test(req.url)) { res.setHeader('content-type', h.state.binaryType); return res.end(h.state.binary); }
        return json(h.state.metadata, 'application/dicom+json');
      }
      res.writeHead(404); res.end('Synthetic missing endpoint');
      function json(value, type = 'application/json') { res.setHeader('content-type', type); res.end(JSON.stringify(value)); }
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  const origin = await listen(provider);
  h = fixture({ realHelpers: true, httpOrigin: origin, network: (url, init) => {
    // The fixture DNS layer maps named private services onto this synthetic PACS.
    const parsed = new URL(url);
    if (parsed.hostname === 'ohif.test') return fetch(`${origin}/static${parsed.pathname}`, init);
    return fetch(`${origin}${parsed.pathname}${parsed.search}`, init);
  } });
  const dicom = h.read('src/app/api/imaging/dicomweb/[studyId]/[[...path]]/route.ts');
  const ohif = h.read('src/app/(app)/imaging/ohif/[[...path]]/route.ts');
  const app = createServer(async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      h.session = cookie === 'fixture=a' ? h.actor('a') : cookie === 'fixture=b' ? h.actor('b') : null;
      const url = new URL(req.url, 'https://app.test');
      const request = new Request(url, { headers: req.headers });
      let response;
      if (url.pathname.startsWith('/api/imaging/dicomweb/')) {
        const [, , , , studyId, ...path] = url.pathname.split('/');
        response = await dicom.GET(request, { params: Promise.resolve({ studyId, path }) });
      } else {
        const path = url.pathname.slice('/imaging/ohif/'.length).split('/');
        response = await ohif.GET(request, { params: Promise.resolve({ path }) });
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  const appOrigin = await listen(app);
  const metadata = `/api/imaging/dicomweb/study-a/studies/${h.uid}/metadata`;
  const frame = `/api/imaging/dicomweb/study-a/studies/${h.uid}/series/${h.series}/instances/${h.instance}/frames/1`;
  const shell = `/imaging/ohif/viewer?studyId=study-a&StudyInstanceUIDs=${h.uid}`;
  const get = (path, actor = 'a') => fetch(`${appOrigin}${path}`, { headers: actor ? { cookie: `fixture=${actor}`, authorization: 'Bearer browser-supplied' } : {} });
  try {
    for (const path of [metadata, frame, shell, '/imaging/ohif/app.bundle.js', `/imaging/ohif/app-config.js?studyId=study-a&StudyInstanceUIDs=${h.uid}`]) assert.equal((await get(path, null)).status, 401);
    assert.equal(providerRequests.length, 0);
    for (const path of [metadata, frame, shell]) assert.equal((await get(path, 'b')).status, 404);
    assert.equal(providerRequests.length, 0);
    const meta = await get(metadata); assert.equal(meta.status, 200); assert.match(await meta.text(), /\/api\/imaging\/dicomweb\/study-a\//);
    assert.match(meta.headers.get('cache-control'), /no-store/);
    const pixels = await get(frame); assert.equal(pixels.status, 200); assert.equal(await pixels.text(), h.state.binary.toString());
    const viewer = await get(shell); assert.equal(viewer.status, 200); assert.match(await viewer.text(), /app-config\.js\?studyId=study-a/);
    assert.equal(viewer.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.equal((await get('/imaging/ohif/app.bundle.js', 'b')).status, 200);
    assert.equal((await get('/api/imaging/dicomweb/study-a/studies')).status, 400);
    assert.equal((await get(`${metadata}?url=https://evil.test`)).status, 400);
    assert.equal((await get('/imaging/ohif/api/system.js')).status, 400);
    h.connection.metadata.verifiedVersion = 'stale'; const before = providerRequests.length;
    assert.equal((await get(frame)).status, 503); assert.equal(providerRequests.length, before);
  } finally { await close(app); await close(provider); }
});
