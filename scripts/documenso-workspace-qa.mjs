import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginForBrowserAudit } from './browser-login.mjs';
import { purgeOrganization } from '../src/lib/organization-purge.ts';
import { prisma as purgePrisma } from '../src/lib/prisma.ts';

const base = process.env.DOCUMENSO_QA_APP_URL ?? 'http://127.0.0.1:3002', provider = 'http://127.0.0.1:11445';
const productionUI = process.argv.includes('--production-ui');
const database = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL), local = new Set(['127.0.0.1', 'localhost', '[::1]']);
if (process.env.NODE_ENV !== 'test' || process.env.PATIENT_FILE_STORAGE_DRIVER !== 'local' || !database ||
    !local.has(database.hostname) || !local.has(new URL(base).hostname) ||
    [...database.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service)$/i.test(key))) throw new Error('Requires disposable loopback app/database and local file storage');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.toString() }) });
const token = randomUUID(), owned = [], files = [], output = productionUI ? 'output/workspace-qa/documenso-production' : 'output/workspace-qa/documenso', results = [], errors = [];
const credentials = { apiToken: 'synthetic-documenso-token', webhookSecret: 'synthetic-documenso-webhook-secret' };
await mkdir(output, { recursive: true });
const browser = await chromium.launch(); let page;
try {
  const seed = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@nhavista.vn' }, select: { passwordHash: true } });
  async function workspace(label) {
    const organization = await prisma.organization.create({ data: { name: `documenso-qa-${token}-${label}`, slug: `dq-${label.toLowerCase()}-${token}` } });
    owned.push(organization.id); await writeFile(`${output}/fixtures-${token}.json`, JSON.stringify({ token, owned }));
    const clinic = await prisma.clinic.create({ data: { organizationId: organization.id, name: `Synthetic signing ${label}`, city: 'QA', address: 'QA only' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, role: 'OWNER', active: true,
      fullName: `Synthetic signing ${label}`, email: `signing-${label.toLowerCase()}-${token}@example.test`, passwordHash: seed.passwordHash } });
    return { organization, clinic, user };
  }
  const a = await workspace('A'), b = await workspace('B');
  const patient = await prisma.patient.create({ data: { organizationId: a.organization.id, clinicId: a.clinic.id,
    fullName: 'Synthetic signing patient', email: 'synthetic-patient@example.test', phone: `qa-${token}`, medicalAlerts: [] } });
  const template = await prisma.formTemplate.create({ data: { organizationId: a.organization.id, clinicId: a.clinic.id,
    createdById: a.user.id, code: `QA-${token}`, name: 'Synthetic consent', version: '1.0', type: 'CONSENT', requiresSignature: true, schema: {} } });
  const form = await prisma.patientForm.create({ data: { organizationId: a.organization.id, clinicId: a.clinic.id, patientId: patient.id,
    templateId: template.id, requestedById: a.user.id, formNo: `SIGN-${token}`, status: 'SENT', sentAt: new Date() } });
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  const pdfPage = await context.newPage(); await pdfPage.setContent('<h1>Synthetic consent</h1><p>Disposable browser QA only.</p>');
  const bytes = await pdfPage.pdf({ format: 'A4' }); await pdfPage.close();
  const fileId = randomUUID(), storageKey = `patient-files/${a.organization.id}/${patient.id}/${fileId}.pdf`;
  const absolute = path.resolve('storage/patient-files', storageKey.replace(/^patient-files\//, ''));
  files.push(absolute); await mkdir(path.dirname(absolute), { recursive: true }); await writeFile(absolute, bytes, { flag: 'wx' });
  await prisma.patientFile.create({ data: { id: fileId, organizationId: a.organization.id, clinicId: a.clinic.id, patientId: patient.id,
    uploadedById: a.user.id, title: 'Synthetic source PDF', fileName: 'synthetic-consent.pdf', category: 'CONSENT', mimeType: 'application/pdf',
    url: `/patient-files/${fileId}`, sizeBytes: bytes.length, sourceType: 'LOCAL_UPLOAD', sourceId: storageKey, storageProvider: 'local', storageKey,
    checksumSha256: createHash('sha256').update(bytes).digest('hex'), virusScanStatus: 'CLEAN' } });
  await loginForBrowserAudit(page, { baseUrl: base, email: a.user.email, password: 'CodexSmoke2026!', evidencePath: `${output}/login`, navigationTimeout: productionUI ? 15000 : 60000 });
  await page.goto(`${base}/settings?section=providers`, { waitUntil: 'networkidle' });
  const settings = page.locator('#documenso'); await settings.getByText('Chưa thiết lập', { exact: true }).waitFor();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 }); await settings.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/settings-unconfigured-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  }
  const staged = await page.request.post('/api/integrations/documenso/settings', {
    headers: { origin: base }, data: { action: 'save-disabled', clinicId: null, credentials },
  });
  assert.equal(staged.status(), 200);
  const stagedConnection = (await staged.json()).connections.find(value => value.clinicId === null);
  assert.equal(stagedConnection.configured, true);
  assert.equal(stagedConnection.enabled, false);
  await page.reload({ waitUntil: 'networkidle' });
  await settings.getByRole('button', { name: 'Bật kết nối', exact: true }).waitFor();
  await settings.getByLabel('API Token', { exact: true }).fill(credentials.apiToken);
  await settings.getByLabel('Webhook Secret', { exact: true }).fill(credentials.webhookSecret);
  await settings.getByRole('button', { name: 'Lưu kết nối', exact: true }).click();
  await settings.getByText('Đã lưu thông tin', { exact: true }).waitFor();
  for (const input of await settings.locator('input[type=password]').all()) assert.equal(await input.inputValue(), '');
  const config = await (await page.request.get('/api/integrations/documenso/settings')).json();
  for (const value of Object.values(credentials)) assert.ok(!JSON.stringify(config).includes(value));
  const connection = config.connections.find(value => value.clinicId === null);
  assert.equal(connection.id, stagedConnection.id);
  assert.equal(connection.enabled, true);
  const cipher = await prisma.$queryRawUnsafe('SELECT ciphertext FROM "IntegrationCredential" WHERE "connectionId"=$1', connection.id);
  for (const value of Object.values(credentials)) assert.ok(!JSON.stringify(cipher).includes(value));
  if (!productionUI) {
    const configured = await fetch(`${provider}/__test/config`, { method: 'POST', body: JSON.stringify({ webhookPath: new URL(connection.webhookUrl).pathname, pdf: bytes.toString('base64') }) });
    assert.equal(configured.status, 200);
  }
  const deniedContext = await browser.newContext({ baseURL: base }); const denied = await deniedContext.newPage();
  await loginForBrowserAudit(denied, { baseUrl: base, email: b.user.email, password: 'CodexSmoke2026!', evidencePath: `${output}/denial-login` });
  assert.equal((await denied.request.get(`/api/integrations/documenso/signing-requests?patientFormId=${form.id}`)).status(), 404);
  assert.equal((await denied.request.post('/api/integrations/documenso/signing-requests', { headers: { origin: base }, data: { action: 'attach-source', patientFormId: form.id, sourcePatientFileId: fileId } })).status(), 404);
  await deniedContext.close(); results.push('scoped encrypted settings, no key readback, negative tenant endpoints');
  await page.goto(`${base}/forms`, { waitUntil: 'networkidle' });
  const row = page.locator('.billing-invoice-row').filter({ hasText: form.formNo });
  await row.getByRole('button', { name: 'Ký qua Documenso', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ký đồng thuận qua Documenso', exact: true });
  await dialog.getByLabel('Bản PDF cần ký', { exact: true }).selectOption(fileId);
  await dialog.getByRole('button', { name: 'Gắn PDF vào biểu mẫu', exact: true }).click();
  let state;
  if (productionUI) {
    // Rendered production states use owned fixtures and make no provider calls.
    const envelopeId = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO "ExternalReference" ("id","organizationId","clinicId","connectionId","provider","entityType","internalId","externalId","metadata")
      VALUES ($1,$2,$3,$4,'documenso','DOCUMENSO_REQUEST',$5,$6,$7::jsonb)`, randomUUID(), a.organization.id, a.clinic.id, connection.id,
      form.id, randomUUID(), JSON.stringify({ patientFormId: form.id, sourcePatientFileId: fileId, envelopeId,
        recipientName: patient.fullName, recipientEmail: patient.email,
        status: 'PENDING', distributionStatus: 'SENT', signingUrl: 'https://sign.example.test/synthetic-only' }));
    await dialog.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
    state = { ids: [envelopeId] };
  } else {
  const confirm = dialog.getByRole('checkbox'); await confirm.check();
  await dialog.getByRole('button', { name: 'Gửi yêu cầu ký', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  await prisma.patient.update({ where: { id: patient.id }, data: { email: 'corrected-synthetic@example.test' } });
  const changed = await (await page.request.get(`/api/integrations/documenso/signing-requests?patientFormId=${form.id}`)).json();
  assert.equal(changed.canRequest, false, 'A corrected patient email cannot resume the old recipient ceremony');
  await dialog.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Thông tin bệnh nhân đã thay đổi' }).waitFor();
  await page.screenshot({ path: `${output}/recipient-changed-320.png` });
  const wrongRecipient = await page.request.post('/api/integrations/documenso/signing-requests', { headers: { origin: base },
    data: { patientFormId: form.id, sourcePatientFileId: fileId, idempotencyKey: changed.request.idempotencyKey } });
  assert.equal(wrongRecipient.status(), 409);
  assert.equal((await (await fetch(`${provider}/__test/state`)).json()).distributions, 1);
  await prisma.patient.update({ where: { id: patient.id }, data: { email: patient.email } });
  await dialog.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
  const resume = dialog.getByRole('button', { name: 'Tiếp tục cùng phiên ký', exact: true }); await resume.waitFor();
  await confirm.check(); await resume.click();
  await dialog.getByRole('link', { name: 'Mở trang ký của bệnh nhân' }).waitFor();
  state = await (await fetch(`${provider}/__test/state`)).json();
  assert.equal(state.creates, 1); assert.equal(state.distributions, 1);
  }
  await dialog.getByRole('link', { name: 'Mở trang ký của bệnh nhân' }).waitFor();
  assert.equal((await page.request.post('/api/integrations/documenso/settings', { headers: { origin: base }, data: { action: 'disable', clinicId: null } })).status(), 409);
  assert.equal((await page.request.post('/api/integrations/documenso/signing-requests', { headers: { origin: base }, data: { action: 'attach-source', patientFormId: form.id, sourcePatientFileId: fileId } })).status(), 409);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await dialog.evaluate(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: innerHeight, scrollY }; });
    assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height, `Dialog remains in viewport: ${JSON.stringify(geometry)}`);
    await dialog.locator('h2').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/signing-pending-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  }
  await page.reload({ waitUntil: 'networkidle' }); await row.getByRole('button', { name: 'Ký qua Documenso', exact: true }).click();
  await dialog.getByRole('link', { name: 'Mở trang ký của bệnh nhân' }).waitFor();
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await row.getByRole('button', { name: 'Hoàn tất', exact: true }).click();
  const manual = page.getByRole('dialog', { name: 'Hoàn tất biểu mẫu', exact: true });
  await manual.locator('textarea[name=responses]').fill('Synthetic attempted manual completion during signing');
  await manual.locator('input[name=signatureUrl]').fill(`/patient-files/${fileId}`);
  page.once('dialog', dialog => dialog.accept());
  await manual.getByRole('button', { name: 'Hoàn tất', exact: true }).click();
  await page.waitForURL(/notice=forms-signing-active/);
  assert.equal((await prisma.patientForm.findUniqueOrThrow({ where: { id: form.id } })).status, 'SENT');
  await row.getByRole('button', { name: 'Ký qua Documenso', exact: true }).click();
  await dialog.getByRole('link', { name: 'Mở trang ký của bệnh nhân' }).waitFor();
  results.push(productionUI ? 'production UI: attach protected PDF, pending fixture, reload, source/key/manual-completion guards'
    : 'attach protected PDF; dropped distribution response resumes one envelope without duplicate distribution; reload and pending guards');
  if (productionUI) {
    assert.equal((await page.request.post(`/api/integrations/documenso/webhooks/${connection.id}`, { headers: { 'x-documenso-secret': 'invalid' },
      data: { event: 'DOCUMENT_COMPLETED', payload: { envelopeId: state.ids[0] } } })).status(), 401);
    const signedId = randomUUID();
    await prisma.patientFile.create({ data: { id: signedId, organizationId: a.organization.id, clinicId: a.clinic.id, patientId: patient.id,
      category: 'SIGNED_CONSENT', title: 'Synthetic pre-signed consent fixture', fileName: 'synthetic-signed.pdf', mimeType: 'application/pdf',
      url: `/patient-files/${signedId}`, sizeBytes: bytes.length, sourceType: 'LOCAL_UPLOAD', sourceId: storageKey, storageProvider: 'local', storageKey,
      checksumSha256: createHash('sha256').update(bytes).digest('hex'), virusScanStatus: 'CLEAN' } });
    await prisma.patientForm.update({ where: { id: form.id }, data: { status: 'COMPLETED', signatureUrl: `/patient-files/${signedId}` } });
    await prisma.$executeRawUnsafe(`UPDATE "ExternalReference" SET "metadata"="metadata" || jsonb_build_object('status','SIGNED','patientFileId',$3::text)
      WHERE "organizationId"=$1 AND "internalId"=$2 AND "entityType"='DOCUMENSO_REQUEST'`, a.organization.id, form.id, signedId);
    await prisma.$executeRawUnsafe(`INSERT INTO "ExternalReference" ("id","organizationId","clinicId","connectionId","provider","entityType","internalId","externalId","metadata")
      VALUES ($1,$2,$3,$4,'documenso','DOCUMENSO_ENVELOPE',$5,$6,$7::jsonb)`, randomUUID(), a.organization.id, a.clinic.id, connection.id,
      form.id, state.ids[0], JSON.stringify({ status: 'SIGNED', patientFileId: signedId, patientId: patient.id, completedEventId: 'synthetic-fixture-only' }));
    await dialog.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
    await dialog.getByRole('link', { name: 'Mở bản PDF đã ký' }).waitFor();
    assert.equal((await page.request.get(`/patient-files/${fileId}`)).status(), 200);
    await page.screenshot({ path: `${output}/signed-stored-320.png` });
    results.push('production UI: invalid webhook secret denied; pre-signed fixture exposes protected PDF');
  } else {
  async function complete(options = {}) { return (await fetch(`${provider}/__test/complete`, { method: 'POST', body: JSON.stringify({ envelopeId: state.ids[0], ...options }) })).json(); }
  const invalidSecret = await complete({ badSecret: true }); assert.equal(invalidSecret.webhookStatus, 401, JSON.stringify(invalidSecret));
  const failed = await complete({ invalidPdf: true }); assert.ok(failed.webhookStatus >= 500);
  assert.equal((await prisma.patientForm.findUniqueOrThrow({ where: { id: form.id } })).status, 'SENT');
  assert.equal(await prisma.patientFile.count({ where: { organizationId: a.organization.id, category: 'SIGNED_CONSENT' } }), 0);
  await prisma.$executeRawUnsafe(`UPDATE "IntegrationInbox" SET "availableAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE "connectionId"=$1 AND "status"='RETRY'`, connection.id);
  for (let i = 0; i < 2; i++) assert.equal((await complete()).webhookStatus, 200);
  const completed = await prisma.patientForm.findUniqueOrThrow({ where: { id: form.id } });
  assert.equal(completed.status, 'COMPLETED'); assert.match(completed.signatureUrl, /^\/patient-files\//);
  assert.equal(await prisma.patientFile.count({ where: { organizationId: a.organization.id, category: 'SIGNED_CONSENT' } }), 1);
  assert.equal(await prisma.journeyComment.count({ where: { organizationId: a.organization.id, patientId: patient.id } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: a.organization.id, action: 'patient_form.signed_reconciled', entityId: form.id } }), 1);
  assert.equal((await page.request.get(completed.signatureUrl)).status(), 200);
  await dialog.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
  await dialog.getByRole('link', { name: 'Mở bản PDF đã ký' }).waitFor();
  await page.screenshot({ path: `${output}/signed-stored-320.png` });
  results.push('bad secret and invalid PDF cannot complete consent; retry/replay produces one protected signed file, Journey event and audit');
  }
  const manualForm = await prisma.patientForm.create({ data: { organizationId: a.organization.id, clinicId: a.clinic.id, patientId: patient.id,
    templateId: template.id, requestedById: a.user.id, formNo: `MANUAL-${token}`, status: 'SENT', attachments: [`/patient-files/${fileId}`] } });
  await prisma.$executeRawUnsafe(`INSERT INTO "ExternalReference" ("id","organizationId","clinicId","connectionId","provider","entityType","internalId","externalId","metadata")
    VALUES ($1,$2,$3,$4,'documenso','DOCUMENSO_REQUEST',$5,$6,$7::jsonb)`, randomUUID(), a.organization.id, a.clinic.id, connection.id,
    manualForm.id, randomUUID(), JSON.stringify({ patientFormId: manualForm.id, sourcePatientFileId: fileId, status: 'FAILED',
      recipientName: patient.fullName, recipientEmail: patient.email, creationUncertain: false }));
  await page.goto(`${base}/forms`, { waitUntil: 'networkidle' });
  const manualRow = page.locator('.billing-invoice-row').filter({ hasText: manualForm.formNo });
  await Promise.all([page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/integrations/documenso/signing-requests' && url.searchParams.get('patientFormId') === manualForm.id && response.status() === 200;
  }), manualRow.getByRole('button', { name: 'Ký qua Documenso', exact: true }).click()]);
  await dialog.getByText('Yêu cầu ký bị từ chối', { exact: true }).waitFor();
  assert.equal(await dialog.getByText('Đang chờ hoàn tất ký', { exact: true }).count(), 0);
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await manualRow.getByRole('button', { name: 'Hoàn tất', exact: true }).click();
  const manualComplete = page.getByRole('dialog', { name: 'Hoàn tất biểu mẫu', exact: true });
  await manualComplete.locator('textarea[name=responses]').fill('Synthetic manual-only completion after definitive signing rejection');
  await manualComplete.locator('input[name=signatureUrl]').fill(`/patient-files/${fileId}`);
  page.once('dialog', value => value.accept()); await manualComplete.getByRole('button', { name: 'Hoàn tất', exact: true }).click();
  await page.waitForURL(/notice=forms-completed/);
  await manualRow.getByRole('button', { name: 'Ký qua Documenso', exact: true }).click();
  await dialog.getByText('Biểu mẫu đã hoàn tất', { exact: true }).waitFor();
  assert.equal(await dialog.getByText('Đã ký và lưu vào hồ sơ', { exact: true }).count(), 0);
  assert.equal(await dialog.getByRole('link', { name: 'Mở bản PDF đã ký' }).count(), 0);
  await page.screenshot({ path: `${output}/manual-completed-320.png` });
  results.push('definitive rejection is not waiting; actual manual completion stays distinct from reconciled electronic signature');
  assert.deepEqual(errors, []);
} catch (cause) { results.push({ failed: String(cause) }); process.exitCode = 1; await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {}); }
finally {
  await browser.close();
  for (const organizationId of owned.reverse()) {
    const row = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
    assert.ok(row.name.startsWith(`documenso-qa-${token}-`)); await purgeOrganization(organizationId);
  }
  for (const file of files) await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await prisma.$disconnect(); await purgePrisma.$disconnect();
  await writeFile(`${output}/report.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, results, errors }, null, 2));
  console.log(JSON.stringify({ output, results, errors }));
}
