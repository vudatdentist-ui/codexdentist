#!/usr/bin/env python3
"""Actual private callback TLS/path/header proof, not full core reconciliation."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import uuid
import re


def exercise(source,output,image):
    if not re.fullmatch(r'codexdentist:(?:ci|[a-f0-9]{40})',image):raise ValueError('Exact compatible image required')
    if output.exists() or output.resolve()==source.resolve() or source.resolve() in output.resolve().parents:
        raise ValueError('Fresh private out-of-source evidence required')
    spec=importlib.util.spec_from_file_location('callback_linux',source/'owned-signing-callback.py')
    callback=importlib.util.module_from_spec(spec);spec.loader.exec_module(callback)
    project='codexdentist-signing-test-'+uuid.uuid4().hex
    callback.PROVIDER_PROJECT=project;callback.PROJECT=project+'-callback';callback.ROOT=output
    network=project+'_private';fixture=project+'-core-fixture'
    compose=['docker','compose','--project-directory',str(output),'-f',str(output/'compose.json')]
    try:
        callback.gateway.run(['docker','network','create','--internal','--label','com.codexdentist.callback-proof='+project,network])
        callback.prepare()
        callback.gateway.run(compose+['up','-d','--pull','never']);callback.status()
        fixture_code="""require('http').createServer((q,r)=>{let body='';q.on('data',v=>body+=v);q.on('end',()=>{if(q.method!=='POST'||q.url!=='/api/integrations/documenso/webhooks/synthetic_connection'){r.writeHead(404);r.end();return}if(q.headers['x-documenso-secret']!=='synthetic-callback-secret'){r.writeHead(401);r.end();return}if(body!==JSON.stringify({event:'SYNTHETIC_TRANSPORT_ONLY'})){r.writeHead(400);r.end();return}r.setHeader('content-type','application/json');r.end(JSON.stringify({ok:true,transportFixtureOnly:true}))})}).listen(3000,'0.0.0.0');"""
        callback.gateway.run(['docker','run','-d','--name',fixture,'--label','com.codexdentist.callback-proof='+project,
            '--network',callback.PROJECT+'_core','--network-alias','codexdentist-signing-core','--read-only','--user','1000:1000',
            '--cap-drop','ALL','--security-opt','no-new-privileges','--memory','128m','--cpus','0.5','--log-driver','none',
            '--entrypoint','node',image,'-e',fixture_code])
        probe=r'''const fs=require('fs'),https=require('https');const ca=fs.readFileSync('/proof/cert.pem');
function req(path,{trust=true,method='GET',secret}={}){return new Promise((ok,bad)=>{const r=https.request({hostname:'codexdentist-signing-callback',servername:'codexdentist-signing-callback',port:3443,path,method,rejectUnauthorized:true,...(trust?{ca}:{}),headers:{'content-type':'application/json',...(secret?{'x-documenso-secret':secret}:{})}},s=>{let b='';s.on('data',v=>b+=v);s.on('end',()=>ok({status:s.statusCode,body:b}))});r.setTimeout(10000,()=>r.destroy(Error()));r.on('error',bad);r.end(method==='POST'?JSON.stringify({event:'SYNTHETIC_TRANSPORT_ONLY'}):undefined)})}
(async()=>{let ready=false;for(let i=0;i<20;i++){try{if((await req('/ready')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}if(!ready)throw Error();let denied=false;try{await req('/ready',{trust:false})}catch(e){denied=['DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN'].includes(e.code)}if(!denied)throw Error();for(const p of ['/','/login','/api/auth','/api/integrations/documenso/webhooks/a/b','/api/integrations/documenso/webhooks/a%2Fb'])if((await req(p,{method:'POST'})).status!==404)throw Error();const path='/api/integrations/documenso/webhooks/synthetic_connection';if((await req(path)).status!==403)throw Error();if((await req(path,{method:'POST',secret:'wrong'})).status!==401)throw Error();const result=await req(path,{method:'POST',secret:'synthetic-callback-secret'});if(result.status!==200||!JSON.parse(result.body).transportFixtureOnly)throw Error();console.log(JSON.stringify({pass:true,strictTls:true,untrustedCaDenied:true,postPathOnly:true,secretHeaderPreserved:true,transportFixtureOnly:true,fullCoreAccepted:false,externalMailSent:false}))})().catch(()=>process.exit(1));'''
        result=callback.gateway.run(['docker','run','--rm','--network',network,'--read-only','--user','101:101','--cap-drop','ALL',
            '--security-opt','no-new-privileges','--memory','128m','--cpus','0.5',
            '--mount','type=bind,source='+str(output/'callback.cert.pem')+',target=/proof/cert.pem,readonly',
            '--entrypoint','node',image,'-e',probe])
        proof=json.loads(result);assert proof['pass'] is True
    finally:
        inspect=subprocess.run(['docker','inspect',fixture],capture_output=True)
        if inspect.returncode==0:
            if json.loads(inspect.stdout)[0]['Config']['Labels'].get('com.codexdentist.callback-proof')!=project:raise ValueError('Fixture ownership differs')
            callback.gateway.run(['docker','rm','-f',fixture])
        if (output/'compose.json').exists():callback.gateway.run(compose+['down','--remove-orphans'])
        inspect=subprocess.run(['docker','network','inspect',network],capture_output=True)
        if inspect.returncode==0:
            if json.loads(inspect.stdout)[0]['Labels'].get('com.codexdentist.callback-proof')!=project:raise ValueError('Fixture network ownership differs')
            callback.gateway.run(['docker','network','rm',network])
    callback.gateway.private(output/'acceptance.json',json.dumps(proof).encode())
    print(json.dumps(proof))


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);parser.add_argument('--image',required=True);args=parser.parse_args()
    if not hasattr(os,'geteuid') or os.geteuid()!=0:raise ValueError('Private Linux callback proof requires root')
    os.umask(0o077);exercise(Path(args.source),Path(args.output),args.image)


if __name__=='__main__':main()
