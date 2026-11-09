// Actual upload action, private reads and tenant isolation on disposable data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomBytes,pbkdf2Sync,createHash}=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {Client}=require('pg'),{PrismaClient}=require('@prisma/client'),{PrismaPg}=require('@prisma/adapter-pg');
const {chromium}=require('playwright');
const source=process.env.DATABASE_URL&&new URL(process.env.DATABASE_URL);
assert.ok(process.env.NODE_ENV==='test'&&source&&['127.0.0.1','localhost','[::1]'].includes(source.hostname)&&
 ![...source.searchParams.keys()].some(k=>/^(host|hostaddr|database|dbname|port|service|connectionstring)$/i.test(k)));
const name='durable_file_app_test_'+randomBytes(8).toString('hex'),target=new URL(source);target.pathname='/'+name;
const base='http://127.0.0.1:3002',output='output/workspace-qa/durable-files';fs.mkdirSync(output,{recursive:true});
const storage=path.resolve(output,'storage-'+name);fs.mkdirSync(storage,{mode:0o700});
const admin=new Client({connectionString:source.toString()});let created=false,db,app,browser,page,log;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{try{
 try{await fetch(base,{signal:AbortSignal.timeout(1000)});throw Error('QA port occupied');}catch(e){if(e.message==='QA port occupied')throw e;}
 await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
 execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{env:{...process.env,DATABASE_URL:target.toString()},stdio:'pipe',timeout:60000,windowsHide:true});
 db=new PrismaClient({adapter:new PrismaPg({connectionString:target.toString()})});
 const password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex');
 const hash=['pbkdf2_sha256',310000,salt,pbkdf2Sync(password,salt,310000,32,'sha256').toString('hex')].join('$');
 async function fixture(label){
  const org=await db.organization.create({data:{name:'Synthetic private files '+label}});
  const clinic=await db.clinic.create({data:{organizationId:org.id,name:'Synthetic clinic',city:'QA',address:'QA'}});
  const user=await db.user.create({data:{organizationId:org.id,email:label+'@example.test',fullName:'Synthetic owner',role:'OWNER',passwordHash:hash}});
  const patient=await db.patient.create({data:{organizationId:org.id,clinicId:clinic.id,fullName:'Synthetic file acceptance',phone:'0000000000',medicalAlerts:[]}});
  return {org,clinic,user,patient};
 }
 const primary=await fixture('owner'),foreign=await fixture('foreign');
 const forbidden=await db.patientFile.create({data:{organizationId:foreign.org.id,clinicId:foreign.clinic.id,patientId:foreign.patient.id,
  title:'Foreign synthetic file',url:'not-public',storageProvider:'local',storageKey:'foreign/never-open',virusScanStatus:'CLEAN'}});
 log=fs.openSync(output+'/app.log','w');
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','-H','127.0.0.1','-p','3002'],{
  env:{...process.env,NODE_ENV:'development',DATABASE_URL:target.toString(),APP_BASE_URL:base,SESSION_COOKIE_SECURE:'false',
   AUTH_SECRET:'synthetic-private-file-secret-at-least-32-characters',PATIENT_FILE_STORAGE_DRIVER:'local',PATIENT_FILE_STORAGE_ROOT:storage,PATIENT_FILE_LOCAL_DURABLE:'false'},
  stdio:['ignore',log,log],windowsHide:true});
 let ready=false;for(let i=0;i<90;i++){if(app.exitCode!==null)throw Error('QA app exited');try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}await delay(1000);}assert.ok(ready);
 browser=await chromium.launch();const context=await browser.newContext({baseURL:base,viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 page=await context.newPage();page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const {loginForBrowserAudit}=await import('./browser-login.mjs');
 await loginForBrowserAudit(page,{baseUrl:base,email:primary.user.email,password,evidencePath:output+'/login',navigationTimeout:90000});
 await page.goto(base+'/journey?patientId='+primary.patient.id,{waitUntil:'domcontentloaded'});
 const form=page.locator('#chart-comment');await form.waitFor();
 await form.locator('textarea').fill('Synthetic private file acceptance');
 const pdf=Buffer.from('%PDF-1.7\nSynthetic private file acceptance\n%%EOF\n');
 const png=await require('sharp')({create:{width:320,height:160,channels:3,background:'#327f73'}}).png().toBuffer();
 await form.locator('input[type=file]').setInputFiles([{name:'synthetic-private.pdf',mimeType:'application/pdf',buffer:pdf},{name:'synthetic-image.png',mimeType:'image/png',buffer:png}]);
 await form.locator('button[type=submit]').click();await page.waitForURL(/notice=journey-comment-created/);
 const files=await db.patientFile.findMany({where:{organizationId:primary.org.id}});assert.equal(files.length,2);
 for(const file of files){
  assert.equal(file.storageProvider,'local');assert.equal(file.sourceType,'LOCAL_UPLOAD');
  const response=await context.request.get('/patient-files/'+file.id);assert.equal(response.status(),200);
  assert.match(response.headers()['cache-control'],/no-store/);assert.match(response.headers()['x-content-type-options'],/nosniff/);
  const body=await response.body();assert.equal(createHash('sha256').update(body).digest('hex'),file.checksumSha256);
  assert.deepEqual(body,file.mimeType==='image/png'?png:pdf);
  for(const variant of ['preview','thumbnail'])if(file[variant+'StorageKey']){
   const result=await context.request.get('/patient-files/'+file.id+'?variant='+variant);assert.equal(result.status(),200);assert.match(result.headers()['content-type'],/image\/webp/);assert.ok((await result.body()).length>0);
  }
  const disk=path.resolve(storage,file.storageKey.replace(/^patient-files\//,''));assert.ok(disk.startsWith(storage+path.sep));assert.ok(fs.existsSync(disk));
 }
 assert.equal((await context.request.get('/patient-files/'+forbidden.id)).status(),404);
 const anonymous=await browser.newContext({baseURL:base});const denied=await anonymous.request.get('/patient-files/'+files[0].id,{maxRedirects:0});
 assert.equal(denied.status(),307);assert.equal(new URL(denied.headers().location,base).pathname,'/login');await anonymous.close();
 const event=page.locator('details.chart-timeline-event').filter({hasText:'Synthetic private file acceptance'}).first();
 await event.locator('summary').click();
 await event.locator('.timeline-attachment-list').waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('details[open] .timeline-attachment-list img')].every(img=>img.complete&&img.naturalWidth>0));
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});await event.scrollIntoViewIfNeeded();
  await page.screenshot({path:`${output}/uploaded-${width}.png`});
  await event.screenshot({path:`${output}/attachments-${width}.png`});
  const heading=await event.locator('.chart-timeline-event-body').boundingBox(),status=await event.locator('summary > .status').boundingBox();
  assert.ok(heading&&status);
  assert.ok(status.x>=heading.x+heading.width-1 || status.y>=heading.y+heading.height-1,'Timeline status must not overlap its author or title');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 }
 assert.equal(await db.invoice.count(),0);assert.equal(await db.payment.count(),0);assert.equal(await db.receipt.count(),0);assert.deepEqual(errors,[]);
 console.log('PASS actual app PDF/image upload, previews, checksummed protected download, tenant/anonymous denials, unchanged financial tables and 1440/390/320 UI.');
}catch(e){if(page&&!page.isClosed())await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});throw e;}
finally{
 await browser?.close();if(app&&app.exitCode===null){app.kill();await new Promise(resolve=>app.once('exit',resolve));}if(log!==undefined)fs.closeSync(log);
 await db?.$disconnect();if(created){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await admin.query(`DROP DATABASE "${name}"`);}await admin.end();
 // Delete only this randomly named disposable fixture directory.
 assert.ok(storage.startsWith(path.resolve(output)+path.sep+'storage-durable_file_app_test_'));
 if(fs.existsSync(storage)){assert.equal(fs.realpathSync(storage),storage);fs.rmSync(storage,{recursive:true,force:true});}
}})().catch(e=>{console.error(e);process.exitCode=1});
