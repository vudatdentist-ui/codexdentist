const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./audit-source-loader.cjs');
const now=new Date();
function fixture({channel='EMAIL',templateKey=null,processing=false,demo=false,answer='SENT',lost=false}={}){
 let status=processing?'PROCESSING':'SCHEDULED',sends=0,queries=0,content;
 const row={id:'notification',organizationId:'org',channel,templateKey,recipient:'synthetic@example.test',subject:'Synthetic',body:'REDACTED AT REST',createdAt:now,updatedAt:now,scheduledAt:null};
 const client=load('src/integrations/owned-mail/client.ts');
 const service=load('src/lib/notifications.ts',{
  '@/lib/env':{notificationDeliveryMode:()=> 'owned-mail',notificationBatchLimit:()=>10,ownedMailConfig:()=>({baseUrl:'https://owned.test',secret:'not-exported',from:'no-reply@example.test'})},
  '@/integrations/owned-mail/client':{...client,deliverOwnedMail:async(_config,input)=>{sends++;content=input;if(lost)throw new client.OwnedMailError('owned-mail-response-uncertain');return{state:answer}},
   ownedMailStatus:async(_config,identity)=>{queries++;assert.equal(identity.id,row.id);assert.equal(identity.organizationId,row.organizationId);assert.equal(Object.keys(identity).length,2);return answer===null?null:{state:answer}}},
  '@/lib/prisma':{prisma:{
   notification:{findUnique:async()=>({...row,status}),findMany:async({where})=>where.status==='PROCESSING'&&status==='PROCESSING'?[{...row,status}]:[],
    updateMany:async({where,data})=>{if(where.status==='PROCESSING'){if(status!=='PROCESSING')return{count:0};}
     else if(!['SCHEDULED','DRAFT'].includes(status))return{count:0};status=data.status;return{count:1};},update:async({data})=>{status=data.status}},
   organization:{findUnique:async()=>({isDemo:demo})},auditLog:{createMany:async()=>({})},
  }},
 });
 return{service,status:()=>status,sends:()=>sends,queries:()=>queries,content:()=>content};
}
test('owned email keeps internal notices local and rejects unsupported/demo deliveries before transport',async()=>{
 for(const channel of ['IN_APP','SMS','ZALO','PUSH']){
  const f=fixture({channel});const result=await f.service.processNotificationNow('notification');
  assert.equal(f.sends(),0);assert.equal(result.sent,channel==='IN_APP'?1:0);assert.equal(f.status(),channel==='IN_APP'?'SENT':'FAILED');
 }
 const demo=fixture({demo:true});await demo.service.processNotificationNow('notification');assert.equal(demo.sends(),0);assert.equal(demo.status(),'CANCELLED');
});
test('credential content remains ephemeral and cannot be replayed from redacted persisted notification bodies',async()=>{
 const f=fixture({templateKey:'PASSWORD_RESET'});
 const noLink=await f.service.processNotificationNow('notification');assert.equal(noLink.skipped,1);assert.equal(f.sends(),0);
 const sent=await f.service.processNotificationNow('notification',{subject:'Reset',body:'PRIVATE FRESH ONE-TIME LINK'});
 assert.equal(sent.sent,1);assert.equal(f.content().body,'PRIVATE FRESH ONE-TIME LINK');assert.equal(f.content().expiresAt,now.getTime()+86400000);
 assert.equal(f.status(),'SENT');await f.service.processNotificationNow('notification',{subject:'Other',body:'Different link'});assert.equal(f.sends(),1);
});
test('lost response or uncertain SMTP acknowledgement keeps the core claim and only reconciles evidence',async()=>{
 for(const answer of ['UNCERTAIN','DISPATCHING','QUEUED',null]){
  const f=fixture({answer,lost:true});await f.service.processNotificationNow('notification');assert.equal(f.status(),'PROCESSING');assert.equal(f.sends(),1);
  const retry=await f.service.processNotificationNow('notification');assert.equal(retry.skipped,1);assert.equal(f.sends(),1);assert.equal(f.queries(),1);assert.equal(f.status(),'PROCESSING');
 }
});
test('reconciliation needs no credential body and finalizes only the scoped PROCESSING record',async()=>{
 for(const answer of ['SENT','REJECTED']){
  const f=fixture({processing:true,templateKey:'PASSWORD_RESET',answer});const result=await f.service.processNotificationNow('notification');
  assert.equal(f.sends(),0);assert.equal(f.queries(),1);assert.equal(f.status(),answer==='SENT'?'SENT':'FAILED');
  assert.equal(answer==='SENT'?result.sent:result.failed,1);
 }
});
