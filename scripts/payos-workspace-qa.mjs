import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginForBrowserAudit } from './browser-login.mjs';
import { purgeOrganization } from '../src/lib/organization-purge.ts';
import { prisma as purgePrisma } from '../src/lib/prisma.ts';

const base = process.env.PAYOS_QA_APP_URL ?? 'http://127.0.0.1:3001';
const provider = process.env.PAYOS_QA_PROVIDER_URL ?? 'http://127.0.0.1:11444';
const productionUI = process.argv.includes('--production-ui');
const local = new Set(['localhost', '127.0.0.1', '[::1]']);
const database = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test' || !database || ![base, provider].every(url => local.has(new URL(url).hostname)) ||
    !local.has(database.hostname) || [...database.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service)$/i.test(key))) throw new Error('Requires an explicit disposable loopback app, merchant and database');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.toString() }) });
const token = randomUUID();
const owned = [];
const output = productionUI ? 'output/workspace-qa/payos-production' : 'output/workspace-qa/payos';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [], errors = [];
const credentials = { clientId: 'synthetic-payos-client', apiKey: 'a'.repeat(64), checksumKey: 'c'.repeat(64) };
let page;
try {
  const seed = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@nhavista.vn' }, select: { passwordHash: true } });
  async function workspace(label) {
    const organization = await prisma.organization.create({ data: { name: `payos-qa-${token}-${label}`, slug: `pq-${label.toLowerCase()}-${token}` } });
    owned.push(organization.id);
    await writeFile(`${output}/fixtures-${token}.json`, JSON.stringify({ token, organizationIds: owned }));
    const clinic = await prisma.clinic.create({ data: { organizationId: organization.id, name: `Synthetic ${label}`, city: 'QA', address: 'QA only' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, role: 'OWNER', active: true,
      fullName: `Synthetic ${label} owner`, email: `payos-${label.toLowerCase()}-${token}@example.test`, passwordHash: seed.passwordHash } });
    return { organization, clinic, user };
  }
  const a = await workspace('A'), b = await workspace('B');
  const clinic2 = await prisma.clinic.create({ data: { organizationId: a.organization.id, name: 'Synthetic inaccessible clinic', city: 'QA', address: 'QA only' } });
  const manager = await prisma.user.create({ data: { organizationId: a.organization.id, role: 'CLINIC_MANAGER', active: true,
    fullName: 'Synthetic limited manager', email: `payos-manager-${token}@example.test`, passwordHash: seed.passwordHash,
    clinics: { create: { clinicId: a.clinic.id } } } });
  const patient = await prisma.patient.create({ data: { organizationId: a.organization.id, clinicId: a.clinic.id,
    fullName: 'Synthetic QR patient', phone: `payos-${token}`, medicalAlerts: [] } });
  const invoice = await prisma.invoice.create({ data: { organizationId: a.organization.id, clinicId: a.clinic.id,
    patientId: patient.id, invoiceNo: `PAYOS-${token}`, amount: 100000, paidAmount: 0, status: 'OPEN', dueDate: new Date(),
    items: { create: { organizationId: a.organization.id, clinicId: a.clinic.id, patientId: patient.id,
      description: 'Synthetic QR service', quantity: 1, unitPrice: 100000, amount: 100000 } } } });
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  await loginForBrowserAudit(page, { baseUrl: base, email: a.user.email, password: 'CodexSmoke2026!', evidencePath: `${output}/login`, navigationTimeout: productionUI ? 15000 : 60000 });
  await page.goto(`${base}/settings?section=providers`, { waitUntil: 'networkidle' });
  const settings = page.locator('#payos'); await settings.waitFor();
  await settings.getByText('Chưa thiết lập', { exact: true }).waitFor();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await settings.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/settings-unconfigured-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  async function save(keys) {
    await settings.getByLabel('Client ID', { exact: true }).fill(keys.clientId);
    await settings.getByLabel('API Key', { exact: true }).fill(keys.apiKey);
    await settings.getByLabel('Checksum Key', { exact: true }).fill(keys.checksumKey);
    await settings.getByRole('button', { name: 'Lưu kết nối', exact: true }).click();
    await settings.getByText('Đã lưu. Xác minh kết nối để nhận thanh toán.', { exact: true }).waitFor();
    for (const input of await settings.locator('input[type=password]').all()) assert.equal(await input.inputValue(), '');
  }
  if (!productionUI) {
    await save({ ...credentials, apiKey: 'b'.repeat(64) });
    await settings.getByRole('button', { name: 'Xác minh kết nối', exact: true }).click();
    await settings.getByRole('alert').waitFor();
    assert.equal(await settings.getByText('Sẵn sàng nhận thanh toán', { exact: true }).count(), 0);
  }
  await save(credentials);
  if (productionUI) {
    // Production UI test uses owned, pre-verified synthetic state; it never
    // sends fake credentials to a real provider or changes production TLS rules.
    await prisma.$executeRawUnsafe(`UPDATE "IntegrationConnection" SET "lastVerifiedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      "metadata"='{"webhookConfirmed":true}'::jsonb WHERE "organizationId"=$1 AND "provider"='payos'`, a.organization.id);
    await settings.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
  } else await settings.getByRole('button', { name: 'Xác minh kết nối', exact: true }).click();
  await settings.getByText('Sẵn sàng nhận thanh toán', { exact: true }).waitFor();
  const settingsReply = await (await page.request.get('/api/integrations/payos/settings')).json();
  for (const value of Object.values(credentials)) assert.ok(!JSON.stringify(settingsReply).includes(value));
  const connection = settingsReply.connections.find(row => row.clinicId === null);
  assert.ok(connection?.verified);
  if (!productionUI) {
  assert.ok(new URL(connection.webhookUrl).searchParams.has('verification'));
  // Copying the registered address remains valid after the initial handshake
  // window. Only the signed sample and the confirmed nonce are acknowledged.
  await prisma.$executeRawUnsafe(`UPDATE "IntegrationConnection" SET "metadata"="metadata" ||
    jsonb_build_object('verificationExpiresAt','2000-01-01T00:00:00Z') WHERE "id"=$1`, connection.id);
  const probe = await fetch(`${provider}/confirm-webhook`, { method: 'POST',
    headers: { 'x-client-id': credentials.clientId, 'x-api-key': credentials.apiKey },
    body: JSON.stringify({ webhookUrl: connection.webhookUrl }) });
  assert.equal(probe.status, 200);
  await fetch(`${provider}/__test/fail-next-confirm`, { method: 'POST' });
  await settings.getByRole('button', { name: 'Xác minh kết nối', exact: true }).click();
  await settings.getByRole('alert').waitFor();
  const afterFailedVerification = await (await page.request.get('/api/integrations/payos/settings')).json();
  assert.equal(afterFailedVerification.connections.find(row => row.id === connection.id).webhookUrl, connection.webhookUrl);
  const oldProbe = await fetch(`${provider}/confirm-webhook`, { method: 'POST',
    headers: { 'x-client-id': credentials.clientId, 'x-api-key': credentials.apiKey },
    body: JSON.stringify({ webhookUrl: connection.webhookUrl }) });
  assert.equal(oldProbe.status, 200, 'Failed re-verification must preserve the confirmed registration');
  }
  const stored = await prisma.$queryRawUnsafe('SELECT ciphertext FROM "IntegrationCredential" WHERE "connectionId"=$1', connection.id);
  for (const value of Object.values(credentials)) assert.ok(!JSON.stringify(stored).includes(value));
  await page.screenshot({ path: `${output}/settings-verified-1440.png` });
  results.push(productionUI ? 'production UI: settings save/encryption/no-readback; pre-verified synthetic fixture'
    : 'settings save/encryption/no-readback/invalid credentials/signed verification');

  for (const actor of [b.user, manager]) {
    const deniedContext = await browser.newContext({ baseURL: base });
    const deniedPage = await deniedContext.newPage();
    await loginForBrowserAudit(deniedPage, { baseUrl: base, email: actor.email, password: 'CodexSmoke2026!', evidencePath: `${output}/denial-login` });
    const denied = await deniedPage.request.post('/api/integrations/payos/settings', { headers: { origin: base },
      data: { action: 'save', clinicId: actor.id === manager.id ? clinic2.id : a.clinic.id, credentials } });
    assert.equal(denied.status(), 403);
    if (actor.id === b.user.id) {
      const deniedRead = await deniedPage.request.get(`/api/integrations/payos/payment-links?patientId=${patient.id}&invoiceNo=${invoice.invoiceNo}`);
      assert.equal(deniedRead.status(), 404);
    }
    await deniedContext.close();
  }
  results.push('tenant and inaccessible clinic denied by real endpoints');
  if (productionUI) {
    const orderCode = Date.now() * 100 + 11;
    await prisma.$executeRawUnsafe(`INSERT INTO "ExternalReference" ("id","organizationId","clinicId","connectionId","provider","entityType","internalId","externalId","metadata")
      VALUES ($1,$2,$3,$4,'payos','PAYOS_ORDER',$5,$6,$7::jsonb)`, randomUUID(), a.organization.id, a.clinic.id, connection.id,
      randomUUID(), String(orderCode), JSON.stringify({ patientId: patient.id, invoiceNo: invoice.invoiceNo, amount: 100000,
        status: 'PENDING', currency: 'VND', paymentLinkId: `synthetic-${orderCode}`,
        checkoutUrl: `https://pay.payos.vn/web/synthetic-${orderCode}`, qrCode: `synthetic-qr-${orderCode}` }));
  }
  await page.goto(`${base}/billing?patientId=${patient.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Hóa đơn/ }).click();
  const row = page.locator('.billing-invoice-row').filter({ hasText: invoice.invoiceNo }); await row.waitFor();
  await row.getByRole('button', { name: 'Thanh toán payOS', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Thanh toán qua payOS', exact: true });
  await dialog.getByRole('button', { name: 'Tạo mã thanh toán', exact: true }).waitFor();
  const qr = dialog.getByRole('img', { name: 'Mã QR thanh toán payOS', exact: true });
  if (!productionUI) {
  let interrupted = false, firstKey, replayKey, interceptedStatus, interceptedBody;
  const countBefore = (await (await fetch(`${provider}/__test/state`)).json()).requests;
  await page.route('**/api/integrations/payos/payment-links', async route => {
    if (route.request().method() === 'POST' && !interrupted) {
      interrupted = true; firstKey = route.request().postDataJSON().idempotencyKey;
      const response = await route.fetch();
      interceptedStatus = response.status(); interceptedBody = await response.json();
      if (interceptedStatus !== 200) return route.fulfill({ response });
      return route.abort('failed');
    }
    return route.continue();
  });
  await dialog.getByRole('button', { name: 'Tạo mã thanh toán', exact: true }).click();
  await dialog.getByRole('button', { name: 'Thử lại cùng yêu cầu', exact: true }).waitFor();
  assert.equal(interceptedStatus, 200, JSON.stringify(interceptedBody));
  await page.unroute('**/api/integrations/payos/payment-links');
  page.on('request', request => { if (request.url().endsWith('/api/integrations/payos/payment-links') && request.method() === 'POST') replayKey = request.postDataJSON().idempotencyKey; });
  await dialog.getByRole('button', { name: 'Thử lại cùng yêu cầu', exact: true }).click();
  await qr.waitFor();
  assert.equal(replayKey, firstKey);
  assert.ok((await qr.getAttribute('src')).startsWith('data:image/png;base64,'));
  assert.equal((await (await fetch(`${provider}/__test/state`)).json()).requests, countBefore + 1);
  }
  await qr.waitFor();
  const read = await (await page.request.get(`/api/integrations/payos/payment-links?patientId=${patient.id}&invoiceNo=${invoice.invoiceNo}`)).json();
  const order = read.orders[0]; assert.equal(read.orders.length, 1);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await qr.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/qr-pending-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Hóa đơn/ }).click();
  await page.locator('.billing-invoice-row').filter({ hasText: invoice.invoiceNo }).getByRole('button', { name: 'Thanh toán payOS', exact: true }).click();
  await qr.waitFor();
  const cannotReplace = await page.request.post('/api/integrations/payos/settings', { headers: { origin: base }, data: { action: 'save', clinicId: null, credentials } });
  assert.equal(cannotReplace.status(), 409);
  const cannotDisable = await page.request.post('/api/integrations/payos/settings', { headers: { origin: base }, data: { action: 'disable', clinicId: null } });
  assert.equal(cannotDisable.status(), 409);
  results.push(productionUI ? 'production QR/history/refresh/reload; pending order blocks replacement/disable'
    : 'real QR; lost response/retry creates one intent; reload retains order; pending order blocks replacement/disable');
  {
    if (productionUI) {
      // Production UI exercises the persisted observation fixture without making
      // a request to the real merchant API with synthetic credentials.
      await prisma.$executeRawUnsafe(`UPDATE "ExternalReference" SET "metadata"="metadata" ||
        '{"providerStatus":"PAID","providerAmountPaid":100000}'::jsonb WHERE "id"=$1 AND "organizationId"=$2`, order.id, a.organization.id);
      await dialog.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
    } else {
    await fetch(`${provider}/__test/order-status`, { method: 'POST', body: JSON.stringify({ orderCode: order.orderCode, status: 'PAID', amountPaid: 100000 }) });
    await dialog.getByRole('button', { name: 'Kiểm tra với payOS', exact: true }).click();
    }
    await dialog.getByText(/payOS báo đã nhận tiền/).waitFor();
    assert.equal(await qr.count(), 0);
    assert.equal(await prisma.receipt.count({ where: { organizationId: a.organization.id } }), 0, 'A status query cannot fabricate collection');
    assert.equal((await page.request.post('/api/integrations/payos/settings', { headers: { origin: base }, data: { action: 'disable', clinicId: null } })).status(), 409);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: /Hóa đơn/ }).click();
    await page.locator('.billing-invoice-row').filter({ hasText: invoice.invoiceNo }).getByRole('button', { name: 'Thanh toán payOS', exact: true }).click();
    await dialog.getByText(/payOS báo đã nhận tiền/).waitFor();
    assert.equal(await qr.count(), 0);
    assert.equal(await dialog.getByRole('button', { name: 'Tạo mã thanh toán', exact: true }).isEnabled(), false);
    await dialog.locator('h2').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/paid-awaiting-receipt-320.png` });
    results.push(productionUI ? 'production paid-observation fixture hides QR and blocks new collection while awaiting receipt'
      : 'signed PAID observation persists and hides QR while receipt and credential guards await the webhook');
  }
  assert.equal(await prisma.receipt.count({ where: { organizationId: a.organization.id } }), 0);
  async function settle(reference, signed = true) {
    if (!productionUI) return (await fetch(`${provider}/__test/settle`, { method: 'POST', body: JSON.stringify({ orderCode: order.orderCode, reference, signed }) })).json();
    const data = { orderCode: order.orderCode, amount: 100000, currency: 'VND', paymentLinkId: `synthetic-${order.orderCode}`, reference, code: '00' };
    const signature = createHmac('sha256', credentials.checksumKey).update(Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('&')).digest('hex');
    const response = await page.request.post(`/api/integrations/payos/webhooks/${connection.id}`, {
      data: { code: '00', success: true, data, signature: signed ? signature : '00'.repeat(32) } });
    return { webhookStatus: response.status(), body: await response.json() };
  }
  const wrong = await settle('invalid', false);
  assert.equal(wrong.webhookStatus, 400);
  assert.equal(await prisma.receipt.count({ where: { organizationId: a.organization.id } }), 0);
  for (const reference of ['same-transfer', 'same-transfer', 'different-event-same-order']) {
    const result = await settle(reference);
    assert.equal(result.webhookStatus, 200, JSON.stringify(result));
  }
  const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  assert.equal(Number(paid.paidAmount), 100000); assert.equal(paid.status, 'PAID');
  assert.equal(await prisma.receipt.count({ where: { organizationId: a.organization.id } }), 1);
  assert.equal(await prisma.payment.count({ where: { invoiceId: invoice.id } }), 1);
  assert.equal(Number((await prisma.receiptAllocation.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } }))._sum.amount), 100000);
  await dialog.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
  await dialog.getByText('Đã ghi nhận thanh toán', { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/qr-settled-320.png` });
  results.push('bad signature rejected; repeated and reordered provider callbacks create exactly one reconciled receipt/payment');
  if (!productionUI) {
    const expiring = await prisma.invoice.create({ data: { organizationId: a.organization.id, clinicId: a.clinic.id,
      patientId: patient.id, invoiceNo: `EXPIRE-${token}`, amount: 40000, paidAmount: 0, status: 'OPEN', dueDate: new Date(),
      items: { create: { organizationId: a.organization.id, clinicId: a.clinic.id, patientId: patient.id,
        description: 'Synthetic unpaid expiry', quantity: 1, unitPrice: 40000, amount: 40000 } } } });
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' }); await page.getByRole('tab', { name: /Hóa đơn/ }).click();
    await page.locator('.billing-invoice-row').filter({ hasText: expiring.invoiceNo }).getByRole('button', { name: 'Thanh toán payOS', exact: true }).click();
    await dialog.getByRole('button', { name: 'Tạo mã thanh toán', exact: true }).click();
    await qr.waitFor();
    const history = await (await page.request.get(`/api/integrations/payos/payment-links?patientId=${patient.id}&invoiceNo=${expiring.invoiceNo}`)).json();
    await fetch(`${provider}/__test/order-status`, { method: 'POST', body: JSON.stringify({ orderCode: history.orders[0].orderCode, status: 'EXPIRED', amountPaid: 0 }) });
    await dialog.getByRole('button', { name: 'Kiểm tra với payOS', exact: true }).click();
    await dialog.getByText('Đã hết hạn', { exact: true }).waitFor();
    assert.equal(await qr.count(), 0);
    assert.equal(await prisma.receipt.count({ where: { organizationId: a.organization.id } }), 1);
    await dialog.locator('h2').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/expired-unpaid-320.png` });
    const repair = await page.request.post('/api/integrations/payos/settings', { headers: { origin: base }, data: { action: 'save', clinicId: null, credentials } });
    assert.equal(repair.status(), 200, 'A verified unpaid terminal order may release the credential lock');
    results.push('signed unpaid expiry removes old QR and unblocks credential repair without creating a receipt');
  }
  assert.deepEqual(errors, []);
} catch (cause) {
  results.push({ failed: String(cause) });
  await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  for (const id of owned.reverse()) {
    const row = await prisma.organization.findUnique({ where: { id }, select: { name: true } });
    assert.ok(row?.name.startsWith(`payos-qa-${token}-`));
    await purgeOrganization(id);
  }
  await prisma.$disconnect(); await purgePrisma.$disconnect();
  await writeFile(`${output}/report.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, results, errors }, null, 2));
  console.log(JSON.stringify({ output, results, errors }));
}
