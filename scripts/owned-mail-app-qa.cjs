// Disposable app/database and private TLS SMTP. No real inbox or operational user.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {randomBytes,pbkdf2Sync}=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const {Client}=require('pg'),{PrismaClient}=require('@prisma/client'),{PrismaPg}=require('@prisma/adapter-pg');
const {chromium}=require('playwright');
const source=process.env.DATABASE_URL&&new URL(process.env.DATABASE_URL);
assert.ok(process.env.NODE_ENV==='test'&&source&&['127.0.0.1','localhost','[::1]'].includes(source.hostname)&&
 ![...source.searchParams.keys()].some(key=>/^(host|hostaddr|database|dbname|port|service|connectionstring)$/i.test(key)));
const name='owned_mail_app_test_'+randomBytes(8).toString('hex'),target=new URL(source);target.pathname='/'+name;
const base='http://127.0.0.1:3002',output='output/workspace-qa/owned-mail';fs.mkdirSync(output,{recursive:true});
const admin=new Client({connectionString:source.toString()});let created=false,db,app,browser,page,fixture,log;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function passwordHash(password){const salt=randomBytes(16).toString('hex');return ['pbkdf2_sha256',310000,salt,pbkdf2Sync(password,salt,310000,32,'sha256').toString('hex')].join('$');}
(async()=>{try{
 try{await fetch(base,{signal:AbortSignal.timeout(1000)});throw Error('QA port occupied');}catch(e){if(e.message==='QA port occupied')throw e;}
 await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
 execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{env:{...process.env,DATABASE_URL:target.toString()},stdio:'pipe',timeout:60000,windowsHide:true});
 db=new PrismaClient({adapter:new PrismaPg({connectionString:target.toString()})});
 const org=await db.organization.create({data:{name:'Synthetic owned email acceptance'}});
 await db.clinic.create({data:{organizationId:org.id,name:'Synthetic clinic',city:'QA',address:'QA'}});
 const password=randomBytes(24).toString('hex');
 const owner=await db.user.create({data:{organizationId:org.id,email:'owner@example.test',fullName:'Synthetic email owner',role:'OWNER',passwordHash:passwordHash(password)}});
 const {ownedMailFixture}=await import('./owned-mail-fixture.mjs');fixture=await ownedMailFixture();
 log=fs.openSync(output+'/app.log','w');
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','-H','127.0.0.1','-p','3002'],{
  env:{...process.env,NODE_ENV:'development',DATABASE_URL:target.toString(),APP_BASE_URL:base,SESSION_COOKIE_SECURE:'false',
   AUTH_SECRET:'synthetic-owned-mail-app-auth-at-least-32-characters',PATIENT_FILE_STORAGE_DRIVER:'local',PATIENT_FILE_LOCAL_DURABLE:'false',
   NOTIFICATION_DELIVERY_MODE:'owned-mail',OWNED_MAIL_BASE_URL:fixture.baseUrl,OWNED_MAIL_SIGNING_SECRET:fixture.secret,OWNED_MAIL_FROM:fixture.from,
   NODE_EXTRA_CA_CERTS:fixture.certPath,RESEND_API_KEY:'',RESEND_FROM_EMAIL:''},stdio:['ignore',log,log],windowsHide:true});
 let ready=false;for(let i=0;i<90;i++){if(app.exitCode!==null)throw Error('QA app exited');try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}await delay(1000);}assert.ok(ready);
 browser=await chromium.launch();const context=await browser.newContext({baseURL:base,viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 page=await context.newPage();page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function forgot(email){
  await page.goto(base+'/login',{waitUntil:'domcontentloaded'});await page.locator('.forgot-password-panel > summary').click();
  const form=page.locator('.forgot-password-panel form');await form.locator('input[name=email]').fill(email);
  await form.locator('input[name=email]').press('Tab');
  await form.locator('button[type=submit]').click();await page.waitForURL(/forgot=sent/);
 }
 await forgot(owner.email);assert.equal(fixture.messages.length,1);assert.deepEqual(fixture.messages[0].recipients,[owner.email]);
 const decoded=fixture.messages[0].body.replace(/=\r\n/g,'').replace(/=([a-f0-9]{2})/gi,(_,code)=>String.fromCharCode(parseInt(code,16)));
 const link=decoded.match(/http:\/\/127\.0\.0\.1:3002\/reset-password\?token=[A-Za-z0-9_-]+/)?.[0];assert.ok(link,'Email contains the generated shared-host one-time link');
 const token=new URL(link).searchParams.get('token');assert.ok(token.length>=32);
 const notification=await db.notification.findFirstOrThrow({where:{organizationId:org.id}});
 assert.equal(notification.status,'SENT');assert.equal(notification.templateKey,'PASSWORD_RESET');assert.ok(!notification.body.includes(token));assert.ok(!JSON.stringify(notification.metadata).includes(token));
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`${output}/reset-requested-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));}
 // The same neutral public response must not disclose an unknown account.
 await forgot('unknown@example.test');assert.equal(fixture.messages.length,1);
 await page.goto(link,{waitUntil:'domcontentloaded'});const newPassword=randomBytes(24).toString('hex');
 await page.locator('input[name=password]').fill(newPassword);await page.locator('input[name=confirmPassword]').fill(newPassword);
 await page.locator('button[type=submit]').click();await page.waitForURL(/reset=success/);
 const changed=await db.user.findUniqueOrThrow({where:{id:owner.id}});assert.notEqual(changed.passwordHash,owner.passwordHash);
 const {loginForBrowserAudit}=await import('./browser-login.mjs');
 await loginForBrowserAudit(page,{baseUrl:base,email:owner.email,password:newPassword,evidencePath:output+'/login',navigationTimeout:90000});
 await page.goto(base+'/settings?section=providers',{waitUntil:'domcontentloaded'});
 const section=page.locator('[data-settings-block=providers]').filter({hasText:'Email của phòng khám'});
 await section.scrollIntoViewIfNeeded();
 await page.getByText('Email của phòng khám',{exact:true}).waitFor();
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await page.getByText('Email của phòng khám',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${output}/settings-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));}
 const before=fixture.messages.length;fixture.setMode('lost');await forgot(owner.email);assert.equal(fixture.messages.length,before+1);
 const uncertain=await db.notification.findFirstOrThrow({where:{organizationId:org.id},orderBy:{createdAt:'desc'}});assert.equal(uncertain.status,'PROCESSING');
 assert.ok(!uncertain.body.includes('token='));
 assert.equal(await db.patient.count(),0);assert.equal(await db.invoice.count(),0);assert.equal(await db.payment.count(),0);assert.equal(await db.receipt.count(),0);assert.deepEqual(errors,[]);
 console.log('PASS actual app owned TLS email: reset delivery and one-time consumption, no credential at rest, unknown-account neutrality, lost-ack uncertainty, settings at 1440/390/320 and unchanged clinical/financial tables.');
}catch(e){if(page&&!page.isClosed())await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});throw e;}
finally{
 await browser?.close();if(app&&app.exitCode===null){app.kill();await new Promise(resolve=>app.once('exit',resolve));}if(log!==undefined)fs.closeSync(log);
 await fixture?.close();await db?.$disconnect();if(created){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await admin.query(`DROP DATABASE "${name}"`);}await admin.end();
}})().catch(e=>{console.error(e);process.exitCode=1});
