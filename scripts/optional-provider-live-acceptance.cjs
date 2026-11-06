// Actual community HTTP contracts through an owned SSH loopback tunnel.
// Credentials are projected from separate QA accounts/projects, never production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { load } = require('./audit-source-loader.cjs');
const config = JSON.parse(fs.readFileSync(process.env.OPTIONAL_QA_CREDENTIALS_FILE || 'output/optional-services-qa-credentials.json','utf8'));
assert.ok(process.env.NODE_ENV === 'test' && config.qaOnly === true);
for (const provider of ['orthanc','chatwoot','medplum','novu']) assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(config[provider].baseUrl).hostname));
const env = { OPTIONAL_PROVIDER_ALLOWED_ORIGINS: ['orthanc','chatwoot','medplum','novu'].map(key => config[key].baseUrl).join(',') };
const requests = [];
const globals = { Object, JSON, Headers, Response, Request, TextEncoder, TextDecoder,
  process: { env }, fetch: async (url, init) => {
    requests.push({ path:new URL(url).pathname, method:init.method || 'GET' });
    return fetch(url, init);
  } };
const adapter = file => load(file, {}, globals);
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
(async () => {
  const orthanc = adapter('src/integrations/orthanc/connection.ts');
  assert.match((await orthanc.verifyOrthancConnection(config.orthanc)).identity, /^orthanc:[a-f0-9]{64}$/);
  console.log('PASS actual authenticated Orthanc identity and DICOMweb capability');
  const medplum = adapter('src/integrations/medplum/client.ts');
  await medplum.verifyMedplumConnection(config.medplum);
  const identity = { system:'https://codexdentist.com/fhir/qa-only', value:randomUUID() };
  const resource = { resourceType:'Patient', identifier:[identity], name:[{use:'official',text:'SYNTHETIC QA ONLY Nguyễn Tôn Nữ Minh Anh'}], gender:'unknown' };
  const first = await medplum.upsertMedplumPatient(config.medplum,resource,identity);
  const replay = await medplum.upsertMedplumPatient(config.medplum,resource,identity);
  assert.equal(first.externalId,replay.externalId);
  let readers=0, align, newerDone;
  const aligned=new Promise(resolve=>{align=resolve}), newerCommitted=new Promise(resolve=>{newerDone=resolve});
  const concurrent=load('src/integrations/medplum/client.ts',{}, {...globals,fetch:async(url,init)=>{
    if (new URL(url).pathname.endsWith('/Patient') && init.method!=='POST') {
      const response=await fetch(url,init); if(++readers===2)align(); await aligned; return response;
    }
    if(init.method==='PUT'&&JSON.parse(init.body).name[0].text==='SYNTHETIC QA older')await newerCommitted;
    return fetch(url,init);
  }});
  const older=concurrent.upsertMedplumPatient(config.medplum,{...resource,name:[{text:'SYNTHETIC QA older'}]},identity);
  const newer=concurrent.upsertMedplumPatient(config.medplum,{...resource,name:[{text:'SYNTHETIC QA newer'}]},identity).finally(()=>newerDone());
  const race=await Promise.allSettled([older,newer]);
  assert.equal(race[0].status,'rejected'); assert.match(race[0].reason.message,/medplum-identity-conflict/);
  assert.equal(race[1].status,'fulfilled');
  console.log('PASS actual project-scoped Medplum OAuth, conditional create/readback, stable retry and stale-export rejection');
  const chat = adapter('src/integrations/chatwoot/client.ts');
  await chat.verifyChatwootConnection(config.chatwoot);
  const identifier = 'cdcw_'+randomUUID(), operation = 'cdcw_'+randomUUID();
  assert.equal(await chat.findChatwootContact(config.chatwoot,identifier),null);
  const linked = await chat.createChatwootContact(config.chatwoot,identifier);
  assert.equal((await chat.findChatwootContact(config.chatwoot,identifier)).id,linked.id);
  const conversationId = await chat.createChatwootConversation(config.chatwoot,linked,operation);
  assert.ok((await chat.listChatwootConversations(config.chatwoot,linked)).some(item => item.id === conversationId && item.operation === operation));
  assert.ok(!requests.some(item => item.method === 'POST' && item.path.includes('/messages')));
  console.log('PASS actual Community Chatwoot account/inbox, opaque contact recovery and conversation readback; no message POST');
  const novu = adapter('src/integrations/novu/client.ts');
  await novu.verifyNovuConnection(config.novu);
  const workflow = await novu.verifyNovuWorkflow(config.novu), subscriber = await novu.verifyNovuSyntheticSubscriber(config.novu);
  const transactionId = randomUUID();
  await novu.triggerNovu(config.novu,{ subscriberId:config.novu.testSubscriberId,transactionId,synthetic:true });
  let sent = false;
  for (let attempt=0;attempt<30;attempt++) {
    if (await novu.observeNovuDelivery(config.novu,{transactionId,subscriberDatabaseId:subscriber.subscriberDatabaseId,workflowDatabaseId:workflow.workflowDatabaseId}) === 'SENT') { sent=true; break; }
    await delay(1000);
  }
  assert.ok(sent,'Actual Novu worker must persist authenticated sent evidence, not merely accept the trigger');
  console.log('PASS actual self-hosted Novu in-app trigger and authenticated worker delivery; no SMTP or cloud keys');
})().catch(error => { console.error(error.code || 'acceptance-failed', error.message); process.exitCode=1; });
