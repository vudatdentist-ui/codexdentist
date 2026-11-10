const {spawn}=require('node:child_process');
const database=process.env.DATABASE_URL&&new URL(process.env.DATABASE_URL);
if(process.env.NODE_ENV!=='test'||!database||!['localhost','127.0.0.1','[::1]'].includes(database.hostname)||
  [...database.searchParams.keys()].some(key=>/^(host|hostaddr|database|dbname|port|service)$/i.test(key)))throw Error('Explicit disposable loopback database required');
async function worker(index){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[require('node:path').join(__dirname,'audit-concurrency.cjs')],{env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
    child.once('error',reject);child.once('exit',code=>resolve({index,code,output}));
  });
}
(async()=>{
  const results=await Promise.all([0,1,2,3].map(worker));
  for(const result of results){
    if(result.code!==0)console.error('Concurrent synthetic workspace failed:',result.index,result.output);
    else console.log('PASS simultaneous synthetic workspace',result.index,'resource waits, overlap/adjacency, tenant scope and notification claims');
  }
  if(results.some(result=>result.code!==0))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
