// Run only inside an isolated Linux test namespace and private disposable volume.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma.ts";
import { verifyDurableLocalRoot, resolvePrivateStoragePath } from "../src/infrastructure/patient-files/durable-root.ts";
import { createPatientFileStage, markPatientFileStageStored, markPatientFileStageCommitted } from "../src/infrastructure/patient-files/staging.ts";
import { storePatientUpload, readStoredPatientFile } from "../src/lib/patient-file-storage.ts";
assert.equal(process.env.DURABLE_FILE_NATIVE_TEST,"true");assert.equal(process.env.NODE_ENV,"test");
const dbUrl=new URL(process.env.DATABASE_URL);
assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.pathname,'/durable_files_native_test');
const root=await verifyDurableLocalRoot({probeWrite:true});
const bytes=Buffer.from('%PDF-1.7 synthetic native migration acceptance\n%%EOF\n');
const checksum=createHash('sha256').update(bytes).digest('hex');let reads=0;
const server=createServer((request,response)=>{
 assert.equal(request.method,'GET');assert.match(request.headers.authorization,/Credential=synthetic-key\//);
 reads++;response.writeHead(200,{'content-length':bytes.length,'content-type':'application/pdf'});response.end(bytes);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const environment={...process.env,PATIENT_FILE_STORAGE_DRIVER:'local',R2_ENDPOINT:`http://127.0.0.1:${server.address().port}`,
 R2_BUCKET_NAME:'synthetic-bucket',R2_ACCESS_KEY_ID:'synthetic-key',R2_SECRET_ACCESS_KEY:'synthetic-secret'};
async function migrate(file,expectedSuccess){
 const args=['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON','--experimental-transform-types','--experimental-loader','./scripts/ts-alias-loader.mjs',
  'scripts/migrate-owned-patient-file.mjs','--organization',file.organizationId,'--file',file.id,'--apply'];
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{env:environment,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
 });
 assert.equal(result.code===0,expectedSuccess,result.stderr);
 return result;
}
try{
 execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe',timeout:120000});
 const org=await prisma.organization.create({data:{name:'Synthetic native file migration'}});
 const clinic=await prisma.clinic.create({data:{organizationId:org.id,name:'Synthetic clinic',city:'QA',address:'QA'}});
 const patient=await prisma.patient.create({data:{organizationId:org.id,clinicId:clinic.id,fullName:'Synthetic patient',phone:'0000000000'}});
 const uploaded=await storePatientUpload({file:new File([bytes],'synthetic-native.pdf',{type:'application/pdf'}),
  organizationId:org.id,patientId:patient.id,patientFileId:randomUUID()});
 assert.equal(uploaded.storageProvider,'local');assert.equal(uploaded.checksumSha256,checksum);
 assert.deepEqual(await readStoredPatientFile(uploaded),bytes);
 async function fixture(hash=checksum){const id=randomUUID(),key=`patient-files/${org.id}/${patient.id}/${id}.pdf`;
  return prisma.patientFile.create({data:{id,organizationId:org.id,clinicId:clinic.id,patientId:patient.id,title:'Synthetic native file',
   url:'/protected-original',fileName:'synthetic.pdf',mimeType:'application/pdf',storageProvider:'r2',storageBucket:'synthetic-bucket',
   storageKey:key,sourceId:key,sourceType:'R2_UPLOAD',sizeBytes:bytes.length,checksumSha256:hash,virusScanStatus:'CLEAN'}});}
 const first=await fixture();
 // A discoverable active upload stage refuses commit AFTER the candidate copy.
 const stage=await createPatientFileStage(prisma,{id:randomUUID(),organizationId:org.id,clinicId:clinic.id,patientId:patient.id,
  targetPatientFileId:first.id,fileName:'synthetic.pdf',mimeType:'application/pdf',sizeBytes:bytes.length,storageProvider:'r2',storageKey:first.storageKey});
 await markPatientFileStageStored(prisma,{stageId:stage.id,checksumSha256:checksum,storageKey:first.storageKey});
 await migrate(first,false);assert.equal(reads,1);assert.equal((await prisma.patientFile.findUniqueOrThrow({where:{id:first.id}})).storageProvider,'r2');
 await markPatientFileStageCommitted(prisma,stage.id,first.id);
 const success=await migrate(first,true);assert.equal(JSON.parse(success.stdout).migrated,true);assert.equal(reads,1,'resume uses its verified candidate');
 const current=await prisma.patientFile.findUniqueOrThrow({where:{id:first.id}});
 assert.equal(current.storageProvider,'local');assert.equal(current.url,first.url);assert.equal(current.checksumSha256,checksum);
 assert.deepEqual(await readFile(await resolvePrivateStoragePath(root,current.storageKey)),bytes);
 const again=await migrate(first,true);assert.equal(JSON.parse(again.stdout).alreadyLocal,true);assert.equal(reads,1);
 const target=await resolvePrivateStoragePath(root,current.storageKey),handle=await open(target,'r+');
 try{await handle.write(Buffer.from('CORRUPTED'));await handle.sync();}finally{await handle.close();}
 await migrate(first,false);assert.equal(reads,1,'corrupt local evidence cannot be claimed complete');
 const bad=await fixture('0'.repeat(64));await migrate(bad,false);
 assert.equal((await prisma.patientFile.findUniqueOrThrow({where:{id:bad.id}})).storageProvider,'r2');assert.equal(reads,2);
 assert.equal(await prisma.auditLog.count({where:{action:'patient_file.storage_migrated'}}),1);
 assert.equal(await prisma.invoice.count(),0);assert.equal(await prisma.payment.count(),0);assert.equal(await prisma.receipt.count(),0);
 console.log('PASS native durable upload and migration CLI: actual S3 GET and private fsync, journal resume after refused commit, idempotent retry, corruption/checksum rejection, no source deletion or financial writes.');
}finally{await prisma.$disconnect();await new Promise(resolve=>server.close(resolve));}
