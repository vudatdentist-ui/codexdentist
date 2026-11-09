// Actual Next actions + disposable PostgreSQL + an explicitly selected owned
// local inference server. Never points at production data or a cloud model.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {randomBytes,pbkdf2Sync}=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {Client}=require('pg'),{PrismaClient}=require('@prisma/client'),{PrismaPg}=require('@prisma/adapter-pg');
const {chromium}=require('playwright');
const source=process.env.DATABASE_URL&&new URL(process.env.DATABASE_URL);
const inference=new URL(process.env.LOCAL_AI_QA_BASE_URL||'http://127.0.0.1:24806');
assert.ok(process.env.NODE_ENV==='test'&&source&&['127.0.0.1','localhost','[::1]'].includes(source.hostname)&&
 ![...source.searchParams.keys()].some(key=>/^(host|hostaddr|database|dbname|port|service|connectionstring)$/i.test(key)));
assert.ok(['127.0.0.1','localhost','[::1]'].includes(inference.hostname)&&inference.protocol==='http:'&&!inference.username&&!inference.password);
const target=new URL(source),name='local_ai_app_test_'+randomBytes(8).toString('hex');target.pathname='/'+name;
const base='http://127.0.0.1:3002',output='output/workspace-qa/local-ai';fs.mkdirSync(output,{recursive:true});
const admin=new Client({connectionString:source.toString()});let created=false,prisma,app,browser,page,log;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(model){
 log=fs.openSync(output+'/'+(model==='qwen3:4b'?'success':'unavailable')+'.log','w');
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','-H','127.0.0.1','-p','3002'],{
  env:{...process.env,NODE_ENV:'development',DATABASE_URL:target.toString(),APP_BASE_URL:base,SESSION_COOKIE_SECURE:'false',
   AUTH_SECRET:'synthetic-local-ai-qa-secret-at-least-32-characters',PATIENT_FILE_STORAGE_DRIVER:'local',
   CODEXMED_AI_ENABLED:'true',CODEXMED_AI_PROVIDER:'ollama',CODEXMED_AI_BASE_URL:inference.origin,CODEXMED_AI_MODEL:model,CODEXMED_AI_API_KEY:''},
  stdio:['ignore',log,log],windowsHide:true});
 for(let i=0;i<90;i++){
  if(app.exitCode!==null)throw new Error('Local AI QA app exited');
  try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
  await delay(1000);
 }
 throw new Error('Local AI QA app not ready');
}
async function stop(){
 if(app&&app.exitCode===null){app.kill();await new Promise(resolve=>app.once('exit',resolve));}
 if(log!==undefined){fs.closeSync(log);log=undefined;}
}
(async()=>{try{
 try{await fetch(base,{signal:AbortSignal.timeout(1000)});throw new Error('QA port occupied');}catch(e){if(e.message==='QA port occupied')throw e;}
 const tags=await(await fetch(inference.origin+'/api/tags',{signal:AbortSignal.timeout(5000)})).json();
 assert.ok(tags.models.some(m=>m.name==='qwen3:4b'),'Preloaded owned model required');
 await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
 execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{env:{...process.env,DATABASE_URL:target.toString()},stdio:'pipe',timeout:60000,windowsHide:true});
 prisma=new PrismaClient({adapter:new PrismaPg({connectionString:target.toString()})});
 const password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex');
 const hash=['pbkdf2_sha256',310000,salt,pbkdf2Sync(password,salt,310000,32,'sha256').toString('hex')].join('$');
 const org=await prisma.organization.create({data:{name:'Synthetic local inference acceptance'}});
 await prisma.clinic.create({data:{organizationId:org.id,name:'Synthetic clinic',city:'QA',address:'QA'}});
 await prisma.user.create({data:{organizationId:org.id,email:'owner@example.test',fullName:'Synthetic owner',role:'OWNER',passwordHash:hash}});
 await start('qwen3:4b');browser=await chromium.launch();
 const context=await browser.newContext({baseURL:base,viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 page=await context.newPage();page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const {loginForBrowserAudit}=await import('./browser-login.mjs');
 await loginForBrowserAudit(page,{baseUrl:base,email:'owner@example.test',password,evidencePath:output+'/login',navigationTimeout:90000});
 async function ask(task){
  await page.goto(base+'/dashboard',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Trợ lý công việc',exact:true}).click();
  await page.getByLabel('Task muốn giao cho AI',{exact:true}).fill(task);
  await page.getByRole('button',{name:'Gửi task cho AI',exact:true}).click();
 }
 await ask('Tóm tắt số liệu đang hiển thị bằng tiếng Việt trong tối đa 2 câu. Không bịa dữ liệu; nếu thiếu dữ liệu hãy nêu rõ.');
 await page.getByRole('button',{name:'Đang phân tích…',exact:true}).waitFor();
 assert.ok(await page.getByRole('button',{name:'Đang phân tích…',exact:true}).isDisabled());
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});await page.screenshot({path:`${output}/pending-${width}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 }
 await page.waitForURL(/notice=module-ai-(?:ready|failed)/,{timeout:120000});
 const run=await prisma.aiRun.findFirstOrThrow({where:{organizationId:org.id},orderBy:{createdAt:'desc'}});
 fs.writeFileSync(output+'/synthetic-result.json',JSON.stringify({input:run.input,output:run.output,error:run.error,tokens:run.totalTokens},null,2));
 assert.equal(run.status,'SUCCEEDED',run.error||'local inference must complete');assert.equal(run.provider,'ollama');assert.equal(run.model,'qwen3:4b');
 assert.equal(typeof run.output.answer,'string');assert.match(run.output.answer,/[\u00c0-\u1eff]/);
 for(const field of ['takeaways','suggestedActions','caveats'])assert.ok(Array.isArray(run.output[field]));
 const grounded=JSON.stringify(run.output);
 assert.match(grounded,/(?:0\s+(?:(?:lịch|lượt|buổi|cuộc) hẹn|lượt khám)|không có (?:(?:lịch|lượt|buổi|cuộc) hẹn|lượt khám)|(?:(?:lịch|lượt|buổi|cuộc) hẹn|lượt khám)[^0-9".]{0,20}0)/iu,'Zero-appointment fixture must produce a grounded count');
 assert.doesNotMatch(grounded,/(?:[1-9][0-9]*|bốn)\s+(?:(?:lịch|lượt|buổi|cuộc) hẹn|lượt khám)/iu,'Task counts must not become appointments');
 assert.ok(!run.rawOutput.includes('<think>'));
 await page.locator('.accounting-ai-result').waitFor();
 await page.getByText('Đã có gợi ý',{exact:true}).waitFor();
 assert.equal(await page.getByText('Chưa hoàn tất thao tác. Kiểm tra thông tin và thử lại.',{exact:true}).count(),0);
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});await page.screenshot({path:`${output}/success-${width}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 }
 await stop();await start('missing-local-acceptance:qa');
 await ask('Tóm tắt dữ liệu thử nghiệm bằng tiếng Việt.');await page.waitForURL(/notice=module-ai-failed/,{timeout:90000});
 await page.getByText(/Chưa tạo được gợi ý/).waitFor();
 const failed=await prisma.aiRun.findFirstOrThrow({where:{organizationId:org.id},orderBy:{createdAt:'desc'}});
 assert.equal(failed.status,'FAILED');assert.ok(!failed.error.includes('synthetic-local-ai-qa-secret'));
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});await page.screenshot({path:`${output}/unavailable-${width}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 }
 assert.equal(await prisma.patient.count(),0);assert.equal(await prisma.payment.count(),0);assert.equal(await prisma.receipt.count(),0);assert.equal(await prisma.invoice.count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS full app with actual owned local model: Vietnamese JSON draft and usage, unavailable-model recovery, unchanged clinical/financial tables, 1440/390/320.');
}catch(e){if(page&&!page.isClosed())await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});throw e;}
finally{
 await browser?.close();await stop();await prisma?.$disconnect();
 if(created){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await admin.query(`DROP DATABASE "${name}"`);}
 await admin.end();
}})().catch(e=>{console.error(e);process.exitCode=1});
