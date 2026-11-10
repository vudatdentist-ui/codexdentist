const {requestHeaders}=require('./owned-signing-bootstrap-client.cjs');

function binding(input){
  if(!['main','qa'].includes(input?.purpose)||!Number.isInteger(input?.userId)||input.userId<1||!Number.isInteger(input?.teamId)||input.teamId<1||
     !/^[A-Za-z0-9_-]{8,160}$/.test(input?.connectionId||'')||!/^[a-f0-9]{64}$/.test(input?.secret||'')||
     !/^[a-f0-9]{64}$/.test(input?.password||''))throw Error('Explicit owned webhook binding required');
  const email=input.purpose==='main'?'signing-operator@codexdentist.com':'signing-qa@codexdentist.com';
  if(input.email!==email)throw Error('Owned service identity required');
  return{...input,url:'https://codexdentist-signing-callback:3443/api/integrations/documenso/webhooks/'+input.connectionId};
}

async function run(raw){
  const input=binding(raw);
  if(!['create','inspect'].includes(input.action)||process.env.NEXT_PUBLIC_WEBAPP_URL!=='https://sign.codexdentist.com'||
     process.env.NEXT_PUBLIC_DISABLE_SIGNUP!=='true'||process.env.NEXT_PRIVATE_SMTP_HOST!=='capture'||
     process.env.NEXT_PRIVATE_WEBHOOK_SSRF_BYPASS_HOSTS!=='codexdentist-signing-callback'||
     process.env.NODE_EXTRA_CA_CERTS!=='/secrets/callback-trust.cert.pem')throw Error('Verified captured-mail callback stage required');
  const database=new URL(process.env.NEXT_PRIVATE_DATABASE_URL);
  if(database.hostname!=='database'||database.pathname!=='/signing')throw Error('Private provider database required');
  const {PrismaClient}=require('@prisma/client');const prisma=new PrismaClient();const jar=new Map();
  async function request(path,{method='GET',body,team=false}={}){
    const url='http://localhost:3000'+path;
    const response=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{...requestHeaders(url,{body,jar}),...(team?{'x-team-id':String(input.teamId)}:{})},...(body?{body:JSON.stringify(body)}:{})});
    for(const cookie of response.headers.getSetCookie()){
      const value=cookie.split(';',1)[0],index=value.indexOf('=');if(index>0)jar.set(value.slice(0,index),value.slice(index+1));
    }
    const text=await response.text();if(text.length>262144)throw Error('Private webhook response too large');
    let value;try{value=JSON.parse(text)}catch{value=null}
    return{status:response.status,value};
  }
  try{
    const user=await prisma.user.findUniqueOrThrow({where:{id:input.userId},select:{email:true,disabled:true}});
    if(user.email!==input.email||user.disabled)throw Error('Owned webhook principal mismatch');
    const existing=await prisma.webhook.findMany({where:{teamId:input.teamId}});
    if(input.action==='inspect'){
      const selected=existing.filter(row=>row.webhookUrl===input.url&&row.userId===input.userId&&row.secret===input.secret&&row.enabled===true&&
        JSON.stringify(row.eventTriggers)===JSON.stringify(['DOCUMENT_COMPLETED']));
      if(selected.length!==1||existing.length!==1)throw Error('Exact owned webhook unavailable');
      return{pass:true,purpose:input.purpose,webhookId:selected[0].id,teamId:input.teamId,connectionId:input.connectionId};
    }
    if(existing.length!==0)throw Error('Preserve existing provider webhooks');
    const csrf=await request('/api/auth/csrf');if(csrf.status!==200||typeof csrf.value?.csrfToken!=='string')throw Error('Private webhook CSRF unavailable');
    const login=await request('/api/auth/email-password/authorize',{method:'POST',body:{email:input.email,password:input.password,csrfToken:csrf.value.csrfToken}});
    if(login.status!==201)throw Error('Private service signin failed');
    const created=await request('/api/trpc/webhook.createWebhook',{method:'POST',team:true,body:{json:{webhookUrl:input.url,
      secret:input.secret,enabled:true,eventTriggers:['DOCUMENT_COMPLETED']}}});
    const row=created.value?.result?.data?.json;
    if(created.status!==200||typeof row?.id!=='string'||row.webhookUrl!==input.url||row.teamId!==input.teamId||row.userId!==input.userId)throw Error('Private webhook creation unacknowledged');
    return{pass:true,purpose:input.purpose,webhookId:row.id,teamId:input.teamId,connectionId:input.connectionId};
  }finally{await prisma.$disconnect()}
}

module.exports={binding,run};
