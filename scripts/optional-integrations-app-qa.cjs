// Full Next app and real PostgreSQL/vault, isolated from operational records.
const assert = require('node:assert/strict');
const { randomBytes, pbkdf2Sync } = require('node:crypto');
const fs = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { chromium } = require('playwright');
const source = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
assert.ok(process.env.NODE_ENV === 'test' && source && ['127.0.0.1','localhost','[::1]'].includes(source.hostname) &&
  ![...source.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service|connectionstring)$/i.test(key)), 'Explicit loopback test administrator required');
const name = 'optional_app_test_' + randomBytes(8).toString('hex'), target = new URL(source); target.pathname = '/' + name;
const base = 'http://127.0.0.1:3002', output = 'output/workspace-qa/optional-app';
const live = process.argv.includes('--live-providers') ? JSON.parse(fs.readFileSync(process.env.OPTIONAL_QA_CREDENTIALS_FILE || 'output/optional-services-qa-credentials.json','utf8')) : null;
if (live) {
  assert.equal(live.qaOnly,true);
  for (const provider of ['orthanc','chatwoot','medplum','novu']) assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(live[provider].baseUrl).hostname));
}
fs.mkdirSync(output, { recursive: true });
const admin = new Client({ connectionString: source.toString() });
let created = false, prisma, app, browser, log, page;
const ownedStudies = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  try {
    try { await fetch(base, { signal: AbortSignal.timeout(1000) }); throw new Error('QA port is occupied'); }
    catch (error) { if (error.message === 'QA port is occupied') throw error; }
    await admin.connect(); await admin.query(`CREATE DATABASE "${name}"`); created = true;
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe', timeout: 60000, windowsHide: true });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
    const password = randomBytes(24).toString('hex'), salt = randomBytes(16).toString('hex');
    const passwordHash = ['pbkdf2_sha256', 310000, salt, pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex')].join('$');
    const org = await prisma.organization.create({ data: { name: 'Synthetic integration acceptance' } });
    const clinic = await prisma.clinic.create({ data: { organizationId: org.id, name: 'Synthetic clinic', city: 'QA', address: 'QA' } });
    const user = await prisma.user.create({ data: { organizationId: org.id, email: 'owner@example.test', fullName: 'Synthetic owner', role: 'OWNER', passwordHash } });
    const patient = await prisma.patient.create({ data: { organizationId: org.id, clinicId: clinic.id, fullName: 'Synthetic QR acceptance', phone: '0000000000', medicalAlerts: [] } });
    const invoice = await prisma.invoice.create({ data: { organizationId: org.id, clinicId: clinic.id, patientId: patient.id,
      invoiceNo: 'QA-OFFLINE-001', amount: 150000, paidAmount: 0, dueDate: new Date(), items: { create: { organizationId: org.id,
        clinicId: clinic.id, patientId: patient.id, description: 'Synthetic acceptance', quantity: 1, unitPrice: 150000, amount: 150000 } } } });
    log = fs.openSync(output + '/app.log', 'w');
    app = spawn(process.execPath, ['node_modules/next/dist/bin/next','dev','--webpack','-H','127.0.0.1','-p','3002'], {
      env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: target.toString(), APP_BASE_URL: base, SESSION_COOKIE_SECURE: 'false',
        PATIENT_FILE_STORAGE_DRIVER: 'local', AUTH_SECRET: 'synthetic-app-qa-secret-at-least-32-characters',
        OPTIONAL_PROVIDER_ALLOWED_ORIGINS: live ? [...['orthanc','chatwoot','medplum','novu'].map(key => live[key].baseUrl),'http://127.0.0.1:24805'].join(',') : '',
        OPTIONAL_OHIF_BASE_URL: live ? 'http://127.0.0.1:24805/imaging/ohif' : '' },
      stdio: ['ignore', log, log], windowsHide: true });
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (app.exitCode !== null) throw new Error('App exited before readiness');
      try { if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await delay(1000);
    }
    assert.ok(ready, 'App health');
    browser = await chromium.launch();
    const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page = await context.newPage(); const errors = []; page.setDefaultTimeout(60000); page.on('pageerror', error => errors.push(error.message));
    const { loginForBrowserAudit } = await import('./browser-login.mjs');
    await loginForBrowserAudit(page, { baseUrl: base, email: user.email, password, evidencePath: output + '/login', navigationTimeout: 90000 });
    await page.goto(base + '/settings?section=providers', { waitUntil: 'networkidle' });
    const settings = page.locator('#bank-transfer'); await settings.waitFor();
    for (const provider of ['orthanc','chatwoot','novu','medplum']) {
      const panel = page.locator('#' + provider); await panel.getByText('Chưa thiết lập', { exact: true }).waitFor();
      assert.equal(await panel.getByRole('button', { name: 'Kiểm tra kết nối và bật', exact: true }).isDisabled(), true);
    }
    for (const width of [1440,390,320]) {
      await page.setViewportSize({ width, height: 1000 }); await settings.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/settings-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Settings overflow');
    }
    await settings.getByLabel('Mã BIN ngân hàng (6 chữ số)').fill('970436');
    await settings.getByLabel('Số tài khoản', { exact: true }).fill('000000000000');
    await settings.getByLabel('Tên người nhận theo ngân hàng').fill('SYNTHETIC TEST ONLY');
    await settings.getByRole('checkbox').check(); await settings.getByRole('button', { name: 'Lưu tài khoản', exact: true }).click();
    await settings.getByRole('status').waitFor();
    assert.equal(await settings.getByLabel('Số tài khoản', { exact: true }).inputValue(), '');
    const saved = await (await page.request.get('/api/integrations/bank-transfer/settings')).json();
    assert.ok(!JSON.stringify(saved).includes('000000000000'));
    const connection = await prisma.integrationConnection.findFirstOrThrow({ where: { organizationId: org.id, provider: 'bank-transfer' } });
    assert.equal(connection.lastVerifiedAt, null); assert.equal(connection.secretRef, 'vault:v1');
    const seal = await prisma.$queryRawUnsafe('SELECT ciphertext FROM "IntegrationCredential" WHERE "connectionId"=$1', connection.id);
    assert.ok(seal[0] && !seal[0].ciphertext.includes('000000000000'));
    await page.goto(base + `/billing?patientId=${patient.id}`, { waitUntil: 'networkidle' });
    const tab = page.getByRole('tab', { name: /^Hóa đơn/ }); await tab.and(page.locator('[tabindex]')).waitFor(); await tab.click();
    const row = page.locator('.billing-invoice-row').filter({ hasText: invoice.invoiceNo }); await row.waitFor();
    await row.getByRole('button', { name: 'QR chuyển khoản', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Hướng dẫn chuyển khoản', exact: true }); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Tạo QR chuyển khoản', exact: true }).click();
    await dialog.getByRole('img', { name: 'Mã QR hướng dẫn chuyển khoản', exact: true }).waitFor();
    for (const width of [1440,390,320]) {
      await page.setViewportSize({ width, height: 1000 }); await page.screenshot({ path: `${output}/invoice-qr-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Invoice overflow');
    }
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await prisma.payment.count(), 0); assert.equal(await prisma.receipt.count(), 0);
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).paidAmount.toString(), '0');
    // Actual routes must reject missing session and cross-origin mutations.
    assert.equal((await fetch(base + '/api/integrations/bank-transfer/settings')).status, 401);
    assert.equal((await page.request.post('/api/integrations/bank-transfer/qr', { headers: { origin: 'https://foreign.test' },
      data: { patientId: patient.id, invoiceNo: invoice.invoiceNo, amount: 1 } })).status(), 403);
    await page.goto(base + `/patients?patientId=${patient.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Dịch vụ kết nối', exact: true }).click();
    await page.getByText('Chưa có dịch vụ nào được bật cho hồ sơ này trong phạm vi của bạn.', { exact: false }).waitFor();
    for (const width of [1440,390,320]) {
      await page.setViewportSize({ width, height: 1000 }); await page.screenshot({ path: `${output}/patient-disabled-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Patient overflow');
    }
    if (live) {
      await page.goto(base + '/settings?section=providers', { waitUntil: 'networkidle' });
      for (const provider of ['orthanc','chatwoot','novu','medplum']) {
        const panel = page.locator('#'+provider);
        const workspace = await (await page.request.get('/api/integrations/optional-providers/'+provider)).json();
        for (const field of workspace.definition.fields) {
          const element = panel.getByLabel(field.label,{ exact:true });
          if (field.options) await element.selectOption(live[provider][field.key]);
          else await element.fill(live[provider][field.key]);
        }
        await panel.getByRole('button',{name:'Lưu kết nối',exact:true}).click();
        await panel.getByText('Đã lưu. Kết nối đang tắt; kiểm tra kết nối để bật sử dụng.',{exact:true}).waitFor();
        await panel.getByRole('button',{name:'Kiểm tra kết nối và bật',exact:true}).click();
        await panel.getByText('Đã bật và xác minh',{exact:true}).waitFor();
        for (const width of [1440,390,320]) {
          await page.setViewportSize({width,height:1000}); await panel.scrollIntoViewIfNeeded();
          await page.screenshot({path:`${output}/${provider}-verified-${width}.png`});
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+2));
        }
      }
      const novuSettings = page.locator('#novu');
      await novuSettings.getByRole('button',{name:'Gửi thử nghiệm',exact:true}).click();
      const reconcile = novuSettings.getByRole('button',{name:'Kiểm tra kết quả gửi',exact:true});
      await reconcile.waitFor();
      for (let i=0;i<15;i++) {
        if (await novuSettings.getByText('Đã gửi',{exact:true}).count()) break;
        await reconcile.click(); await delay(1000);
      }
      await novuSettings.getByText('Đã gửi',{exact:true}).waitFor();
      await page.goto(base + `/patients?patientId=${patient.id}`,{waitUntil:'networkidle'});
      await page.getByRole('button',{name:'Dịch vụ kết nối',exact:true}).click();
      const med = page.getByRole('region',{name:'Medplum',exact:true});
      await med.getByRole('button',{name:'Gửi đến Medplum',exact:true}).click();
      await med.getByText('Đã xác minh bản hiện tại',{exact:true}).waitFor();
      const chat = page.getByRole('region',{name:'Hội thoại bệnh nhân',exact:true});
      await chat.getByRole('checkbox').check(); await chat.getByRole('button',{name:'Tạo hoặc tiếp tục liên kết',exact:true}).click();
      await chat.getByText('Đã lưu liên kết',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Liên kết người nhận',exact:true}).click();
      await page.getByText('Đã xác minh người nhận',{exact:true}).waitFor();
      for (const width of [1440,390,320]) {
        await page.setViewportSize({width,height:1000}); await med.scrollIntoViewIfNeeded();
        await page.screenshot({path:`${output}/patient-live-${width}.png`});
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+2));
      }
      // Synthetic image only. The exact test-created study is removed in finally.
      const sharp = require('sharp');
      const pixels = await sharp({create:{width:128,height:128,channels:3,background:'#ffffff'}})
        .composite([{input:Buffer.from('<svg width="128" height="128"><rect x="24" y="24" width="80" height="80" fill="black"/><rect x="40" y="40" width="48" height="48" fill="white"/></svg>')}]).png().toBuffer();
      const headers = {'Content-Type':'application/json', Authorization:'Basic '+Buffer.from(live.orthanc.username+':'+live.orthanc.password).toString('base64')};
      const upload = await fetch(live.orthanc.baseUrl+'/tools/create-dicom',{method:'POST',headers,body:JSON.stringify({Tags:{PatientName:'SYNTHETIC^ACCEPTANCE',PatientID:'qa-'+name,
        StudyDescription:'SYNTHETIC QA ONLY',Modality:'OT'},Content:'data:image/png;base64,'+pixels.toString('base64')})});
      assert.equal(upload.status,200); const dicom = await upload.json(); ownedStudies.push(dicom.ParentStudy);
      await page.goto(base+'/imaging',{waitUntil:'networkidle'});
      await page.getByText('Liên kết phim chụp',{exact:true}).first().click();
      await page.getByLabel('Bệnh nhân',{exact:true}).selectOption(patient.id);
      await page.getByLabel('Mã phim chụp',{exact:true}).fill(dicom.ParentStudy);
      await page.getByRole('button',{name:'Liên kết phim chụp',exact:true}).click();
      await page.getByText('Đã liên kết phim chụp với bệnh nhân.',{exact:true}).waitFor();
      const [viewer] = await Promise.all([context.waitForEvent('page'),page.getByRole('link',{name:'Mở phim chụp',exact:true}).click()]);
      const frames = []; viewer.on('response', response => {if (/\/frames\//.test(response.url())) frames.push({status:response.status(),url:response.url()});});
      viewer.on('pageerror',error => errors.push(error.message));
      await viewer.waitForLoadState('domcontentloaded'); await viewer.locator('canvas').first().waitFor({timeout:90000});
      for (let i=0;i<60&&!frames.some(frame=>frame.status===200);i++) await delay(1000);
      assert.ok(frames.some(frame=>frame.status===200),'OHIF must retrieve authorized DICOM pixels');
      for (const text of ['Skip all','Confirm and hide']) {
        const control=viewer.getByText(text,{exact:true}); if(await control.count())await control.click();
      }
      fs.writeFileSync(output+'/viewer-controls.json',JSON.stringify(await viewer.locator('button').evaluateAll(elements=>elements.map(el=>({label:el.getAttribute('aria-label'),title:el.getAttribute('title'),text:el.textContent}))),null,2));
      for (const width of [1440,390,320]) {
        await viewer.setViewportSize({width,height:1000});
        await viewer.screenshot({path:`${output}/ohif-live-${width}.png`,fullPage:true});
        assert.ok(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'OHIF responsive overflow');
      }
      const study=await prisma.imagingStudy.findFirstOrThrow({where:{organizationId:org.id}});
      const other=await prisma.organization.create({data:{name:'Synthetic foreign acceptance'}});
      const otherClinic=await prisma.clinic.create({data:{organizationId:other.id,name:'Foreign QA clinic',city:'QA',address:'QA'}});
      await prisma.user.create({data:{organizationId:other.id,role:'OWNER',email:'other-owner@example.test',fullName:'Other synthetic owner',passwordHash}});
      const foreign=await browser.newContext({baseURL:base}), foreignPage=await foreign.newPage();
      await loginForBrowserAudit(foreignPage,{baseUrl:base,email:'other-owner@example.test',password,evidencePath:output+'/foreign-login',navigationTimeout:90000});
      const forbiddenPixel=await foreignPage.request.get(`/api/imaging/dicomweb/${study.id}/studies?StudyInstanceUID=${encodeURIComponent(study.studyInstanceUid)}`);
      assert.equal(forbiddenPixel.status(),404);
      assert.equal((await foreignPage.request.get(new URL(viewer.url()).pathname+new URL(viewer.url()).search)).status(),404);
      assert.equal((await foreignPage.request.post(`/api/integrations/medplum/patients/${patient.id}`,{headers:{origin:base}})).status(),404);
      await foreign.close();
      await viewer.close();
      console.log('PASS actual app provider verification, Novu worker confirmation, patient Chatwoot/Medplum/Novu and private OHIF pixels');
    }
    assert.deepEqual(errors, []);
    console.log('PASS full Next + disposable PostgreSQL: provider settings, encrypted bank account, local QR dialog, unchanged ledger, disabled patient services, CSRF/login, 1440/390/320');
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});
      fs.writeFileSync(output+'/failure.txt',await page.locator('body').innerText().catch(()=>''));
    }
    throw error;
  } finally {
    await browser?.close();
    if (app && app.exitCode === null) { app.kill(); await new Promise(resolve => app.once('exit', resolve)); }
    if (log !== undefined) fs.closeSync(log);
    await prisma?.$disconnect();
    const cleanup=await Promise.allSettled(ownedStudies.map(async id=>{
      assert.match(id,/^[a-f0-9-]+$/);
      const response = await fetch(live.orthanc.baseUrl+'/studies/'+id,{method:'DELETE',headers:{Authorization:'Basic '+Buffer.from(live.orthanc.username+':'+live.orthanc.password).toString('base64')}});
      assert.ok(response.ok || response.status===404,'Remove only this run\'s synthetic PACS study');
    }));
    if (created) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
      await admin.query(`DROP DATABASE "${name}"`);
    }
    await admin.end();
    for(const item of cleanup) if(item.status==='rejected')throw item.reason;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
