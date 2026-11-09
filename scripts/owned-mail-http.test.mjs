import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { request } from 'node:https';
import { ownedMailFixture } from './owned-mail-fixture.mjs';
import { mailSignature } from './owned-mail/protocol.mjs';
const {load}=createRequire(import.meta.url)('./audit-source-loader.cjs');

test('actual TLS gateway/SMTP confirms one recipient, detects lost acknowledgements and never replays uncertain mail',async()=>{
  const fixture=await ownedMailFixture();
  try{
    const client=load('src/integrations/owned-mail/client.ts',{}, {fetch:fixture.trustedFetch});
    const config={baseUrl:fixture.baseUrl,secret:fixture.secret,from:fixture.from};
    const input={id:'synthetic',organizationId:'org',recipient:'recipient@example.test',subject:'Khôi phục tài khoản',
      body:'Synthetic one-time link: https://codexdentist.test/reset-password?token=PRIVATE-SYNTHETIC',templateKey:'PASSWORD_RESET',expiresAt:Date.now()+60_000};
    const outcomes=await Promise.all([client.deliverOwnedMail(config,input),client.deliverOwnedMail(config,input)]);
    assert.equal(fixture.messages.length,1);assert.ok(outcomes.some(r=>r.state==='SENT'));
    const sent=await client.ownedMailStatus(config,input);assert.equal(sent.state,'SENT');assert.ok(sent.deliveryId);
    const again=await client.deliverOwnedMail(config,input);assert.equal(again.deliveryId,sent.deliveryId);assert.equal(fixture.messages.length,1);
    assert.deepEqual(fixture.messages[0].recipients,[input.recipient]);assert.match(fixture.messages[0].body,/PRIVATE-SYNTHETIC/);
    const serial=JSON.stringify(sent);assert.ok(!serial.includes(input.recipient)&&!serial.includes('PRIVATE'));
    assert.equal(await client.ownedMailStatus(config,{...input,organizationId:'foreign'}),null);
    await assert.rejects(client.deliverOwnedMail(config,{...input,organizationId:'foreign'}),/unavailable/);
    await assert.rejects(client.deliverOwnedMail({...config,secret:'wrong-private-signing-secret-over-32-characters'}, {...input,id:'wrong-key'}));
    assert.equal(fixture.messages.length,1);
    await assert.rejects(client.verifyOwnedMail(config),/not-live/,'test-only fixture cannot pass a production readiness gate');
    assert.ok(fixture.verifications()>=1);
    fixture.setMode('lost');const lost={...input,id:'lost'};
    assert.equal((await client.deliverOwnedMail(config,lost)).state,'UNCERTAIN');assert.equal(fixture.messages.length,2);
    assert.equal((await client.deliverOwnedMail(config,lost)).state,'UNCERTAIN');assert.equal(fixture.messages.length,2);
    fixture.setMode('reject');const rejected={...input,id:'rejected'};
    assert.equal((await client.deliverOwnedMail(config,rejected)).state,'REJECTED');assert.equal(fixture.messages.length,3);
    assert.equal((await client.deliverOwnedMail(config,rejected)).state,'REJECTED');assert.equal(fixture.messages.length,3);
    // Certificate verification remains enabled; an unrelated CA cannot connect.
    await assert.rejects(new Promise((resolve,reject)=>{
      const req=request(fixture.baseUrl+'/ready',{rejectUnauthorized:true},resolve);req.on('error',reject);req.end();
    }));
    const timestamp=String(Math.floor(Date.now()/1000)),body=JSON.stringify({...input,id:'injection',subject:'bad\r\nBcc: other@example.test',channel:'EMAIL',from:fixture.from});
    const signature=mailSignature(fixture.secret,{timestamp,method:'POST',pathname:'/v1/deliver',key:'notification/injection',bytes:Buffer.from(body)});
    const invalid=await fixture.trustedFetch(fixture.baseUrl+'/v1/deliver',{method:'POST',body,
      headers:{'content-type':'application/json','idempotency-key':'notification/injection','x-codexdentist-timestamp':timestamp,'x-codexdentist-signature':signature}});
    assert.equal(invalid.status,400);assert.equal(fixture.messages.length,3);
  }finally{await fixture.close();}
});
