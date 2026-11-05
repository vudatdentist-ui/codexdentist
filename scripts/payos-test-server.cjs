// Synthetic merchant simulator for real app/browser QA. Never used by app code.
const transport = require('node:http');
const { createHmac } = require('node:crypto');
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const app = new URL(process.env.PAYOS_QA_APP_URL || 'http://127.0.0.1:3001');
if (process.env.NODE_ENV !== 'test' || !loopback.has(app.hostname) ||
    !process.env.DATABASE_URL || !loopback.has(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error('payOS simulator requires an explicit disposable loopback test installation');
}
const clientId = 'synthetic-payos-client', apiKey = 'a'.repeat(64), checksumKey = 'c'.repeat(64);
const orders = new Map();
let webhookUrl, requests = 0;
const signature = data => createHmac('sha256', checksumKey).update(Object.keys(data).sort().map(key => `${key}=${data[key] ?? ''}`).join('&')).digest('hex');
async function deliver(data, signed = true) {
  if (!webhookUrl) throw new Error('Synthetic webhook not registered');
  const target = new URL(webhookUrl);
  // Registered URLs are inspected but callbacks are confined to our loopback app.
  return fetch(new URL(target.pathname + target.search, app), { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '00', desc: 'success', success: true, data,
      signature: signed ? signature(data) : '00'.repeat(32) }) });
}
transport.createServer(async (request, response) => {
  const reply = (status, body) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
  try {
    let text = ''; for await (const chunk of request) { text += chunk; if (text.length > 16384) return reply(413, {}); }
    const body = text ? JSON.parse(text) : {};
    const url = new URL(request.url, 'https://127.0.0.1');
    if (url.pathname === '/__test/state') return reply(200, { requests, orders: [...orders.values()] });
    if (url.pathname === '/__test/settle' && request.method === 'POST') {
      const order = orders.get(Number(body.orderCode));
      if (!order) return reply(404, {});
      const data = { orderCode: order.orderCode, amount: order.amount, currency: 'VND',
        paymentLinkId: order.paymentLinkId, reference: String(body.reference || `synthetic-${order.orderCode}`),
        description: 'Synthetic payment', transactionDateTime: '2026-11-05 12:00:00', code: '00' };
      const result = await deliver(data, body.signed !== false);
      return reply(200, { webhookStatus: result.status, body: await result.json() });
    }
    if (request.headers['x-client-id'] !== clientId || request.headers['x-api-key'] !== apiKey) return reply(401, { code: '01', desc: 'Invalid synthetic merchant' });
    if (url.pathname === '/confirm-webhook' && request.method === 'POST') {
      webhookUrl = body.webhookUrl;
      const result = await deliver({ orderCode: 123, amount: 3000, description: 'VQRIO123', reference: 'TF230204212323',
        currency: 'VND', paymentLinkId: '124c33293c43417ab7879e14c8d9eb18' });
      return reply(result.ok ? 200 : 400, { code: result.ok ? '00' : '01', data: { webhookUrl } });
    }
    if (url.pathname === '/v2/payment-requests' && request.method === 'POST') {
      requests++;
      const signedFields = { amount: body.amount, cancelUrl: body.cancelUrl, description: body.description, orderCode: body.orderCode, returnUrl: body.returnUrl };
      if (body.signature !== signature(signedFields)) return reply(400, { code: '01' });
      const existing = orders.get(body.orderCode);
      if (existing) return reply(409, { code: '01', desc: 'Duplicate synthetic order' });
      const data = { orderCode: body.orderCode, amount: body.amount, currency: 'VND', paymentLinkId: `synthetic-${body.orderCode}`,
        checkoutUrl: `https://pay.payos.vn/web/synthetic-${body.orderCode}`, qrCode: `https://pay.payos.vn/web/synthetic-${body.orderCode}`, status: 'PENDING' };
      orders.set(body.orderCode, data);
      return reply(200, { code: '00', data, signature: signature(data) });
    }
    reply(404, {});
  } catch { reply(500, { error: 'Synthetic merchant request failed' }); }
}).listen(11444, '127.0.0.1', () => console.log('Synthetic payOS merchant ready on loopback port 11444'));
