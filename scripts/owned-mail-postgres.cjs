const assert=require('node:assert/strict'),{randomBytes}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {Client}=require('pg'),{PrismaClient}=require('@prisma/client'),{PrismaPg}=require('@prisma/adapter-pg');
const {load}=require('./audit-source-loader.cjs');
const source=process.env.DATABASE_URL&&new URL(process.env.DATABASE_URL);
assert.ok(process.env.NODE_ENV==='test'&&source&&['127.0.0.1','localhost','[::1]'].includes(source.hostname)&&
 ![...source.searchParams.keys()].some(key=>/^(host|hostaddr|database|dbname|port|service|connectionstring)$/i.test(key)));
const name='owned_mail_test_'+randomBytes(8).toString('hex'),target=new URL(source);target.pathname='/'+name;
const admin=new Client({connectionString:source.toString()});let created=false,db,fixture;
(async()=>{try{
 await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
 execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{env:{...process.env,DATABASE_URL:target.toString()},stdio:'pipe',timeout:60000,windowsHide:true});
 db=new PrismaClient({adapter:new PrismaPg({connectionString:target.toString()})});
 const {ownedMailFixture}=await import('./owned-mail-fixture.mjs');fixture=await ownedMailFixture();
 const org=await db.organization.create({data:{name:'Synthetic owned mail races'}});
 const demo=await db.organization.create({data:{name:'Synthetic demo mail denial',isDemo:true}});
 const other=await db.organization.create({data:{name:'Synthetic other mail scope'}});
 const config={baseUrl:fixture.baseUrl,secret:fixture.secret,from:fixture.from};
 const service=load('src/lib/notifications.ts',{'@/lib/prisma':{prisma:db},'@/lib/env':{
  notificationDeliveryMode:()=> 'owned-mail',notificationBatchLimit:()=>20,ownedMailConfig:()=>config,
 }},{fetch:fixture.trustedFetch});
 async function notice(data={}){return db.notification.create({data:{organizationId:org.id,channel:'EMAIL',status:'SCHEDULED',
  recipient:'synthetic@example.test',subject:'Synthetic mail race',body:'Synthetic body',...data}});}
 const first=await notice();
 await Promise.all([service.processNotificationNow(first.id),service.processNotificationNow(first.id),service.processDueNotifications()]);
 assert.equal(fixture.messages.length,1);assert.equal((await db.notification.findUniqueOrThrow({where:{id:first.id}})).status,'SENT');
 const redacted=await notice({templateKey:'PASSWORD_RESET',body:'Redacted credential notification'});
 await service.processDueNotifications();await service.processNotificationNow(redacted.id);assert.equal(fixture.messages.length,1);
 const token='PRIVATE-'+randomBytes(32).toString('hex');await service.processNotificationNow(redacted.id,{subject:'Synthetic reset',body:'https://codexdentist.test/reset-password?token='+token});
 assert.equal(fixture.messages.length,2);assert.ok(!(await db.notification.findUniqueOrThrow({where:{id:redacted.id}})).body.includes(token));
 fixture.setMode('lost');const lost=await notice();await service.processNotificationNow(lost.id);
 assert.equal(fixture.messages.length,3);assert.equal((await db.notification.findUniqueOrThrow({where:{id:lost.id}})).status,'PROCESSING');
 await Promise.all([service.processNotificationNow(lost.id),service.processDueNotifications()]);assert.equal(fixture.messages.length,3);
 fixture.setMode('accept');const foreign=await notice({organizationId:other.id,status:'PROCESSING'});
 // A valid signed receipt belonging to another organization cannot finalize it.
 const identity={id:foreign.id,organizationId:org.id};
 const client=load('src/integrations/owned-mail/client.ts',{}, {fetch:fixture.trustedFetch});
 await client.deliverOwnedMail(config,{...identity,recipient:'foreign-proof@example.test',subject:'Synthetic scope',body:'Synthetic scope only',templateKey:null,expiresAt:Date.now()+60_000});
 const count=fixture.messages.length;await service.processNotificationNow(foreign.id);
 assert.equal(fixture.messages.length,count);assert.equal((await db.notification.findUniqueOrThrow({where:{id:foreign.id}})).status,'PROCESSING');
 const blocked=await notice({organizationId:demo.id});await service.processNotificationNow(blocked.id);assert.equal(fixture.messages.length,count);assert.equal((await db.notification.findUniqueOrThrow({where:{id:blocked.id}})).status,'CANCELLED');
 assert.equal(await db.patient.count(),0);assert.equal(await db.invoice.count(),0);assert.equal(await db.payment.count(),0);assert.equal(await db.receipt.count(),0);
 assert.ok(!(JSON.stringify(await db.auditLog.findMany())).includes(token));
 console.log('PASS native PostgreSQL and actual TLS SMTP: concurrent worker/immediate CAS, ephemeral credential delivery, lost-ack no replay, foreign receipt and demo denial, unchanged clinical/financial tables.');
}finally{await fixture?.close();await db?.$disconnect();if(created){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await admin.query(`DROP DATABASE "${name}"`);}await admin.end();}})().catch(e=>{console.error(e);process.exitCode=1});
