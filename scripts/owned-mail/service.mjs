import { createServer } from 'node:https';
import { createHash } from 'node:crypto';
import { authenticateMailRequest, parseMailEnvelope, parseMailIdentity, parseMailJson, fingerprint, MAX_MAIL_BYTES, MailFault } from './protocol.mjs';

export function createOwnedMailService({ tls, secret, sender, store, transport, testOnly = false, now = Date.now }) {
  let active = 0;
  function reply(response, status, body) {
    response.writeHead(status, { 'content-type':'application/json', 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
    response.end(JSON.stringify(body));
  }
  async function readBody(request) {
    const parts=[];let size=0;
    for await (const chunk of request) {
      size+=chunk.length;if(size>MAX_MAIL_BYTES)throw new MailFault('mail-request-too-large',413);
      parts.push(chunk);
    }
    return Buffer.concat(parts);
  }
  const server=createServer({ ...tls, minVersion:'TLSv1.2' },async(request,response)=>{
    try {
      if (!['/ready','/v1/deliver','/v1/status'].includes(request.url) ||
          request.method !== (request.url==='/ready'?'GET':'POST')) throw new MailFault('mail-route-not-found',404);
      if(active>=8)throw new MailFault('mail-busy',503);
      active++;
      try {
        const bytes=await readBody(request),key=request.headers['idempotency-key'];
        authenticateMailRequest(secret,{method:request.method,pathname:request.url,key,bytes,
          timestamp:request.headers['x-codexdentist-timestamp'],signature:request.headers['x-codexdentist-signature']},now());
        if(request.url==='/ready'){
          if(key!=='readiness'||bytes.length)throw new MailFault('mail-request-invalid');
          store.checkpoint();await transport.verify();reply(response,200,{ready:true,testOnly});return;
        }
        if(!request.headers['content-type']?.startsWith('application/json'))throw new MailFault('mail-json-required',415);
        const value=parseMailJson(bytes),identity=parseMailIdentity(value);
        if(key!=='notification/'+identity.id)throw new MailFault('mail-identity-mismatch',401);
        if(request.url==='/v1/status'){
          if(Object.keys(value).some(k=>!['id','organizationId'].includes(k)))throw new MailFault('mail-status-invalid');
          const receipt=store.status(identity,now());reply(response,receipt?200:404,receipt??{code:'mail-not-found'});return;
        }
        const envelope=parseMailEnvelope(value,sender,{testOnly,now:now()});
        store.reserve(envelope,fingerprint(Buffer.from(JSON.stringify(envelope))),now());
        const claim=store.claim(identity,now());
        if(claim){
          let state='UNCERTAIN',code='mail-smtp-uncertain';
          try {
            const accepted=await transport.sendMail({from:sender,to:envelope.recipient,subject:envelope.subject,text:envelope.body,
              envelope:{from:sender,to:[envelope.recipient]},
              messageId:'<'+createHash('sha256').update(identity.organizationId+'/'+identity.id).digest('hex')+'@'+sender.split('@')[1]+'>',
              disableFileAccess:true,disableUrlAccess:true});
            if(accepted.accepted?.length===1 && (!accepted.rejected||accepted.rejected.length===0)) {state='SENT';code=null;}
          } catch(error) {
            // A final explicit SMTP rejection proves non-acceptance. Lost DATA
            // acknowledgements never become a retryable reservation.
            if(Number.isInteger(error?.responseCode)&&error.responseCode>=500&&error.responseCode<=599){state='REJECTED';code='mail-smtp-rejected';}
          }
          store.finish(identity,claim.lease,state,code,now());
        }
        const receipt=store.status(identity,now());
        reply(response,receipt.state==='SENT'?200:receipt.state==='REJECTED'?422:202,receipt);
      } finally {active--;}
    } catch(error) {
      reply(response,error instanceof MailFault?error.status:503,{code:error instanceof MailFault?error.code:'mail-service-unavailable'});
    }
  });
  server.requestTimeout=15_000;server.headersTimeout=10_000;server.keepAliveTimeout=5000;
  return server;
}
