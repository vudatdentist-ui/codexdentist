// Disposable loopback signing engine. No email, external network or real PDFs.
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const local = new Set(['127.0.0.1', 'localhost', '[::1]']);
const app = new URL(process.env.DOCUMENSO_QA_APP_URL || 'http://127.0.0.1:3002');
const database = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test' || !local.has(app.hostname) || !database || !local.has(database.hostname) ||
    [...database.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service)$/i.test(key))) throw new Error('Signing simulator requires an explicit disposable loopback installation');
const token = 'synthetic-documenso-token', secret = 'synthetic-documenso-webhook-secret';
const envelopes = new Map();
let webhookPath, pdf, distributions = 0, dropDistribution = true, invalidDownload = false;
http.createServer(async (req, res) => {
  const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    let total = 0; const chunks = [];
    for await (const chunk of req) { total += chunk.length; if (total > 2 * 1024 * 1024) return reply(413, {}); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks), path = new URL(req.url, 'http://127.0.0.1').pathname;
    const body = req.headers['content-type']?.includes('multipart/form-data') ? null : bytes.length ? JSON.parse(bytes.toString()) : {};
    if (path === '/__test/state') return reply(200, { creates: envelopes.size, distributions, ids: [...envelopes.keys()] });
    if (path === '/__test/config' && req.method === 'POST') {
      if (!/^\/api\/integrations\/documenso\/webhooks\/[A-Za-z0-9_-]+$/.test(body.webhookPath)) return reply(400, {});
      webhookPath = body.webhookPath; pdf = Buffer.from(body.pdf, 'base64');
      if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) return reply(400, {});
      return reply(200, {});
    }
    if (path === '/__test/complete' && req.method === 'POST') {
      const envelope = envelopes.get(body.envelopeId);
      if (!webhookPath || !envelope) return reply(404, {});
      envelope.status = 'COMPLETED'; invalidDownload = body.invalidPdf === true;
      const response = await fetch(new URL(webhookPath, app), { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-documenso-secret': body.badSecret ? 'invalid' : secret },
        body: JSON.stringify({ event: 'DOCUMENT_COMPLETED', createdAt: '2026-11-05T12:00:00Z', payload: {
          envelopeId: envelope.id, externalId: envelope.externalId, status: 'COMPLETED', completedAt: '2026-11-05T12:00:00Z' } }) });
      return reply(200, { webhookStatus: response.status, body: await response.json() });
    }
    if (req.headers.authorization !== token) return reply(401, {});
    if (path === '/envelope/create' && req.method === 'POST') {
      const form = await new Request('http://fixture.test', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: bytes }).formData();
      const input = JSON.parse(form.get('payload'));
      const envelope = { id: randomUUID(), externalId: input.externalId, status: 'DRAFT', envelopeItems: [{ id: 'synthetic-item' }],
        recipients: [{ signingUrl: 'https://sign.example.test/synthetic-only' }] };
      envelopes.set(envelope.id, envelope); return reply(200, envelope);
    }
    if (path === '/envelope/distribute' && req.method === 'POST') {
      const envelope = envelopes.get(body.envelopeId); if (!envelope) return reply(404, {});
      envelope.status = 'PENDING'; distributions++;
      if (dropDistribution) { dropDistribution = false; res.destroy(); return; }
      return reply(200, envelope);
    }
    if (path.startsWith('/envelope/item/') && path.endsWith('/download')) {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="synthetic-signed.pdf"' });
      return res.end(invalidDownload ? Buffer.from('invalid synthetic PDF') : pdf);
    }
    const envelope = envelopes.get(path.replace('/envelope/', ''));
    if (req.method === 'GET' && envelope) return reply(200, envelope);
    reply(404, {});
  } catch (cause) { console.error('Synthetic signing fixture failed:', cause.name, cause.message); reply(500, { error: 'Synthetic signing request failed' }); }
}).listen(11445, '127.0.0.1', () => console.log('Synthetic signing engine ready on loopback port 11445'));
