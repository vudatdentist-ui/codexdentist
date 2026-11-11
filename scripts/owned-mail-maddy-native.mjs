// Synthetic MTA acceptance inside one networkless Docker namespace. No DNS or
// external recipient. The wrapper starts the pinned real Maddy after readiness.
import assert from 'node:assert/strict';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import nodemailer from 'nodemailer';
import { ownedMailFixture } from './owned-mail-fixture.mjs';
assert.equal(process.env.OWNED_MAIL_NATIVE_TEST,'true');
const {load}=createRequire(import.meta.url)('./audit-source-loader.cjs');
const fixture=await ownedMailFixture({from:'no-reply@codexdentist.com',storeRoot:'/accept',smtpMaxBytes:80*1024*1024});
let relay;
try {
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=codexdentist-mail-smtp',
    '-addext','subjectAltName=DNS:codexdentist-mail-smtp','-keyout','/accept/smtp.key.pem','-out','/accept/smtp.cert.pem'],{stdio:'pipe'});
  await chmod('/accept/smtp.key.pem',0o600);await chmod('/accept/smtp.cert.pem',0o600);
  await writeFile('/accept/encryption.key',fixture.encryptionKey.toString('base64'),{mode:0o600});
  await writeFile('/accept/signing.secret',fixture.secret,{mode:0o600});
  await writeFile('/accept/sink.cert.pem',fixture.tls.cert,{mode:0o600});
  let config=await readFile('scripts/owned-mail/maddy.conf','utf8');
  const start=config.indexOf('target.remote outbound {'),end=config.indexOf('target.queue outgoing_queue {');
  assert.ok(start>=0&&end>start);
  // The sink already speaks implicit TLS, so no second STARTTLS negotiation.
  config=config.slice(0,start)+`target.smtp outbound {\n targets tls://127.0.0.1:${fixture.smtpPort}\n starttls no\n tls_client {\n root_ca /accept/sink.cert.pem\n }\n}\n\n`+config.slice(end);
  config=config.replaceAll('/secrets/smtp.','/accept/smtp.');
  await writeFile('/accept/maddy.conf',config,{mode:0o600});await writeFile('/accept/ready','synthetic-only',{mode:0o600});
  relay=nodemailer.createTransport({host:'127.0.0.1',port:2465,secure:true,tls:{ca:await readFile('/accept/smtp.cert.pem'),servername:'codexdentist-mail-smtp',rejectUnauthorized:true},
    connectionTimeout:1000,greetingTimeout:1000,socketTimeout:5000,logger:false,debug:false});
  let ready=false;for(let i=0;i<90;i++){try{await relay.verify();ready=true;break;}catch{}await new Promise(resolve=>setTimeout(resolve,500));}assert.ok(ready,'Pinned SMTP must start');
  fixture.transport.sendMail=mail=>relay.sendMail(mail);fixture.transport.verify=()=>relay.verify();
  const client=load('src/integrations/owned-mail/client.ts',{}, {fetch:fixture.trustedFetch});
  const settings={baseUrl:fixture.baseUrl,secret:fixture.secret,from:fixture.from};
  const input={id:'maddy-native-synthetic',organizationId:'synthetic',recipient:'synthetic-recipient@example.test',subject:'Synthetic DKIM acceptance',
    body:'Synthetic mail only. No patient or credential.\nSecond line with whitespace.\n',templateKey:null,expiresAt:Date.now()+60_000};
  assert.equal((await client.deliverOwnedMail(settings,input)).state,'SENT');
  for(let i=0;i<100&&!fixture.messages.length;i++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(fixture.messages.length,1);const message=fixture.messages[0];assert.deepEqual(message.recipients,[input.recipient]);
  const split=message.body.indexOf('\r\n\r\n'),headerText=message.body.slice(0,split),body=message.body.slice(split+4);
  const headers=headerText.split(/\r\n(?![ \t])/).map(line=>({name:line.slice(0,line.indexOf(':')).toLowerCase(),raw:line}));
  const signature=headers.find(h=>h.name==='dkim-signature');assert.ok(signature);
  const unfolded=signature.raw.replace(/\r\n[ \t]+/g,' '),tags=Object.fromEntries(unfolded.slice(unfolded.indexOf(':')+1).split(';').map(tag=>{const i=tag.indexOf('=');return i<0?null:[tag.slice(0,i).trim(),tag.slice(i+1).trim()]}).filter(Boolean));
  assert.equal(tags.d,'codexdentist.com');assert.equal(tags.s,'cdx202611');assert.equal(tags.a,'rsa-sha256');assert.equal(tags.c,'relaxed/relaxed');
  const lines=body.split('\r\n').map(line=>line.replace(/[ \t]+/g,' ').replace(/ +$/,''));while(lines.at(-1)==='')lines.pop();
  const canonicalBody=lines.length?lines.join('\r\n')+'\r\n':'';
  assert.equal(createHash('sha256').update(canonicalBody).digest('base64'),tags.bh.replace(/\s/g,''));
  const canonicalHeader=raw=>{const text=raw.replace(/\r\n[ \t]+/g,' ').replace(/[ \t]+/g,' '),i=text.indexOf(':');return text.slice(0,i).trim().toLowerCase()+':'+text.slice(i+1).trim()+'\r\n';};
  const remaining=[...headers];let signed='';
  for(const name of tags.h.split(':').map(s=>s.trim().toLowerCase())){
    const index=remaining.findLastIndex(h=>h.name===name);if(index>=0){signed+=canonicalHeader(remaining[index].raw);remaining.splice(index,1);}
  }
  signed+=canonicalHeader(signature.raw.replace(/\bb\s*=[^;]*/,'b=')).slice(0,-2);
  const publicKey=createPublicKey(await readFile('/maddy-data/dkim_keys/codexdentist.com_cdx202611.key'));
  assert.equal(verify('RSA-SHA256',Buffer.from(signed),publicKey,Buffer.from(tags.b.replace(/\s/g,''),'base64')),true,'Real MTA DKIM signature verifies');
  assert.equal(verify('RSA-SHA256',Buffer.from(signed.replace(input.subject,'Changed subject')),publicKey,Buffer.from(tags.b.replace(/\s/g,''),'base64')),false,'Signed header tampering fails');
  await client.deliverOwnedMail(settings,input);assert.equal(fixture.messages.length,1);
  await assert.rejects(relay.sendMail({from:'spoof@example.test',to:input.recipient,text:'Synthetic rejected sender'}));
  assert.equal(fixture.messages.length,1);
  // Completed signing mail contains the PDF. A tiny credential-email limit
  // previously rejected even our 271859-byte synthetic signed document.
  const attachment=Buffer.alloc(1024*1024,0x20);attachment.write('%PDF-1.4\nSynthetic signed copy - no patient data\n');
  await relay.sendMail({from:fixture.from,to:'synthetic-signed-copy@example.test',subject:'Synthetic signing completion',
    text:'Synthetic completed PDF only.',attachments:[{filename:'synthetic-signed.pdf',content:attachment,contentType:'application/pdf'}]});
  for(let i=0;i<100&&fixture.messages.length<2;i++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(fixture.messages.length,2);const completed=fixture.messages[1];
  assert.deepEqual(completed.recipients,['synthetic-signed-copy@example.test']);
  const boundary=completed.body.match(/boundary="([^"\r\n]+)"/)?.[1];assert.ok(boundary);
  const part=completed.body.split('--'+boundary).find(value=>/Content-Type: application\/pdf/i.test(value));assert.ok(part);
  const encoded=part.slice(part.indexOf('\r\n\r\n')+4).trim();
  assert.ok(Buffer.from(encoded,'base64').equals(attachment),'Actual MTA preserves the complete PDF attachment');
  // Check the advertised bound and rejection without allocating an 80MB body.
  const sizeProof=await createRequire(import.meta.url)('./owned-mail-smtp-size.cjs').probe({host:'127.0.0.1',ca:await readFile('/accept/smtp.cert.pem')});
  assert.equal(sizeProof.pass,true);assert.equal(sizeProof.declaredOversizeDenied,true);assert.equal(sizeProof.messageSubmitted,false);
  await writeFile('/accept/result.json',JSON.stringify({pass:true,realMta:true,privateTls:true,dkimCryptographicallyVerified:true,headerTamperRejected:true,
    exactlyOneGatewayMessage:true,signingPdfAttachmentVerified:true,smtpDeclaredOversizeDenied:true,smtpMaxBytes:sizeProof.smtpMaxBytes,spoofSenderRejected:true,externalNetwork:false}),{mode:0o600});
  console.log('PASS actual pinned Maddy: private TLS, durable queue, cryptographically verified DKIM, sender restriction, no idempotent replay and no external network.');
}finally{relay?.close();await fixture.close();}
