import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { openMailStore } from './store.mjs';
import { createOwnedMailService } from './service.mjs';
import { safeEmailAddress } from './protocol.mjs';

process.umask(0o077);
function privateFile(name){
  const target=process.env[name];if(!target||!path.isAbsolute(target))throw Error('mail-private-configuration-invalid');
  const info=lstatSync(target);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0)throw Error('mail-private-configuration-invalid');
  return readFileSync(target);
}
try {
  const root=process.env.OWNED_MAIL_DATA_ROOT;
  if(!root||!path.isAbsolute(root)||process.platform!=='linux'||!process.getuid?.()||realpathSync(root)!==root)throw Error('mail-volume-invalid');
  const info=lstatSync(root);
  if(!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o777)!==0o700)throw Error('mail-volume-invalid');
  const {hasDurableMount}=await import('../../src/infrastructure/patient-files/durable-root.ts');
  if(!hasDurableMount(root,readFileSync('/proc/self/mountinfo','utf8')))throw Error('mail-volume-invalid');
  const secret=privateFile('OWNED_MAIL_SIGNING_SECRET_FILE').toString('utf8').trim();
  const encryptionKey=Buffer.from(privateFile('OWNED_MAIL_ENCRYPTION_KEY_FILE').toString('utf8').trim(),'base64');
  if(secret.length<32||encryptionKey.length!==32)throw Error('mail-key-invalid');
  const sender=safeEmailAddress(process.env.OWNED_MAIL_FROM);
  const host=process.env.OWNED_MAIL_SMTP_HOST;
  if(!['codexdentist-mail-smtp','127.0.0.1'].includes(host))throw Error('mail-smtp-origin-invalid');
  const port=Number(process.env.OWNED_MAIL_SMTP_PORT||'2465');if(!Number.isInteger(port)||port<1024||port>65535)throw Error('mail-smtp-port-invalid');
  const transport=nodemailer.createTransport({host,port,secure:true,name:'mail.codexdentist.com',
    tls:{ca:privateFile('OWNED_MAIL_SMTP_CA_FILE'),servername:'codexdentist-mail-smtp',rejectUnauthorized:true,minVersion:'TLSv1.2'},
    connectionTimeout:8000,greetingTimeout:8000,socketTimeout:20_000,logger:false,debug:false,
    disableFileAccess:true,disableUrlAccess:true});
  const store=openMailStore(path.join(root,'queue.sqlite'),encryptionKey);
  const server=createOwnedMailService({tls:{key:privateFile('OWNED_MAIL_TLS_KEY_FILE'),cert:privateFile('OWNED_MAIL_TLS_CERT_FILE')},
    secret,sender,store,transport,testOnly:process.env.OWNED_MAIL_TEST_ONLY!=='false'});
  server.listen(3443,'0.0.0.0',()=>console.log('Owned mail gateway ready; private TLS and encrypted idempotency store.'));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>{transport.close();store.close();process.exit(0)});setTimeout(()=>process.exit(1),25_000).unref();});
}catch {console.error('Owned mail gateway refused unsafe configuration.');process.exitCode=1;}
