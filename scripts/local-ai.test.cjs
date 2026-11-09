const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./audit-source-loader.cjs');
const config=(extra={})=>load('src/lib/env.ts',{}, {process:{env:{NODE_ENV:'production',CODEXMED_AI_ENABLED:'true',CODEXMED_AI_PROVIDER:'ollama',...extra}}}).codexMedAiConfig();
const messages=[{role:'user',content:'Trả về JSON với lời chào tiếng Việt.'}];
const reply=(extra={})=>new Response(JSON.stringify({model:'qwen3:4b',done:true,done_reason:'stop',message:{content:'{"answer":"Xin chào"}',thinking:'must never be persisted'},prompt_eval_count:12,eval_count:8,...extra}),{headers:{'content-type':'application/json'}});
const client=(fetch)=>load('src/integrations/ollama/client.ts',{}, {fetch});

test('assistant outcome stays in its dialog without a false module failure banner',()=>{
 const notices=load('src/lib/action-notices.ts');
 for(const notice of ['module-ai-ready','module-ai-failed']){
  assert.equal(notices.shouldKeepActionNotice(notice),true);
  assert.equal(notices.visibleActionNoticeParam(notice),null);
 }
 assert.equal(notices.visibleActionNoticeParam('invoice-failed'),'invoice-failed');
 assert.equal(notices.visibleActionNoticeParam('task-created'),'task-created');
});

test('dashboard AI uses complete visible-clinic totals rather than preview or metric-array lengths',()=>{
 const {buildModuleAiContext}=load('src/components/suite-ai-context.ts');
 const context=buildModuleAiContext({activeView:'dashboard',visibleClinicIds:['clinic-a'],dashboardWorkspace:{
  generatedAt:'synthetic',message:null,appointments:new Array(8).fill({patientName:'unneeded PHI'}),metrics:new Array(4).fill({value:'0'}),
  clinicSummaries:[{clinicId:'clinic-a',todayAppointments:100,inChair:3,completed:12,collectedToday:123456},
   {clinicId:'clinic-b',todayAppointments:50,inChair:2,completed:7,collectedToday:999}]
 },taskInboxWorkspace:{items:[]}});
 const facts=context.workspace.dashboardFacts;
 assert.equal(facts.appointmentCountToday,100);assert.equal(facts.inChairAppointmentCount,3);assert.equal(facts.completedAppointmentCountToday,12);
 assert.equal(facts.collectedAmountVndToday,123456);assert.ok(!JSON.stringify(context).includes('unneeded PHI'));
 assert.equal(context.workspace.workQueue.availablePreviewItemCount,0);
 const absent=buildModuleAiContext({activeView:'dashboard'});assert.equal(absent.workspace.dashboardFacts.available,false);
});

test('owned local AI requires no cloud key and never returns a stale configured key',()=>{
 const value=config({CODEXMED_AI_API_KEY:'old-cloud-key'});
 assert.equal(value.apiKey,'');assert.equal(value.model,'qwen3:4b');assert.equal(value.baseUrl,'http://codexdentist-ollama:11434');
 for(const url of ['http://127.0.0.1:11434','http://[::1]:11434','http://localhost:24806'])assert.equal(config({CODEXMED_AI_BASE_URL:url}).baseUrl,url);
});

test('local-only selection rejects cloud, remote, redirected base paths and embedded credentials',()=>{
 for(const url of ['https://ollama.com','https://codexdentist-ollama:11434','http://remote.example.test:11434',
  'http://codexdentist-ollama:11434.evil.test','http://user:secret@localhost:11434',
  'http://localhost:11434/v1','http://localhost:11434?target=remote','http://localhost:11434/#remote']){
  assert.throws(()=>config({CODEXMED_AI_BASE_URL:url}));
 }
 for(const model of ['qwen3:cloud','qwen3-cloud','https://remote/model','../model'])assert.throws(()=>config({CODEXMED_AI_MODEL:model}));
 assert.throws(()=>config({CODEXMED_AI_PROVIDER:'openai-compatible',CODEXMED_AI_BASE_URL:'https://api.example.test/v1'}),/API_KEY/);
});

test('local request uses bounded native JSON inference without authorization, tools or thinking',async()=>{
 let observed;
 const c=client(async(url,init)=>{observed={url,init};return reply()});
 const result=await c.generateLocalAiJson(config(),messages,AbortSignal.timeout(1000));
 assert.equal(observed.url,'http://codexdentist-ollama:11434/api/chat');
 assert.equal(observed.init.redirect,'error');assert.equal(observed.init.cache,'no-store');
 assert.equal(observed.init.headers.Authorization,undefined);
 const body=JSON.parse(observed.init.body);assert.equal(body.stream,false);assert.equal(body.think,false);assert.equal(body.format,'json');
 assert.equal(body.options.num_thread,3);assert.equal(body.options.num_ctx,8192);assert.equal(body.options.num_predict,1024);assert.equal(body.tools,undefined);
 assert.equal(result.content,'{"answer":"Xin chào"}');assert.equal(result.usage.totalTokens,20);assert.ok(!JSON.stringify(result).includes('thinking'));
});

test('oversized local context fails before I/O instead of silently truncating the selected records',async()=>{
 let calls=0;const c=client(async()=>{calls++;return reply()});
 await assert.rejects(c.generateLocalAiJson(config(),[{role:'user',content:'ệ'.repeat(9000)}],AbortSignal.timeout(1000)),/context exceeds/);
 assert.equal(calls,0);
});

test('incomplete, truncated, wrong-model and empty generations are rejected',async()=>{
 for(const value of [{done:false},{done_reason:'length'},{model:'remote:cloud'},{message:{content:''}},{message:{content:{answer:'invalid'}}}]){
  await assert.rejects(client(async()=>reply(value)).generateLocalAiJson(config(),messages,AbortSignal.timeout(1000)),/did not complete/);
 }
});

test('provider error echoes and malformed bodies cannot enter persisted errors',async()=>{
 const {readAiProviderJson}=load('src/integrations/ai-http.ts');
 const secret='PHI-and-secret-must-not-escape';
 for(const response of [new Response(secret,{status:502}),new Response(secret,{headers:{'content-type':'text/html'}}),
  new Response(secret,{headers:{'content-type':'application/json'}}),new Response(JSON.stringify('a'.repeat(524288)),{headers:{'content-type':'application/json'}})]){
  await assert.rejects(readAiProviderJson(response),e=>!e.message.includes(secret));
 }
});

test('local failure never falls back to the configured cloud key or endpoint',async()=>{
 let calls=0;
 const ai=load('src/lib/ai-provider.ts',{'@/lib/env':{codexMedAiConfig:()=>config()}},{AbortController,
  fetch:async()=>{calls++;return new Response('echoed patient data',{status:503})}});
 await assert.rejects(ai.generateAiJson(messages),/HTTP 503/);assert.equal(calls,1);
});

test('local structured result retains operational usage without thinking output',async()=>{
 const ai=load('src/lib/ai-provider.ts',{'@/lib/env':{codexMedAiConfig:()=>config()}},{AbortController,fetch:async()=>reply()});
 const result=await ai.generateAiJson(messages);assert.equal(result.output.answer,'Xin chào');assert.equal(result.provider,'ollama');assert.equal(result.usage.totalTokens,20);
});

test('native generation receives the requested schema and rejects input echoes before success',async()=>{
 const {moduleAiOutputSchema,validateModuleAiOutput}=load('src/features/ai/module-output.ts');
 let format;
 const ai=load('src/lib/ai-provider.ts',{'@/lib/env':{codexMedAiConfig:()=>config()}},{AbortController,fetch:async(_url,init)=>{
  format=JSON.parse(init.body).format;
  return reply({message:{content:JSON.stringify({answer:'Xin chào',takeaways:[],suggestedActions:[],caveats:[]})}});
 }});
 const result=await ai.generateAiJson(messages,{schema:moduleAiOutputSchema});
 assert.equal(format.type,'object');assert.equal(format.additionalProperties,false);assert.ok(format.required.includes('answer'));
 validateModuleAiOutput(result.output);
 for(const output of [{task:'echo'},[],null,{answer:'',takeaways:[],suggestedActions:[],caveats:[]},
  {answer:'invalid',takeaways:[{text:'unexpected'}],suggestedActions:[],caveats:[]}])assert.throws(()=>validateModuleAiOutput(output));
 const {validateAccountingAiAnalysis}=load('src/features/accounting/ai-output.ts');
 validateAccountingAiAnalysis({summary:'Synthetic summary',alerts:[],actions:[],questions:[],caveats:[]});
 for(const output of [{task:'echo'},{summary:'bad',alerts:[{severity:'danger'}],actions:[],questions:[],caveats:[]}])assert.throws(()=>validateAccountingAiAnalysis(output));
});

test('actual HTTP redirect cannot forward a prompt to a second endpoint',async()=>{
 const http=require('node:http');let first=0,forwarded=0;
 const server=http.createServer((req,res)=>{
  if(req.url==='/api/chat'){first++;res.writeHead(307,{location:'/unexpected-destination'}).end();}
  else{forwarded++;res.writeHead(200,{'content-type':'application/json'}).end('{}');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const c=client(fetch);
  await assert.rejects(c.generateLocalAiJson({baseUrl:`http://127.0.0.1:${server.address().port}`,model:'qwen3:4b'},messages,AbortSignal.timeout(5000)));
  assert.equal(first,1);assert.equal(forwarded,0);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
