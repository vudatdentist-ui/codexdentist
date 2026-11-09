import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, realpath, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { openMailStore } from './owned-mail/store.mjs';
import { authenticateMailRequest, mailSignature, parseMailEnvelope, fingerprint } from './owned-mail/protocol.mjs';

const now=Date.now(),sender='no-reply@example.test',secret='synthetic-owned-mail-signing-key-at-least-32-characters';
const envelope=(id='notification')=>({id,organizationId:'org',channel:'EMAIL',from:sender,recipient:'recipient@example.test',subject:'Kiểm tra miễn phí',
 body:'PRIVATE-RESET-TOKEN-'+ 'a'.repeat(60),templateKey:'PASSWORD_RESET',expiresAt:now+60_000});
const hash=mail=>fingerprint(Buffer.from(JSON.stringify(mail)));

test('authenticated envelope binds method, path, identity, exact bytes and a bounded time window',()=>{
 const request={timestamp:String(Math.floor(now/1000)),method:'POST',pathname:'/v1/deliver',key:'notification/notification',bytes:Buffer.from(JSON.stringify(envelope()))};
 request.signature=mailSignature(secret,request);authenticateMailRequest(secret,request,now);
 for(const change of [{method:'GET'},{pathname:'/v1/status'},{key:'notification/foreign'},
  {bytes:Buffer.from(JSON.stringify({...envelope(),recipient:'other@example.test'}))},{signature:'0'.repeat(64)},{timestamp:'not-a-timestamp'}]){
  assert.throws(()=>authenticateMailRequest(secret,{...request,...change},now),/unauthorized/);
 }
 assert.throws(()=>authenticateMailRequest(secret,request,now+301_000),/unauthorized/);
 assert.throws(()=>authenticateMailRequest('other-synthetic-key-at-least-32-characters',request,now),/unauthorized/);
});

test('SMTP headers, sender, external test recipients and unsupported payloads fail before dispatch',()=>{
 assert.deepEqual(parseMailEnvelope(envelope(),sender,{now,testOnly:true}),envelope());
 for(const change of [{subject:'Header\r\nBcc: private@example.test'},{recipient:'a@example.test\r\nRCPT TO:other@example.test'},
  {from:'spoof@example.test'},{channel:'SMS'},{attachment:{path:'/private'}},{body:'nul\0secret'},
  {recipient:'real@gmail.com'},{expiresAt:now-1},{expiresAt:now+25*60*60*1000}]){
  assert.throws(()=>parseMailEnvelope({...envelope(),...change},sender,{now,testOnly:true}));
 }
});

async function fixture(run){
 const base=await mkdtemp(path.join(os.tmpdir(),'codexdentist-owned-mail-')),filename=path.join(base,'queue.sqlite'),key=randomBytes(32);
 const store=openMailStore(filename,key);
 try{await run({base,filename,key,store});}
 finally{store.close();const resolved=path.resolve(base);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'codexdentist-owned-mail-'));
  assert.equal(await realpath(base),resolved);await rm(base,{recursive:true,force:true});}
}

test('idempotent reservations bind organization and complete payload while SQLite stores no plaintext recipient or credential',async()=>fixture(async({filename,store})=>{
 const mail=envelope();assert.equal(store.reserve(mail,hash(mail),now).state,'QUEUED');assert.equal(store.reserve(mail,hash(mail),now).state,'QUEUED');
 for(const changed of [{...mail,organizationId:'foreign'},{...mail,recipient:'other@example.test'},{...mail,body:'replacement'}]){
  assert.throws(()=>store.reserve(changed,hash(changed),now),/idempotency-conflict/);
 }
 assert.equal(store.status({...mail,organizationId:'foreign'},now),null);
 store.checkpoint();const bytes=await readFile(filename);
 assert.equal(bytes.includes(Buffer.from(mail.recipient)),false);assert.equal(bytes.includes(Buffer.from(mail.body)),false);
}));

test('two actual SQLite worker connections have one send lease and stale or foreign actors cannot finalize it',async()=>fixture(async({filename,key,store})=>{
 const mail=envelope();store.reserve(mail,hash(mail),now);
 const barrier=new SharedArrayBuffer(4),signals=new Int32Array(barrier),workers=[];
 const module=new URL('./owned-mail/store.mjs',import.meta.url).href;
 const code=`const{parentPort,workerData}=require('node:worker_threads');
 (async()=>{const{openMailStore}=await import(workerData.module);const s=openMailStore(workerData.filename,Buffer.from(workerData.key,'base64'));
 const barrier=new Int32Array(workerData.barrier);Atomics.add(barrier,0,1);parentPort.postMessage({ready:true});
 Atomics.wait(barrier,0,Atomics.load(barrier,0),10000);try{const c=s.claim(workerData.mail,workerData.now);parentPort.postMessage({claim:c?{lease:c.lease}:null});}finally{s.close()}})().catch(e=>{throw e});`;
 let ready=0;
 try{
  const results=await Promise.all([1,2].map(()=>new Promise((resolve,reject)=>{
   const worker=new Worker(code,{eval:true,workerData:{module,filename,key:key.toString('base64'),barrier,mail,now}});workers.push(worker);
   worker.on('message',message=>{if(message.ready){ready++;if(ready===2){Atomics.store(signals,0,3);Atomics.notify(signals,0,2);}}
    else resolve(message.claim);});worker.on('error',reject);worker.on('exit',exit=>{if(exit!==0)reject(Error('Worker failed'))});
  })));
  const winners=results.filter(Boolean);assert.equal(winners.length,1);
  assert.equal(store.finish(mail,'wrong-lease','SENT',null,now).state,'DISPATCHING');
  assert.equal(store.finish({...mail,organizationId:'foreign'},winners[0].lease,'SENT',null,now),null);
  const receipt=store.finish(mail,winners[0].lease,'SENT',null,now);assert.equal(receipt.state,'SENT');assert.ok(receipt.deliveryId);
  assert.equal(store.claim(mail,now),null);assert.equal(store.reserve(mail,hash(mail),now).deliveryId,receipt.deliveryId);
  const db=new DatabaseSync(filename);try{assert.equal(db.prepare('SELECT sealed_payload FROM mail_jobs WHERE id=?').get(mail.id).sealed_payload,null);}finally{db.close();}
 }finally{await Promise.all(workers.map(worker=>worker.terminate()));}
}));

test('crash recovery preserves uncertainty without replay, verifies a late lease, and restores only encrypted state',async()=>fixture(async({base,filename,key,store})=>{
 const mail=envelope();store.reserve(mail,hash(mail),now);const claim=store.claim(mail,now);assert.ok(claim);
 assert.equal(store.status(mail,now+121_000).state,'UNCERTAIN');assert.equal(store.claim(mail,now+121_000),null);
 store.checkpoint();const restored=path.join(base,'restored.sqlite');await copyFile(filename,restored);
 const copy=openMailStore(restored,key);try{
  assert.equal(copy.status(mail,now+121_000).state,'UNCERTAIN');assert.equal(copy.claim(mail,now+121_000),null);
  assert.equal(copy.finish(mail,claim.lease,'SENT',null,now+121_000).state,'SENT');
 }finally{copy.close();}
 assert.equal(store.status(mail,now+121_000).state,'UNCERTAIN','restoration does not mutate the original queue');
}));

test('expired reservations cannot send and damaged encrypted payloads become uncertain',async()=>fixture(async({filename,store})=>{
 const expired=envelope('expired');store.reserve(expired,hash(expired),now);
 assert.equal(store.claim(expired,now+61_000),null);assert.equal(store.status(expired,now+61_000).state,'REJECTED');
 const damaged=envelope('damaged');store.reserve(damaged,hash(damaged),now);
 const db=new DatabaseSync(filename);try{db.prepare('UPDATE mail_jobs SET sealed_payload=? WHERE id=?').run(Buffer.alloc(48,5),damaged.id);}finally{db.close();}
 assert.throws(()=>store.claim(damaged,now),/payload-unavailable/);assert.equal(store.status(damaged,now).state,'UNCERTAIN');
 assert.equal(store.claim(damaged,now),null);
}));
