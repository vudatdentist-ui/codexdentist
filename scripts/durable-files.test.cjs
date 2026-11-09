const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {load}=require('./audit-source-loader.cjs');
const policy=()=>load('src/infrastructure/patient-files/durable-root.ts');
const config={NODE_ENV:'production',DEPLOYMENT_MODE:'hosted',PATIENT_FILE_STORAGE_DRIVER:'local',
 PATIENT_FILE_LOCAL_DURABLE:'true',PATIENT_FILE_STORAGE_ROOT:'/data/patient-files'};
const legacy={R2_ENDPOINT:'https://owned-storage.example.test',R2_BUCKET_NAME:'synthetic',R2_ACCESS_KEY_ID:'synthetic-key',R2_SECRET_ACCESS_KEY:'synthetic-secret'};

test('hosted local writes require explicit durable configuration outside code and temporary paths',()=>{
 const p=policy();assert.equal(p.durableLocalRootConfiguration(config,'/app','linux'),'/data/patient-files');
 for(const root of ['', 'relative/files','/','/app','/app/public/files','/app/../tmp/files','/var/tmp/files','/run/files','/proc/files']){
  assert.throws(()=>p.durableLocalRootConfiguration({...config,PATIENT_FILE_STORAGE_ROOT:root},'/app','linux'));
 }
 assert.throws(()=>p.durableLocalRootConfiguration({...config,PATIENT_FILE_LOCAL_DURABLE:'false'},'/app','linux'));
 assert.throws(()=>p.durableLocalRootConfiguration(config,'/app','win32'));
 const env=load('src/lib/env.ts',{}, {process:{env:config,platform:'linux',cwd:()=>'/app'}});
 assert.equal(env.patientFileStorageDriver(),'local');
 const unsafe=load('src/lib/env.ts',{}, {process:{env:{...config,PATIENT_FILE_LOCAL_DURABLE:'false'}}});
 assert.throws(()=>unsafe.patientFileStorageDriver());
});

test('legacy R2 reads remain configured independently of the new write backend',()=>{
 const env=load('src/lib/env.ts',{}, {process:{env:{...config,...legacy,PATIENT_FILE_LOCAL_DURABLE:'false'}}});
 assert.throws(()=>env.patientFileStorageDriver());
 assert.equal(env.r2StorageConfig({forExistingObject:true}).bucket,'synthetic');
 const absent=load('src/lib/env.ts',{}, {process:{env:{...config,PATIENT_FILE_LOCAL_DURABLE:'false'}}});
 assert.equal(absent.r2StorageConfig({forExistingObject:true}),null);
 const insecure=load('src/lib/env.ts',{}, {process:{env:{...config,...legacy,R2_ENDPOINT:'http://remote.example.test'}}});
 assert.throws(()=>insecure.r2StorageConfig({forExistingObject:true}),/HTTPS/);
});

test('durability evidence requires the exact mount and rejects image or memory filesystems',()=>{
 const {hasDurableMount}=policy();
 const row=type=>`12 1 8:1 /vol /data/patient-files rw - ${type} /dev/disk rw`;
 assert.equal(hasDurableMount('/data/patient-files',row('ext4')),true);
 for(const type of ['overlay','tmpfs','ramfs','squashfs'])assert.equal(hasDurableMount('/data/patient-files',row(type)),false);
 assert.equal(hasDurableMount('/data/patient-files','12 1 8:1 / /data rw - ext4 /dev/disk rw'),false);
 assert.equal(hasDurableMount('/data/patient-files','malformed'),false);
 assert.equal(hasDurableMount('/data/patient files','12 1 8:1 / /data/patient\\040files rw - ext4 /dev/disk rw'),true);
});

test('mounted root readiness proves private ownership, actual unprivileged access and writable storage',async()=>{
 for(const failure of ['none','root-user','foreign-owner','world-readable','no-execute','symlink','redirected-root','not-mounted','readonly']){
  let writes=0,removes=0;
  const module=load('src/infrastructure/patient-files/durable-root.ts',{'node:fs/promises':{
   lstat:async()=>({isDirectory:()=>true,isSymbolicLink:()=>failure==='symlink',mode:failure==='world-readable'?0o755:failure==='no-execute'?0o600:0o700,uid:failure==='foreign-owner'?2000:1000}),
   realpath:async()=>failure==='redirected-root'?'/other':'/data/patient-files',
   readFile:async()=>failure==='not-mounted'?'':'12 1 8:1 / /data/patient-files rw - ext4 /dev/disk rw',
   open:async()=>{writes++;if(failure==='readonly')throw Object.assign(new Error('readonly'),{code:'EROFS'});return{sync:async()=>{},close:async()=>{}}},
   unlink:async()=>{removes++},
  }},{process:{env:config,platform:'linux',cwd:()=>'/app',getuid:()=>failure==='root-user'?0:1000}});
  if(failure==='none'){assert.equal(await module.verifyDurableLocalRoot({probeWrite:true}),'/data/patient-files');assert.equal(writes,1);assert.equal(removes,1);}
  else{await assert.rejects(module.verifyDurableLocalRoot({probeWrite:true}));if(failure!=='readonly')assert.equal(writes,0);}
 }
});

test('real filesystem path resolution denies escape and directory/leaf links before writing',async()=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'codexdentist-native-files-'));
 const root=path.join(base,'private'),outside=path.join(base,'outside');
 const {resolvePrivateStoragePath}=policy();
 try{
  await fs.mkdir(outside);await fs.writeFile(path.join(outside,'untouched.txt'),'synthetic');
  const normal=await resolvePrivateStoragePath(root,'patient-files/org/patient/file.pdf',true);
  await fs.writeFile(normal,'%PDF-1.7 synthetic',{flag:'wx',mode:0o600});
  assert.equal(await fs.readFile(normal,'utf8'),'%PDF-1.7 synthetic');
  for(const key of ['../escape','org/../other/file','/absolute/file','org//file','org/./file','C:/outside/file','org/\0bad']){
   await assert.rejects(resolvePrivateStoragePath(root,key,true));
  }
  await fs.symlink(outside,path.join(root,'org','linked'),'junction');
  await assert.rejects(resolvePrivateStoragePath(root,'org/linked/injected.pdf',true),/link-invalid/);
  await assert.rejects(resolvePrivateStoragePath(root,'org/linked',false),/link-invalid/);
  assert.equal(await fs.readFile(path.join(outside,'untouched.txt'),'utf8'),'synthetic');
  assert.deepEqual(await fs.readdir(outside),['untouched.txt']);
 }finally{
  const resolved=path.resolve(base),prefix=path.resolve(os.tmpdir())+path.sep+'codexdentist-native-files-';
  assert.ok(resolved.startsWith(prefix));assert.equal(await fs.realpath(base),resolved);
  await fs.rm(base,{recursive:true,force:true});
 }
});
