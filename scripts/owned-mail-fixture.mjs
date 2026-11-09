// TLS SMTP fixture and gateway for disposable acceptance only. No remote routes.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:tls';
import { request as httpsRequest } from 'node:https';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import assert from 'node:assert/strict';
import { openMailStore } from './owned-mail/store.mjs';
import { createOwnedMailService } from './owned-mail/service.mjs';

export async function ownedMailFixture(){
  const base=await mkdtemp(path.join(os.tmpdir(),'codexdentist-mail-tls-'));
  const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  const keyPath=path.join(base,'tls.key'),certPath=path.join(base,'tls.cert');
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost',
    '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',keyPath,'-out',certPath],{stdio:'pipe',windowsHide:true});
  const tls={key:await readFile(keyPath),cert:await readFile(certPath)};
  const messages=[],sockets=new Set();let mode='accept',verifications=0;
  const smtp=createServer(tls,socket=>{
    sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    socket.setEncoding('utf8');socket.write('220 localhost synthetic fixture\r\n');
    let pending='',inData=false,body='',recipients=[];
    socket.on('data',chunk=>{pending+=chunk;if(pending.length>256*1024){socket.destroy();return;}
      let index;while((index=pending.indexOf('\r\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+2);
        if(inData){if(line!=='.'){body+=(line.startsWith('..')?line.slice(1):line)+'\r\n';continue;}
          inData=false;messages.push({recipients:[...recipients],body});
          if(mode==='lost'){socket.destroy();return;}
          if(mode==='reject'){socket.write('550 synthetic final rejection\r\n');continue;}
          socket.write('250 queued synthetic-only\r\n');continue;
        }
        const command=line.split(' ',1)[0].toUpperCase();
        if(command==='EHLO'||command==='HELO'){verifications++;socket.write('250-localhost\r\n250 SIZE 65536\r\n');}
        else if(command==='MAIL'){recipients=[];body='';socket.write('250 sender accepted\r\n');}
        else if(command==='RCPT'){
          const address=line.match(/<([^>]+)>/)?.[1];
          if(!address||!/@[^@]+\.(test|invalid)$/.test(address)){socket.write('550 test recipient only\r\n');continue;}
          recipients.push(address);socket.write('250 recipient accepted\r\n');
        }else if(command==='DATA'){inData=true;socket.write('354 end with dot\r\n');}
        else if(command==='QUIT'){socket.end('221 bye\r\n');}
        else if(command==='RSET'||command==='NOOP')socket.write('250 ok\r\n');
        else socket.write('502 unsupported synthetic command\r\n');
      }
    });
  });
  await new Promise(resolve=>smtp.listen(0,'127.0.0.1',resolve));
  const transport=nodemailer.createTransport({host:'127.0.0.1',port:smtp.address().port,secure:true,
    tls:{ca:tls.cert,servername:'localhost',rejectUnauthorized:true},connectionTimeout:2000,greetingTimeout:2000,socketTimeout:3000,
    logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
  const store=openMailStore(path.join(base,'queue.sqlite'),randomBytes(32));
  const secret=randomBytes(32).toString('hex'),from='no-reply@example.test';
  const gateway=createOwnedMailService({tls,secret,sender:from,store,transport,testOnly:true});
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  const baseUrl='https://127.0.0.1:'+gateway.address().port;
  function trustedFetch(url,options={}){
    const target=new URL(url);assert.equal(target.origin,baseUrl);
    return new Promise((resolve,reject)=>{
      const req=httpsRequest(target,{method:options.method??'GET',headers:options.headers,ca:tls.cert,rejectUnauthorized:true,signal:options.signal},res=>{
        const chunks=[];res.on('data',part=>chunks.push(part));res.on('error',reject);
        res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
      });req.on('error',reject);req.end(options.body);
    });
  }
  return {baseUrl,secret,from,certPath,store,messages,base,transport,tls,trustedFetch,
    setMode(value){assert.ok(['accept','lost','reject'].includes(value));mode=value;},
    verifications:()=>verifications,
    async close(){
      gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));transport.close();
      for(const socket of sockets)socket.destroy();await new Promise(resolve=>smtp.close(resolve));store.close();
      const resolved=path.resolve(base);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'codexdentist-mail-tls-'));
      assert.equal(await realpath(base),resolved);await rm(base,{recursive:true,force:true});
    },
  };
}
