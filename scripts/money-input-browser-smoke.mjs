import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
import { loginForBrowserAudit } from './browser-login.mjs';

const baseUrl = process.env.BROWSER_QA_BASE_URL ?? 'http://127.0.0.1:3000';
const database = process.env.DATABASE_URL;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
if (process.env.NODE_ENV !== 'test' || !database ||
    !loopback.has(new URL(baseUrl).hostname) || !loopback.has(new URL(database).hostname)) {
  throw Error('Money input QA requires test mode and disposable loopback app/database');
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: database }) });
const output = 'output/workspace-qa/money-input';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
// This page contains only this suite's disposable patient and simulated money.
page.on('dialog', dialog => dialog.accept());
const token = randomUUID();
let patientId;
const evidence = [];
async function check(name, action) {
  await action();
  evidence.push({ name, status: 'passed' });
}
async function type(input, value) {
  await input.focus();
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await input.pressSequentially(value);
}
async function notice(value, action) {
  await Promise.all([
    page.waitForURL(url => url.searchParams.get('notice') === value),
    action(),
  ]);
  await page.waitForLoadState('networkidle');
}
try {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@nhavista.vn' } });
  const clinic = await prisma.clinic.findFirstOrThrow({ where: { organizationId: owner.organizationId, active: true } });
  const patient = await prisma.patient.create({ data: {
    organizationId: owner.organizationId, clinicId: clinic.id, fullName: 'Money typing QA ' + token,
    phone: 'qa-money-' + token, medicalAlerts: [],
  } });
  patientId = patient.id;
  const service = await prisma.treatmentService.create({ data: {
    organizationId: owner.organizationId, clinicId: clinic.id, patientId, createdById: owner.id,
    serviceCode: 'QA-' + token, serviceName: 'Money typing service', targetSummary: 'R11', teeth: ['R11'],
    finalPrice: 650000, currentProgressPercent: 50, status: 'IN_PROGRESS',
  } });
  await loginForBrowserAudit(page, { baseUrl, email: owner.email,
    password: process.env.BROWSER_QA_PASSWORD ?? 'CodexSmoke2026!', evidencePath: output + '/login' });
  await page.goto(`${baseUrl}/billing?patientId=${patientId}`, { waitUntil: 'networkidle' });
  const form = page.locator('form.billing-balance-form');
  const amount = form.locator('input[inputmode=decimal]');
  const raw = form.locator('input[name=amount]');
  await check('individual keystrokes retain six digits and canonical value', async () => {
    await type(amount, '200000');
    assert.equal(await amount.inputValue(), '200000');
    assert.equal(await raw.inputValue(), '200000');
    await amount.blur();
    assert.equal(await amount.inputValue(), '200.000');
    assert.equal(await raw.inputValue(), '200000');
  });
  await check('focus removes grouping so existing amounts can be edited normally', async () => {
    await amount.focus();
    assert.equal(await amount.inputValue(), '200000');
    await amount.press('Home');
    await amount.press('Delete');
    assert.equal(await raw.inputValue(), '0');
    await type(amount, '250000');
    assert.equal(await raw.inputValue(), '250000');
  });
  await check('decimal suffixes survive intermediate invalid prefixes', async () => {
    await type(amount, '1.5tr');
    assert.equal(await raw.inputValue(), '1500000');
    await amount.blur();
    assert.equal(await amount.inputValue(), '1.500.000');
  });
  await check('malformed and negative text cannot submit a hidden amount', async () => {
    for (const invalid of ['-100', 'abc100', '12.34']) {
      await amount.fill(invalid);
      await amount.blur();
      assert.equal(await raw.inputValue(), '');
      assert.equal(await amount.inputValue(), invalid);
      assert.equal(await amount.evaluate(input => input.validity.valid), false);
    }
    assert.equal(await prisma.receipt.count({ where: { patientId } }), 0);
  });
  for (const [index, value] of ['200000', '450000'].entries()) {
    await check(`receipt ${index + 1}: typed money persists exactly once`, async () => {
      await type(amount, value);
      assert.equal(await raw.inputValue(), value);
      await notice('billing-payment-recorded', () => form.getByRole('button', { name: 'Ghi nhận thu', exact: true }).click());
      const receipts = await prisma.receipt.findMany({ where: { patientId, method: 'cash' }, orderBy: { createdAt: 'asc' } });
      assert.equal(receipts.length, index + 1);
      assert.equal(Number(receipts[index].amount), Number(value));
      assert.equal(Number((await prisma.patientCreditBalance.findUniqueOrThrow({ where: { patientId } })).amount), Number(value));
    });
    await check(`allocation ${index + 1}: controlled typing and separate paid invoice reconcile`, async () => {
      const allocation = page.getByRole('textbox', { name: 'Số tiền thu', exact: true });
      await type(allocation, value);
      assert.equal(await allocation.inputValue(), value);
      await allocation.blur();
      assert.equal(await allocation.inputValue(), new Intl.NumberFormat('vi-VN').format(Number(value)));
      await notice('billing-service-receipt-invoiced', () => page.getByRole('button', { name: 'Phân bổ & xuất hóa đơn', exact: true }).click());
      const invoices = await prisma.invoice.findMany({ where: { patientId }, orderBy: { createdAt: 'asc' } });
      assert.equal(invoices.length, index + 1);
      assert.deepEqual(invoices.map(invoice => Number(invoice.amount)), [200000, 450000].slice(0, index + 1));
      assert.ok(invoices.every(invoice => invoice.status === 'PAID' && Number(invoice.paidAmount) === Number(invoice.amount)));
      assert.equal(Number((await prisma.patientCreditBalance.findUniqueOrThrow({ where: { patientId } })).amount), 0);
    });
  }
  const allocated = await prisma.receiptAllocation.aggregate({ where: { treatmentServiceId: service.id }, _sum: { amount: true } });
  assert.equal(Number(allocated._sum.amount), 650000);
  await page.screenshot({ path: output + '/reconciled.png', fullPage: true });
  console.log('Money keyboard and two-payment browser reconciliation passed.');
} catch (error) {
  await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {});
  evidence.push({ status: 'failed', message: String(error) });
  throw error;
} finally {
  await writeFile(output + '/results.json', JSON.stringify({ commit: process.env.GITHUB_SHA, evidence }, null, 2));
  if (patientId) {
    const where = { patientId };
    await prisma.receiptAllocation.deleteMany({ where });
    await prisma.payment.deleteMany({ where: { invoice: where } });
    await prisma.invoiceItem.deleteMany({ where });
    await prisma.invoice.deleteMany({ where });
    await prisma.receipt.deleteMany({ where });
    await prisma.patientCreditBalance.deleteMany({ where });
    await prisma.treatmentService.deleteMany({ where });
    await prisma.patient.delete({ where: { id: patientId } });
  }
  await browser.close();
  await prisma.$disconnect();
}
