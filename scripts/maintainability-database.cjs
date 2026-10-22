const assert=require('node:assert/strict');
const {randomUUID,randomInt}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {PrismaPg}=require('@prisma/adapter-pg');
const {load}=require('./audit-source-loader.cjs');
if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL||!['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname))throw Error('Requires NODE_ENV=test and loopback test database');
const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const permissions=load('src/lib/permissions.ts');
const scope=load('src/lib/tenant-scope.ts',{'@/lib/permissions':permissions});
const year=randomInt(1000000,2000000000),token=randomUUID();
const mocks={'@/lib/prisma':{prisma},'@/lib/permissions':permissions,'@/lib/tenant-scope':scope};
async function main(){const organization=await prisma.organization.create({data:{name:'Maintainability fixture '+token}});const orgId=organization.id;try{
const clinic=await prisma.clinic.create({data:{organizationId:orgId,name:'Fixture',city:'Test',address:'Test'}});
const user=await prisma.user.create({data:{organizationId:orgId,email:token+'@example.test',fullName:'Synthetic provider',passwordHash:'unusable-fixture',role:'DENTIST',clinics:{create:{clinicId:clinic.id}},roleAssignments:{create:{organizationId:orgId,clinicId:clinic.id,scopeKey:clinic.id,role:'DENTIST'}}}});
const patient=await prisma.patient.create({data:{organizationId:orgId,clinicId:clinic.id,fullName:'Synthetic patient',phone:'0000000000',medicalAlerts:[]}});
await prisma.staffProfile.create({data:{organizationId:orgId,userId:user.id,clinicId:clinic.id,employeeCode:'fixture',baseSalary:87654321,dateOfBirth:new Date('1990-01-01'),contractType:'SECRET'}});
const session={organizationId:orgId,userId:user.id,role:'DENTIST',roles:['DENTIST'],activeClinicId:clinic.id,clinicIds:[clinic.id],roleAssignments:[{organizationId:orgId,role:'DENTIST',clinicId:clinic.id}]};
const directory=load('src/lib/staff-directory.ts',mocks);const staff=await directory.getStaffDirectory(session);assert.equal(staff.length,1);assert.deepEqual(Object.keys(staff[0]).sort(),['active','fullName','id','roleAssignments']);assert.doesNotMatch(JSON.stringify(staff),/SECRET|87654321|1990/);
console.log('ok real database clinical staff payload excludes private profile fields');
const template=await prisma.formTemplate.create({data:{organizationId:orgId,type:'CONSENT',code:'fixture',name:'Fixture',body:'Fixture',version:'1'}});
await prisma.patientForm.create({data:{organizationId:orgId,clinicId:clinic.id,patientId:patient.id,templateId:template.id,formNo:`FRM-${year}-000041`,attachments:[]}});
await prisma.prescription.create({data:{organizationId:orgId,clinicId:clinic.id,patientId:patient.id,prescriberId:user.id,prescriptionNo:`RX-${year}-000041`}});
const sequence=load('src/lib/global-document-sequence.ts',mocks);
for(const type of ['FRM','RX']){const numbers=await Promise.all(Array.from({length:24},()=>sequence.nextGlobalDocumentNo(type,year)));assert.equal(new Set(numbers).size,24);assert.equal(Math.min(...numbers.map(x=>Number(x.split('-').at(-1)))),42);assert.equal(Math.max(...numbers.map(x=>Number(x.split('-').at(-1)))),65)}
console.log('ok native PostgreSQL concurrent first allocation backfills both global document counters');
const rollbackSlug='rollback-'+token;const onboarding=load('src/lib/organization-onboarding.ts',{'@/lib/prisma':{prisma},'@/lib/auth':{hashPassword:()=> 'unusable-fixture'},'@/lib/tenant-bootstrap':{bootstrapOrganizationDefaults:async()=>{throw Error('synthetic bootstrap failure')}}});
await assert.rejects(onboarding.createOrganizationWorkspace({name:'Rollback fixture',slug:rollbackSlug,ownerEmail:rollbackSlug+'@example.test',ownerFullName:'Test',ownerPassword:'synthetic',clinicName:'Fixture',city:'Test',address:'Test'}),/synthetic bootstrap failure/);
assert.equal(await prisma.organization.count({where:{slug:rollbackSlug}}),0);assert.equal(await prisma.user.count({where:{email:rollbackSlug+'@example.test'}}),0);
console.log('ok PostgreSQL rolls back organization, clinic and owner on bootstrap failure');
// Repeated provisioning must preserve a clinic customization and an inactive template.
const forms=load('src/lib/forms.ts',{...mocks,'@/lib/runtime-guards':{assertDemoFallbackAllowed(e){throw e}}});await forms.ensureFormsSeed(session,prisma);await prisma.formTemplate.updateMany({where:{organizationId:orgId,code:'CONSENT-TX'},data:{body:'CUSTOM BODY',active:false}});await forms.ensureFormsSeed(session,prisma);const customized=await prisma.formTemplate.findFirstOrThrow({where:{organizationId:orgId,code:'CONSENT-TX'}});assert.equal(customized.body,'CUSTOM BODY');assert.equal(customized.active,false);
console.log('ok repeat provisioning preserves customized inactive forms');
const item=await prisma.inventoryItem.create({data:{organizationId:orgId,clinicId:clinic.id,code:'fixture',name:'Synthetic stock',category:'Test',unit:'unit',minimumStock:0,onHandQuantity:1}});
const movement=load('src/lib/application/inventory/record-inventory-movement-command.ts',{...mocks,'@/lib/inventory':{canMutateInventory:()=>true}});
const input={session,itemId:item.id,type:'CONSUMPTION',quantity:1,unitCost:null,referenceTypeInput:null,referenceIdInput:null,noteInput:null};
const movements=await Promise.allSettled([movement.recordInventoryMovementCommand(input),movement.recordInventoryMovementCommand(input)]);
assert.equal(movements.filter(x=>x.status==='fulfilled').length,1);assert.equal(Number((await prisma.inventoryItem.findUniqueOrThrow({where:{id:item.id}})).onHandQuantity),0);assert.equal(await prisma.inventoryMovement.count({where:{itemId:item.id}}),1);
console.log('ok serializable inventory command prevents concurrent over-consumption');
}finally{
// Only fixture-owned rows and the randomly reserved counter year are removed.
await prisma.inventoryMovement.deleteMany({where:{organizationId:orgId}});await prisma.inventoryItem.deleteMany({where:{organizationId:orgId}});await prisma.auditLog.deleteMany({where:{organizationId:orgId}});await prisma.patientForm.deleteMany({where:{organizationId:orgId}});await prisma.formTemplate.deleteMany({where:{organizationId:orgId}});await prisma.prescription.deleteMany({where:{organizationId:orgId}});await prisma.staffProfile.deleteMany({where:{organizationId:orgId}});await prisma.patient.deleteMany({where:{organizationId:orgId}});await prisma.userRoleAssignment.deleteMany({where:{organizationId:orgId}});await prisma.userClinic.deleteMany({where:{user:{organizationId:orgId}}});await prisma.user.deleteMany({where:{organizationId:orgId}});await prisma.clinic.deleteMany({where:{organizationId:orgId}});await prisma.organization.delete({where:{id:orgId}});await prisma.globalDocumentSequence.deleteMany({where:{year,type:{in:['FRM','RX']}}});}}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
