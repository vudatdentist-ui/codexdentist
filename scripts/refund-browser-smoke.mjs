import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium } from 'playwright';
import { loginForBrowserAudit } from './browser-login.mjs';

const baseUrl = process.env.BROWSER_QA_BASE_URL ?? 'http://127.0.0.1:3000';
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL ||
    !loopback.has(new URL(baseUrl).hostname) || !loopback.has(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error('Refund browser QA requires a disposable loopback app and database.');
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('dialog', dialog => dialog.accept());
const output = 'output/workspace-qa/refund';
await mkdir(output, { recursive: true });
let patientId;
let invoiceId;
const results = [];
const actionRequest = request => request.method() === 'POST' && Boolean(request.headers()['next-action']);
try {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@nhavista.vn' } });
  const clinic = await prisma.clinic.findFirstOrThrow({ where: { organizationId: owner.organizationId, active: true } });
  const token = randomUUID();
  const patient = await prisma.patient.create({ data: { organizationId: owner.organizationId, clinicId: clinic.id,
    fullName: 'Synthetic refund QA', phone: 'refund-' + token, medicalAlerts: [] } });
  patientId = patient.id;
  const scope = { organizationId: owner.organizationId, clinicId: clinic.id, patientId };
  const invoice = await prisma.$transaction(async tx => {
    const created = await tx.invoice.create({ data: { ...scope, invoiceNo: 'REFUND-' + token,
      amount: 100000, paidAmount: 100000, status: 'PAID', dueDate: new Date() } });
    await tx.invoiceItem.create({ data: { ...scope, invoiceId: created.id, description: 'Synthetic collection',
      quantity: 1, amount: 100000, unitPrice: 100000 } });
    const receipt = await tx.receipt.create({ data: { ...scope, receiptNo: 'REFUND-REC-' + token,
      amount: 100000, allocatedAmount: 100000, unallocatedAmount: 0, method: 'cash' } });
    await tx.receiptAllocation.create({ data: { ...scope, invoiceId: created.id, receiptId: receipt.id, amount: 100000 } });
    await tx.payment.create({ data: { invoiceId: created.id, amount: 100000, method: 'cash', reference: receipt.receiptNo } });
    return created;
  });
  invoiceId = invoice.id;
  await loginForBrowserAudit(page, { baseUrl, email: owner.email,
    password: process.env.BROWSER_QA_PASSWORD ?? 'CodexSmoke2026!', evidencePath: output + '/login' });
  await page.goto(`${baseUrl}/billing?patientId=${patientId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /^Kiểm soát/ }).click();
  await page.locator('details.billing-admin-details > summary').click();
  const form = page.locator('form').filter({ has: page.locator('input[name=idempotencyKey]') });
  await form.locator('select[name=invoiceNo]').selectOption(invoice.invoiceNo);
  const firstIntent = await form.locator('select[name=invoiceNo] option:checked').getAttribute('data-refund-request-key');
  assert.equal(firstIntent, `${invoice.id}:1`);
  await form.locator('input[inputmode=decimal]').fill('50000');
  const [request] = await Promise.all([
    page.waitForRequest(actionRequest),
    form.getByRole('button', { name: 'Hoàn tiền', exact: true }).click(),
  ]);
  await page.waitForURL(url => url.searchParams.has('notice'));
  assert.equal(new URL(page.url()).searchParams.get('notice'), 'billing-refund-recorded');
  await page.waitForLoadState('networkidle');
  assert.equal(Number((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).paidAmount), 50000);
  assert.equal(await prisma.payment.count({ where: { invoiceId, method: 'refund:cash' } }), 1);
  results.push('browser refund records one exact payment');

  const headers = Object.fromEntries(Object.entries(request.headers()).filter(([name]) =>
    ['content-type', 'next-action', 'next-router-state-tree', 'origin', 'accept', 'referer'].includes(name)));
  const replay = await page.request.post(request.url(), { headers, data: request.postDataBuffer() });
  assert.ok(replay.status() < 400, `replay status ${replay.status()}`);
  assert.equal(await prisma.payment.count({ where: { invoiceId, method: 'refund:cash' } }), 1);
  assert.equal(Number((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).paidAmount), 50000);
  results.push('identical server-action replay cannot refund twice');

  await page.goto(`${baseUrl}/billing?patientId=${patientId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /^Kiểm soát/ }).click();
  await page.locator('details.billing-admin-details > summary').click();
  await form.locator('select[name=invoiceNo]').selectOption(invoice.invoiceNo);
  assert.equal(await form.locator('select[name=invoiceNo] option:checked').getAttribute('data-refund-request-key'), `${invoice.id}:2`);
  await form.locator('input[inputmode=decimal]').fill('50000');
  await Promise.all([
    page.waitForResponse(response => actionRequest(response.request())),
    form.getByRole('button', { name: 'Hoàn tiền', exact: true }).click(),
  ]);
  await page.waitForLoadState('networkidle');
  assert.equal(await prisma.payment.count({ where: { invoiceId, method: 'refund:cash' } }), 2);
  assert.equal(Number((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).paidAmount), 0);
  results.push('a fresh ledger version permits a second intentional refund');

  await page.goto(`${baseUrl}/billing?patientId=${patientId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /^Hóa đơn/ }).click();
  const voidForm = page.locator('form').filter({ has: page.locator(`input[name=invoiceNo][value="${invoice.invoiceNo}"]`) })
    .filter({ has: page.locator('button.danger-link') });
  await Promise.all([
    page.waitForURL(url => url.searchParams.has('notice')),
    voidForm.getByRole('button').click(),
  ]);
  assert.equal(new URL(page.url()).searchParams.get('notice'), 'billing-invoice-refund-void-unsupported');
  await page.waitForLoadState('networkidle');
  await page.locator('.schedule-alert.action').filter({ hasText: 'Hóa đơn đã hoàn tiền cần được đối soát trước khi hủy.' }).waitFor();
  assert.equal(await prisma.patientCreditBalance.count({ where: { patientId } }), 0);
  assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status, 'OPEN');
  results.push('refunded invoice void is denied visibly without creating credit');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.schedule-alert.action').filter({ hasText: 'Hóa đơn đã hoàn tiền cần được đối soát trước khi hủy.' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
    await page.screenshot({ path: `${output}/refund-denied-${width}.png`, fullPage: true });
  }
  console.log('ok refund form intent, server replay, intentional second refund and visible safe void denial');
} catch (error) {
  await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(output + '/results.json', JSON.stringify({ commit: process.env.GITHUB_SHA, results }, null, 2));
  if (patientId) {
    if (invoiceId) await prisma.auditLog.deleteMany({ where: { entityType: 'Invoice', entityId: invoiceId } });
    await prisma.receiptAllocation.deleteMany({ where: { patientId } });
    await prisma.payment.deleteMany({ where: { invoice: { patientId } } });
    await prisma.invoiceItem.deleteMany({ where: { patientId } });
    await prisma.invoice.deleteMany({ where: { patientId } });
    await prisma.receipt.deleteMany({ where: { patientId } });
    await prisma.patientCreditBalance.deleteMany({ where: { patientId } });
    await prisma.patient.delete({ where: { id: patientId } });
  }
  await browser.close();
  await prisma.$disconnect();
}
