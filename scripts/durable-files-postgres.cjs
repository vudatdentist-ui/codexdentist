const assert=require('node:assert/strict');
const {randomBytes,createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {Client}=require('pg'),{PrismaClient}=require('@prisma/client'),{PrismaPg}=require('@prisma/adapter-pg');
const {load}=require('./audit-source-loader.cjs');
const {commitLocalFileMigration}=load('src/infrastructure/patient-files/local-migration.ts');
const {stageExpiredPatientFiles}=load('src/infrastructure/patient-files/staging.ts');
const source=process.env.DATABASE_URL&&new URL(process.env.DATABASE_URL);
assert.ok(process.env.NODE_ENV==='test'&&source&&['127.0.0.1','localhost','[::1]'].includes(source.hostname)&&
 ![...source.searchParams.keys()].some(k=>/^(host|hostaddr|database|dbname|port|service|connectionstring)$/i.test(k)));
const name='durable_files_test_'+randomBytes(8).toString('hex'),target=new URL(source);target.pathname='/'+name;
const admin=new Client({connectionString:source.toString()});let created=false,db;
(async()=>{try{
 await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
 execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{env:{...process.env,DATABASE_URL:target.toString()},stdio:'pipe',timeout:60000,windowsHide:true});
 db=new PrismaClient({adapter:new PrismaPg({connectionString:target.toString()})});
 const org=await db.organization.create({data:{name:'Synthetic durable storage'}});
 const clinic=await db.clinic.create({data:{organizationId:org.id,name:'Synthetic clinic',city:'QA',address:'QA'}});
 const patient=await db.patient.create({data:{organizationId:org.id,clinicId:clinic.id,fullName:'Synthetic file acceptance',phone:'0000000000'}});
 const checksum=createHash('sha256').update('%PDF-test').digest('hex');
 async function fixture(){return db.patientFile.create({data:{organizationId:org.id,clinicId:clinic.id,patientId:patient.id,
  title:'Synthetic file',url:'/protected-original-url',fileName:'synthetic.pdf',mimeType:'application/pdf',sizeBytes:9,
  storageProvider:'r2',sourceType:'R2_UPLOAD',storageBucket:'synthetic',storageKey:randomBytes(12).toString('hex'),checksumSha256:checksum,
  notes:'Preserve clinical notes',virusScanStatus:'CLEAN'}}).then(async f=>db.patientFile.update({where:{id:f.id},data:{sourceId:f.storageKey}}));}
 const key=f=>`patient-files/${org.id}/${patient.id}/${f.id}-migration-${randomBytes(8).toString('hex')}`;
 const first=await fixture(),destination=key(first);
 const results=await Promise.allSettled([commitLocalFileMigration(db,first,destination),commitLocalFileMigration(db,first,key(first))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'one canonical winner');
 const current=await db.patientFile.findUniqueOrThrow({where:{id:first.id}});
 assert.equal(current.storageProvider,'local');assert.equal(current.storageBucket,null);
 for(const field of ['url','title','notes','checksumSha256','sizeBytes','virusScanStatus','patientId','clinicId','organizationId'])assert.equal(current[field],first[field]);
 let stages=await db.$queryRawUnsafe('SELECT * FROM "PatientFileObjectStage" WHERE "targetPatientFileId"=$1',first.id);
 assert.equal(stages.length,1);assert.equal(stages[0].storageProvider,'local');assert.equal(stages[0].storageKey,current.storageKey);assert.equal(stages[0].state,'COMMITTED');
 assert.equal(await db.auditLog.count({where:{entityId:first.id,action:'patient_file.storage_migrated'}}),1);
 const second=await fixture();
 await assert.rejects(commitLocalFileMigration(db,{...second,organizationId:'foreign'},key(second)));
 await db.patientFile.update({where:{id:second.id},data:{notes:'Changed concurrently'}});
 await assert.rejects(commitLocalFileMigration(db,second,key(second)),/migration-conflict/);
 assert.equal((await db.patientFile.findUniqueOrThrow({where:{id:second.id}})).storageProvider,'r2');
 // Simulate a previously staged R2 upload; relocate its single stage atomically.
 const third=await fixture(),thirdKey=key(third);
 const {createPatientFileStage,markPatientFileStageStored,markPatientFileStageCommitted}=load('src/infrastructure/patient-files/staging.ts');
 const stage=await createPatientFileStage(db,{id:randomBytes(12).toString('hex'),organizationId:org.id,clinicId:clinic.id,patientId:patient.id,
  targetPatientFileId:third.id,fileName:'synthetic.pdf',mimeType:'application/pdf',sizeBytes:9,storageProvider:'r2',storageKey:third.storageKey});
 await markPatientFileStageStored(db,{stageId:stage.id,checksumSha256:checksum,storageKey:third.storageKey});
 await assert.rejects(commitLocalFileMigration(db,third,thirdKey),/stage-conflict/);
 await markPatientFileStageCommitted(db,stage.id,third.id);
 await commitLocalFileMigration(db,third,thirdKey);
 stages=await db.$queryRawUnsafe('SELECT * FROM "PatientFileObjectStage" WHERE "targetPatientFileId"=$1',third.id);
 assert.equal(stages.length,1);assert.equal(stages[0].id,stage.id);assert.equal(stages[0].storageKey,thirdKey);assert.equal(stages[0].storageProvider,'local');
 await db.patientFile.update({where:{id:third.id},data:{retentionUntil:new Date(Date.now()-10000)}});
 const retention=await stageExpiredPatientFiles(db,{organizationId:org.id,limit:5});assert.equal(retention.staged,1);
 const gc=(await db.$queryRawUnsafe('SELECT * FROM "PatientFileObjectStage" WHERE "id"=$1',stage.id))[0];
 assert.equal(gc.state,'GC_PENDING');assert.equal(gc.storageProvider,'local');assert.equal(gc.storageKey,thirdKey);
 assert.equal(await db.patientFile.count({where:{id:third.id}}),0);
 assert.equal(await db.patientFile.count({where:{id:second.id}}),1);
 console.log('PASS native PostgreSQL: atomic stage relocation, concurrent winner, stale/foreign scope rejection, clinical metadata preservation and retention targets only the new local object.');
}finally{await db?.$disconnect();if(created){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await admin.query(`DROP DATABASE "${name}"`);}await admin.end();}})().catch(e=>{console.error(e);process.exitCode=1});
