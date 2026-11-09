// Run through the TypeScript alias loader as the app UID with its private volume.
// No source objects are deleted. A failed/uncertain commit retains its private
// journal and destination; never schedule these candidates for automatic GC.
import { constants } from "node:fs";
import { open, lstat, link, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.ts";
import { openStoredPatientFileStream } from "../src/lib/patient-file-storage.ts";
import { verifyDurableLocalRoot, resolvePrivateStoragePath } from "../src/infrastructure/patient-files/durable-root.ts";
import { commitLocalFileMigration } from "../src/infrastructure/patient-files/local-migration.ts";

const args = process.argv.slice(2);
const organizationId = value("--organization");
const fileId = value("--file");
const apply = args.includes("--apply");
function value(name) { const i=args.indexOf(name); return i<0 ? "" : args[i+1] ?? ""; }
function check(condition, code) { if (!condition) throw new Error(code); }
async function privateRead(target) {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat=await handle.stat(); check(stat.isFile() && (stat.mode&0o777)===0o600 && stat.uid===process.getuid(),"migration-private-file-invalid"); return await handle.readFile(); }
  finally { await handle.close(); }
}
async function writeExclusive(target, bytes) {
  const handle=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function syncParents(root,target) {
  let directory=path.dirname(target);
  for(;;) {
    check(directory===root || directory.startsWith(root+path.sep),"migration-parent-escape");
    const handle=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try {await handle.sync();} finally {await handle.close();}
    if(directory===root)break;
    directory=path.dirname(directory);
  }
}
async function main() {
  check(/^[a-zA-Z0-9_-]+$/.test(organizationId) && /^[a-zA-Z0-9_-]+$/.test(fileId),"migration-explicit-scope-required");
  check(args.every((arg,i)=>["--organization","--file","--apply"].includes(arg) || ["--organization","--file"].includes(args[i-1])),"migration-unknown-argument");
  const file = await prisma.patientFile.findFirst({ where: { id:fileId,organizationId } });
  check(file,"migration-file-not-found");
  const org = await prisma.organization.findUnique({ where:{id:organizationId},select:{isDemo:true} });
  check(org && !org.isDemo,"migration-organization-invalid");
  check(!file.previewStorageKey && !file.thumbnailStorageKey,"migration-variants-require-reviewed-plan");
  check(Number.isSafeInteger(file.sizeBytes) && file.sizeBytes>0 && file.sizeBytes<=100*1024*1024 && /^[a-f0-9]{64}$/.test(file.checksumSha256??""),"migration-size-or-checksum-invalid");
  if (!apply) { console.log(JSON.stringify({eligible:file.storageProvider==="r2",sizeBytes:file.sizeBytes,variants:false,apply:false})); return; }
  const root=await verifyDurableLocalRoot({probeWrite:true});
  const journalKey=`.migrations/${digest(Buffer.from(organizationId+"/"+fileId))}.json`;
  const journalPath=await resolvePrivateStoragePath(root,journalKey,true);
  let journal;
  try { journal=JSON.parse((await privateRead(journalPath)).toString("utf8")); }
  catch(error) { if(error.code!=="ENOENT")throw error; }
  if(file.storageProvider==="local") {
    check(journal && journal.organizationId===organizationId && journal.fileId===fileId && journal.destination===file.storageKey,"migration-local-journal-mismatch");
    const bytes=await privateRead(await resolvePrivateStoragePath(root,file.storageKey));
    check(bytes.length===file.sizeBytes && digest(bytes)===file.checksumSha256,"migration-local-checksum-mismatch");
    console.log(JSON.stringify({migrated:false,alreadyLocal:true,sizeBytes:bytes.length}));return;
  }
  check(file.storageProvider==="r2" && file.sourceType==="R2_UPLOAD" && file.storageKey && file.sourceId===file.storageKey,"migration-source-invalid");
  if(!journal) {
    journal={version:1,organizationId,fileId,clinicId:file.clinicId,patientId:file.patientId,sourceProvider:"r2",
      sourceBucket:file.storageBucket,sourceKey:file.storageKey,checksum:file.checksumSha256,sizeBytes:file.sizeBytes,
      originalUpdatedAt:file.updatedAt.toISOString(),destination:`patient-files/${organizationId}/${file.patientId}/${fileId}-migration-${randomUUID()}`};
    await writeExclusive(journalPath,JSON.stringify(journal));
    await syncParents(root,journalPath);
  }
  check(journal.version===1 && journal.organizationId===organizationId && journal.fileId===fileId && journal.clinicId===file.clinicId &&
    journal.patientId===file.patientId && journal.sourceProvider==="r2" && journal.sourceKey===file.storageKey && journal.sourceBucket===file.storageBucket &&
    journal.checksum===file.checksumSha256 && journal.sizeBytes===file.sizeBytes && journal.originalUpdatedAt===file.updatedAt.toISOString() &&
    journal.destination.startsWith(`patient-files/${organizationId}/${file.patientId}/${fileId}-migration-`),"migration-journal-conflict");
  const target=await resolvePrivateStoragePath(root,journal.destination,true);
  let exists=false;
  try { await lstat(target);exists=true; } catch(error) {if(error.code!=="ENOENT")throw error;}
  if(!exists) {
    const source=await openStoredPatientFileStream(file);
    check(source.contentLength===file.sizeBytes,"migration-source-size-mismatch");
    const reader=source.body.getReader(),chunks=[];let size=0;
    const deadline=setTimeout(()=>reader.cancel("migration-read-timeout").catch(()=>{}),90_000);
    try { for(;;) { const {done,value}=await reader.read(); if(done)break;size+=value.byteLength;
      check(size<=file.sizeBytes,"migration-source-size-exceeded");chunks.push(value); } }
    finally {clearTimeout(deadline);await reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=Buffer.concat(chunks);check(size===file.sizeBytes && digest(bytes)===file.checksumSha256,"migration-source-checksum-mismatch");
    // Publish a complete fsynced candidate atomically. Interrupted temporary files
    // remain discoverable alongside the journal, never mistaken for a valid copy.
    const temporary=await resolvePrivateStoragePath(root,journal.destination+".copy-"+randomUUID(),true);
    await writeExclusive(temporary,bytes);
    try { await link(temporary,target); } catch(error) {if(error.code!=="EEXIST")throw error;}
    await unlink(temporary);
  }
  const copied=await privateRead(target);
  check(copied.length===file.sizeBytes && digest(copied)===file.checksumSha256,"migration-destination-checksum-mismatch");
  await syncParents(root,target);
  const result=await commitLocalFileMigration(prisma,file,journal.destination);
  console.log(JSON.stringify({...result,sourcePreserved:true}));
}
main().catch(()=>{console.error("Owned file migration failed; preserve the journal and candidate for reviewed recovery.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
