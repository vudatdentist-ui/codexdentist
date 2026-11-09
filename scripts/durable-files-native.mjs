// Isolated Linux container, unprivileged app UID and an explicitly owned volume.
import assert from "node:assert/strict";
import { open, lstat, unlink, readdir, readlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { verifyDurableLocalRoot, resolvePrivateStoragePath } from "../src/infrastructure/patient-files/durable-root.ts";
import { readStoredPatientFile, openStoredPatientFileStream } from "../src/lib/patient-file-storage.ts";
import { prisma } from "../src/lib/prisma.ts";
assert.equal(process.env.DURABLE_FILE_NATIVE_TEST,"true");
assert.equal(process.env.NODE_ENV,"test");
if(process.argv.includes('--expect-rejected')) {
 await assert.rejects(verifyDurableLocalRoot({probeWrite:true}));
 console.log('PASS unsafe native volume rejected');
 await prisma.$disconnect();process.exit(0);
}
const root=await verifyDurableLocalRoot({probeWrite:true});
const key=`patient-files/synthetic/${randomUUID()}/native.pdf`;
const target=await resolvePrivateStoragePath(root,key,true);
const bytes=Buffer.from("%PDF-1.7 synthetic private storage acceptance\n");
try {
 const handle=await open(target,"wx",0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 assert.equal((await lstat(target)).mode&0o777,0o600);
 const input={storageProvider:"local",storageKey:key};
 assert.deepEqual(await readStoredPatientFile(input),bytes);
 const stream=await openStoredPatientFileStream(input);
 assert.equal(stream.contentLength,bytes.length);
 assert.deepEqual(Buffer.from(await new Response(stream.body).arrayBuffer()),bytes);
 const cancelled=await openStoredPatientFileStream(input);await cancelled.body.cancel();
 let descriptors=[];
 for(let attempt=0;attempt<20;attempt++){
  descriptors=(await Promise.all((await readdir('/proc/self/fd')).map(fd=>readlink('/proc/self/fd/'+fd).catch(()=>'')))).filter(link=>link===target);
  if(!descriptors.length)break;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.equal(descriptors.length,0,'cancelled private stream closes its file descriptor');
 console.log(JSON.stringify({pass:true,uid:process.getuid(),durableMounted:true,read:true,stream:true,checksum:createHash('sha256').update(bytes).digest('hex')}));
} finally {await unlink(target);await prisma.$disconnect();}
