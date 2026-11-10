#!/usr/bin/env python3
"""Review public sender identity and enable only the owned SMTP egress stage.

This never sends a message, changes core configuration or starts a restored queue.
"""
import argparse
import datetime
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import uuid
from urllib.parse import urlencode

spec=importlib.util.spec_from_file_location('owned_mail',Path(__file__).with_name('owned-mail-services.py'))
mail=importlib.util.module_from_spec(spec);spec.loader.exec_module(mail)
ROOT=mail.ROOT
RELEASES=Path('/opt/codexdentist-deploy/releases')


def doh(name,kind):
    connection=http.client.HTTPSConnection('cloudflare-dns.com',timeout=12)
    try:
        connection.request('GET','/dns-query?'+urlencode({'name':name,'type':kind}),headers={'Accept':'application/dns-json'})
        response=connection.getresponse();body=response.read(65537)
        if response.status!=200 or len(body)>65536:raise ValueError('Public DNS lookup unavailable')
        data=json.loads(body)
        question=data.get('Question')
        if data.get('Status')!=0 or data.get('TC')is not False or not isinstance(question,list)or len(question)!=1 or question[0].get('type')!=kind or question[0].get('name','').rstrip('.').lower()!=name.rstrip('.').lower():
            raise ValueError('Public DNS answer is incomplete or mismatched')
        return [row['data']for row in data.get('Answer',[])if row.get('type')==kind and row.get('name','').rstrip('.').lower()==name.rstrip('.').lower()]
    finally:connection.close()


def txt(value):
    if not value.startswith('"'):raise ValueError('Unsupported DNS TXT encoding')
    return ''.join(shlex.split(value))


def verify_sender(records,public_key,hostname,lookup=doh):
    expected={row['name']:row for row in records}
    if len(records)!=2 or set(expected)!={'codexdentist.com','cdx202611._domainkey.codexdentist.com'} or any(row['type']!='TXT'for row in records):
        raise ValueError('Exact two sender TXT records required')
    spf=[txt(value)for value in lookup('codexdentist.com',16)]
    spf=[value for value in spf if value.startswith('v=spf1 ')]
    if spf!=[expected['codexdentist.com']['value']] or 'ip4:187.127.116.53'not in spf[0].split():
        raise ValueError('Existing single SPF record must authorize the owned IP')
    dkim=[txt(value)for value in lookup('cdx202611._domainkey.codexdentist.com',16)]
    if dkim!=[expected['cdx202611._domainkey.codexdentist.com']['value']]:raise ValueError('Public DKIM differs from its reviewed record')
    parts=[part.strip().split('=',1)for part in dkim[0].split(';')if part.strip()]
    if any(len(part)!=2 for part in parts)or len(dict(parts))!=len(parts):raise ValueError('Invalid DKIM tags')
    tags=dict(parts)
    if tags.get('v')!='DKIM1'or tags.get('k')!='rsa'or tags.get('p')!=public_key or tags.get('t')=='y':
        raise ValueError('DKIM must match the persistent signing key')
    if lookup(hostname,1)!=['187.127.116.53']or [value.rstrip('.').lower()for value in lookup('53.116.127.187.in-addr.arpa',12)]!=[hostname]:
        raise ValueError('Public forward/reverse SMTP identity differs')
    return {'spf':True,'dkim':True,'forwardReverse':True}


def sender_dns(directory,pin):
    for kind in ['gateway-data','smtp-data']:
        volume=json.loads(mail.run(['docker','volume','inspect',mail.PROJECT+'_'+kind]))[0]
        if volume.get('Labels',{}).get('com.codexdentist.mail')!=kind:raise ValueError('Mail volume ownership differs')
    script="const fs=require('fs'),c=require('crypto');const k=c.createPublicKey(fs.readFileSync('/snapshot/dkim_keys/codexdentist.com_cdx202611.key'));if(k.asymmetricKeyType!=='rsa'||k.asymmetricKeyDetails.modulusLength<2048)throw Error();console.log(k.export({type:'spki',format:'der'}).toString('base64'))"
    key=mail.run(['docker','run','--rm','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL',
        '--security-opt','no-new-privileges','--memory','128m','--cpus','0.5','--mount',
        'type=volume,source='+mail.PROJECT+'_smtp-data,target=/snapshot,volume-nocopy,readonly',
        '--entrypoint','node',pin['gatewayImage'],'-e',script]).decode().strip()
    return verify_sender(json.loads((directory/'sender-dns-records.json').read_text()),key,pin['outboundHostname'])


def validate_stage(directory,pin):
    if pin.get('version')!=1 or pin.get('smtpImage')!=mail.MADDY or type(pin.get('outboundEnabled'))is not bool or not re.fullmatch('[a-f0-9]{40}',pin.get('revision','')):
        raise ValueError('Reviewed immutable mail installation required')
    if json.loads((directory/'compose.json').read_text())!=mail.configuration(pin['gatewayImage'],pin['outboundEnabled']):
        raise ValueError('Preserve changed mail configuration for review')
    original=(RELEASES/pin['revision']/'scripts/owned-mail/maddy.conf').read_text()
    if hashlib.sha256(original.encode()).hexdigest()!=pin['sourceConfigSha256']or(directory/'maddy.conf').read_text()!=original.replace('hostname mail.codexdentist.com','hostname '+pin['outboundHostname']):
        raise ValueError('SMTP source configuration differs')


def apply(directory):
    mail.run(['docker','compose','--project-directory',str(directory),'-f',str(directory/'compose.json'),'up','-d','--pull','never'])


def status():mail.run(['python3',str(Path(__file__).with_name('owned-mail-services.py')),'status'])


def cold_snapshot():
    spec=importlib.util.spec_from_file_location('mail_backup',Path(__file__).with_name('owned-mail-backup.py'))
    backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)
    snapshot=backup.backup();backup.drill(snapshot)
    mail.run(['python3',str(ROOT/'operators/seal-owned-mail-backup.py'),'--snapshot',str(snapshot)])
    return snapshot


def empty_initial_queues(pin):
    # Read only the stopped originals; SQLite WAL recovery runs on a disposable
    # encrypted copy in tmpfs, never against the original idempotency journal.
    code="""const fs=require('fs'),{DatabaseSync}=require('node:sqlite');
for(const suffix of['','-wal','-shm']){const p='/gateway/queue.sqlite'+suffix;if(fs.existsSync(p))fs.copyFileSync(p,'/tmp/queue.sqlite'+suffix)}
const db=new DatabaseSync('/tmp/queue.sqlite');try{if(db.prepare('SELECT count(*) AS n FROM mail_jobs').get().n!==0||fs.readdirSync('/smtp/queue').length!==0)throw Error('Existing mail needs reconciliation before initial activation')}finally{db.close()}"""
    mail.run(['docker','run','--rm','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL',
        '--security-opt','no-new-privileges','--memory','128m','--cpus','0.5','--tmpfs','/tmp:rw,nosuid,size=64m,uid=1000,gid=1000,mode=0700',
        '--mount','type=volume,source='+mail.PROJECT+'_gateway-data,target=/gateway,volume-nocopy,readonly',
        '--mount','type=volume,source='+mail.PROJECT+'_smtp-data,target=/smtp,volume-nocopy,readonly',
        '--entrypoint','node',pin['gatewayImage'],'-e',code])


def ready(directory,pin):
    code=r"""const https=require('https'),fs=require('fs'),crypto=require('crypto');
const secret=fs.readFileSync('/proof/signing.secret','utf8').trim();
function probe(){const timestamp=String(Math.floor(Date.now()/1000)),key='readiness',method='GET',pathname='/ready';
const signature=crypto.createHmac('sha256',secret).update(`${timestamp}\n${method}\n${pathname}\n${key}\n`).digest('hex');
return new Promise((resolve,reject)=>{const request=https.request('https://codexdentist-mail-gateway:3443/ready',{ca:fs.readFileSync('/proof/gateway.cert.pem'),rejectUnauthorized:true,
headers:{'idempotency-key':key,'x-codexdentist-timestamp':timestamp,'x-codexdentist-signature':signature}},response=>{let data='';response.on('data',chunk=>{data+=chunk;if(data.length>4096)request.destroy()});response.on('end',()=>{try{const value=JSON.parse(data);resolve(response.statusCode===200&&value.ready===true&&value.testOnly===false)}catch{resolve(false)}})});request.setTimeout(3000,()=>request.destroy());request.on('error',reject);request.end()})}
(async()=>{for(let i=0;i<20;i++){try{if(await probe())return}catch{}await new Promise(resolve=>setTimeout(resolve,500))}throw Error()})().catch(()=>process.exitCode=1);"""
    command=['docker','run','--rm','--network',mail.PROJECT+'_gateway','--read-only','--user','1000:1000','--cap-drop','ALL',
        '--security-opt','no-new-privileges','--memory','128m','--cpus','0.5']
    for name in ['signing.secret','gateway.cert.pem']:command+=['--mount',f'type=bind,source={directory}/secrets/{name},target=/proof/{name},readonly']
    mail.run(command+['--entrypoint','node',pin['gatewayImage'],'-e',code])


def replace_private(path,value):
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.new')
    mail.write_private(temporary,value);os.replace(temporary,path)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def activate(directory):
    pin=json.loads((directory/'manifest.json').read_text());validate_stage(directory,pin);status()
    if pin['outboundEnabled']:raise ValueError('Outbound already enabled; use status, never recreate its initial acceptance')
    if(directory/'outbound-activation-before').exists():raise ValueError('Retained activation evidence requires operator review')
    dns=sender_dns(directory,pin);snapshot=cold_snapshot()
    previous={name:(directory/name).read_bytes()for name in ['compose.json','manifest.json']}
    record=directory/'outbound-activation-before';record.mkdir(mode=0o700)
    for name,value in previous.items():mail.write_private(record/name,value)
    try:
        for service in ['gateway','smtp']:mail.run(['docker','stop','--time','30',mail.PROJECT+'-'+service+'-1'])
        empty_initial_queues(pin)
        pin={**pin,'outboundEnabled':True,'senderDnsVerifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        replace_private(directory/'compose.json',json.dumps(mail.configuration(pin['gatewayImage'],True)).encode())
        replace_private(directory/'manifest.json',json.dumps(pin).encode())
        apply(directory);status();ready(directory,pin)
        mail.write_private(directory/'outbound-stage-verified.json',json.dumps({'dns':dns,'snapshot':str(snapshot),'externalDeliveryAccepted':False,'coreConfigurationChanged':False}).encode())
    except Exception:
        for name,value in previous.items():replace_private(directory/name,value)
        apply(directory);status()
        raise
    print('Enabled only the reviewed SMTP outbound network; no message sent and core email configuration unchanged.')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['inspect','enable-outbound']);args=parser.parse_args()
    if not hasattr(os,'geteuid')or os.geteuid()!=0 or ROOT.is_symlink()or ROOT.stat().st_uid!=0 or ROOT.stat().st_mode&0o077:
        raise ValueError('Private root-owned mail installation required')
    os.umask(0o077)
    import fcntl
    with(ROOT/'operations.lock').open('a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.action=='enable-outbound':activate(ROOT)
        else:
            pin=json.loads((ROOT/'manifest.json').read_text());validate_stage(ROOT,pin);status();print(json.dumps(sender_dns(ROOT,pin)))


if __name__=='__main__':main()
