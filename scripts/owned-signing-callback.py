#!/usr/bin/env python3
"""Private TLS callback boundary. The core verifies tenant secrets and event replay."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

spec=importlib.util.spec_from_file_location('callback_gateway',Path(__file__).with_name('owned-signing-gateway.py'))
gateway=importlib.util.module_from_spec(spec);spec.loader.exec_module(gateway)
ROOT=Path('/opt/codexdentist-signing-callback')
PROJECT='codexdentist-signing-callback'
PROVIDER_PROJECT=gateway.PROVIDER_PROJECT
IMAGE=gateway.IMAGE


def template():
    return b'''worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/null crit;
events { worker_connections 1024; }
http {
  access_log off;
  server_tokens off;
  client_body_temp_path /tmp/client_temp;
  proxy_temp_path /tmp/proxy_temp;
  fastcgi_temp_path /tmp/fastcgi_temp;
  uwsgi_temp_path /tmp/uwsgi_temp;
  scgi_temp_path /tmp/scgi_temp;
  client_max_body_size 2m;
  client_body_timeout 15s;
  client_header_timeout 15s;
  resolver 127.0.0.11 valid=10s ipv6=off;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_set_header Host codexdentist.com;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_connect_timeout 3s;
  proxy_read_timeout 9s;
  proxy_send_timeout 9s;
  proxy_buffering off;
  add_header Cache-Control no-store always;
  add_header Referrer-Policy no-referrer always;
  server {
    listen 3443 ssl;
    server_name codexdentist-signing-callback;
    ssl_certificate /secrets/callback.cert.pem;
    ssl_certificate_key /secrets/callback.key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    set $core http://codexdentist-signing-core:3000;
    location = /ready { return 200 'private callback ready'; }
    location ~ ^/api/integrations/documenso/webhooks/[A-Za-z0-9_-]+$ {
      limit_except POST { deny all; }
      proxy_pass $core;
    }
    location / { return 404; }
  }
}
'''


def configuration():
    if not re.fullmatch(r'codexdentist-(?:owned-signing|signing-test-[a-f0-9]{32})',PROVIDER_PROJECT):
        raise ValueError('Explicit owned or unique synthetic provider required')
    if (PROJECT=='codexdentist-signing-callback' and PROVIDER_PROJECT!='codexdentist-owned-signing') or (PROJECT!='codexdentist-signing-callback' and PROJECT!=PROVIDER_PROJECT+'-callback'):
        raise ValueError('Explicit callback identity required')
    return {'name':PROJECT,'services':{'proxy':{
        'image':IMAGE,'entrypoint':['nginx','-g','daemon off;'],'restart':'unless-stopped',
        'user':'101:101','read_only':True,'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],
        'cpus':0.5,'mem_limit':'128m','pids_limit':64,'logging':{'driver':'none'},
        'ulimits':{'nofile':{'soft':4096,'hard':4096}},
        'tmpfs':['/tmp:rw,nosuid,noexec,size=32m,uid=101,gid=101,mode=0700'],
        'networks':{'provider':{'aliases':['codexdentist-signing-callback']},'core':{}},
        'volumes':[{'type':'bind','source':'./nginx.conf','target':'/etc/nginx/nginx.conf','read_only':True}]+[
            {'type':'bind','source':'./'+name,'target':'/secrets/'+name,'read_only':True}
            for name in ['callback.key.pem','callback.cert.pem']]}},
        'networks':{'provider':{'external':True,'name':PROVIDER_PROJECT+'_private'},'core':{'internal':True}}}


def prepare():
    if ROOT.exists():raise ValueError('Preserve existing callback installation')
    configuration()
    if subprocess.run(['docker','inspect',PROJECT+'-proxy-1'],capture_output=True).returncode==0:raise ValueError('Preserve existing callback container')
    # Only the already-verified owned provider identity can reach the listener.
    network=json.loads(gateway.run(['docker','network','inspect',PROVIDER_PROJECT+'_private']))[0]
    if network.get('Internal') is not True:raise ValueError('Internal provider network required')
    gateway.run(['docker','image','inspect',IMAGE]);ROOT.mkdir(mode=0o700)
    gateway.run(['openssl','req','-x509','-newkey','rsa:3072','-nodes','-sha256','-days','365',
        '-subj','/CN=codexdentist-signing-callback','-addext','subjectAltName=DNS:codexdentist-signing-callback',
        '-keyout',str(ROOT/'callback.key.pem'),'-out',str(ROOT/'callback.cert.pem')])
    for name in ['callback.key.pem','callback.cert.pem']:
        (ROOT/name).chmod(0o600);os.chown(ROOT/name,101,101)
    gateway.private(ROOT/'nginx.conf',template(),101)
    gateway.private(ROOT/'compose.json',json.dumps(configuration()).encode())
    gateway.private(ROOT/'manifest.json',json.dumps({'version':1,'image':IMAGE,'coreConnected':False,
        'configSha256':hashlib.sha256(template()).hexdigest(),
        'certificateSha256':hashlib.sha256((ROOT/'callback.cert.pem').read_bytes()).hexdigest()}).encode())


def installation():
    if ROOT.is_symlink() or ROOT.stat().st_uid!=0 or ROOT.stat().st_mode&0o077:raise ValueError('Private callback installation required')
    for name in ['nginx.conf','compose.json','manifest.json','callback.key.pem','callback.cert.pem']:
        path=ROOT/name;owner=0 if name in ['compose.json','manifest.json'] else 101
        if path.is_symlink() or not path.is_file() or path.stat().st_uid!=owner or path.stat().st_gid!=owner or path.stat().st_mode&0o777!=0o600:
            raise ValueError('Private callback ownership differs')
    pin=json.loads((ROOT/'manifest.json').read_text())
    if pin!={'version':1,'image':IMAGE,'coreConnected':False,'configSha256':hashlib.sha256(template()).hexdigest(),
             'certificateSha256':hashlib.sha256((ROOT/'callback.cert.pem').read_bytes()).hexdigest()}:
        raise ValueError('Reviewed staged callback identity required')
    if json.loads((ROOT/'compose.json').read_text())!=configuration() or (ROOT/'nginx.conf').read_bytes()!=template():
        raise ValueError('Preserve changed callback configuration')


def status():
    installation();info=json.loads(gateway.run(['docker','inspect',PROJECT+'-proxy-1']))[0];host=info['HostConfig']
    if not info['State']['Running'] or info['State'].get('Restarting') or info['Config']['Image']!=IMAGE or info['Config']['User']!='101:101' or host.get('PortBindings') or host.get('Privileged') or not host['ReadonlyRootfs']:
        raise ValueError('Private callback runtime isolation differs')
    if set(info['NetworkSettings']['Networks'])!={PROVIDER_PROJECT+'_private',PROJECT+'_core'} or host.get('LogConfig',{}).get('Type')!='none' or 'ALL' not in host.get('CapDrop',[]) or not any(x.startswith('no-new-privileges') for x in host.get('SecurityOpt',[])):
        raise ValueError('Callback networks/logging/capabilities differ')
    for network in info['NetworkSettings']['Networks']:
        if json.loads(gateway.run(['docker','network','inspect',network]))[0].get('Internal') is not True:raise ValueError('Callback must remain internal')
    print('PASS private TLS callback boundary: exact path/method allowlist, no public route or core credentials.')


def enable_provider(signing,recovery):
    status();directory=signing.ROOT;signing.installation(directory)
    target=directory/'callback-trust.cert.pem'
    if target.exists():raise ValueError('Preserve existing provider callback trust; review retained transition')
    before_compose=(directory/'compose.json').read_bytes();before_manifest=(directory/'manifest.json').read_bytes()
    snapshot=recovery.backup();recovery.drill(snapshot)
    import fcntl
    with (ROOT/'operations.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        status();signing.installation(directory)
        if target.exists() or (directory/'compose.json').read_bytes()!=before_compose or (directory/'manifest.json').read_bytes()!=before_manifest:
            raise ValueError('Provider changed after callback recovery; preserve for review')
        apply_provider_trust(signing,snapshot,before_compose,before_manifest)


def apply_provider_trust(signing,snapshot,before_compose,before_manifest):
    directory=signing.ROOT;target=directory/'callback-trust.cert.pem'
    record=directory/'callback-trust-before';record.mkdir(mode=0o700)
    signing.private(record/'compose.json',before_compose);signing.private(record/'manifest.json',before_manifest)
    signing.private(record/'snapshot.json',json.dumps({'path':str(snapshot)}).encode())
    public=(ROOT/'callback.cert.pem').read_bytes();pin=json.loads(before_manifest)
    pin['callbackCertificateSha256']=hashlib.sha256(public).hexdigest()
    proposed_manifest=json.dumps(pin).encode()
    proposed_compose=json.dumps(signing.configuration(json.loads((directory/'keys.json').read_text()),True)).encode()
    def recreate():gateway.run(['docker','compose','--project-directory',str(directory),'-f',str(directory/'compose.json'),
        'up','-d','--no-deps','--force-recreate','--pull','never','app'])
    try:
        signing.private(target,public,True)
        gateway.replace(directory/'compose.json',proposed_compose);gateway.replace(directory/'manifest.json',proposed_manifest)
        recreate();signing.status(directory);signing.health(directory)
        code="fetch('https://codexdentist-signing-callback:3443/ready',{redirect:'error',signal:AbortSignal.timeout(10000)}).then(async r=>{if(r.status!==200||await r.text()!=='private callback ready')throw Error()}).catch(()=>process.exit(1))"
        gateway.run(['docker','exec',signing.PROJECT+'-app-1','node','-e',code])
        denied="fetch('https://codexdentist-signing-callback:3443/ready',{signal:AbortSignal.timeout(10000)}).then(()=>process.exit(1)).catch(e=>process.exit(['DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN'].includes(e.cause?.code)?0:1))"
        gateway.run(['docker','exec','-e','NODE_EXTRA_CA_CERTS=',signing.PROJECT+'-app-1','node','-e',denied])
    except BaseException:
        if any(path.is_symlink() or path.read_bytes() not in [before,after] for path,before,after in [
                (directory/'compose.json',before_compose,proposed_compose),(directory/'manifest.json',before_manifest,proposed_manifest)]) or target.is_symlink() or (target.exists() and target.read_bytes()!=public):
            raise ValueError('Preserve concurrent provider trust changes')
        gateway.replace(directory/'compose.json',before_compose);gateway.replace(directory/'manifest.json',before_manifest)
        if target.exists():target.unlink()
        recreate();signing.status(directory);signing.health(directory)
        raise
    signing.private(directory/'callback-trust-accepted.json',json.dumps({'snapshotBefore':str(snapshot),
        'strictTls':True,'untrustedCaDenied':True,'bypassHost':'codexdentist-signing-callback',
        'externalMailSent':False,'coreConnected':False}).encode())
    print('PASS provider callback TLS trust; only exact internal host allowed, SMTP remains captured and core is not connected.')


def webhook_client(signing,value):
    # Bundle the tiny shared HTTP-header helper into the private stdin client;
    # no credential-bearing command arguments or mounted source tree are needed.
    bootstrap=Path(__file__).with_name('owned-signing-bootstrap-client.cjs').read_text()
    source=Path(__file__).with_name('owned-signing-webhook-client.cjs').read_text()
    source=source.replace("require('./owned-signing-bootstrap-client.cjs')", "(()=>{const module={exports:{}};"+bootstrap+";return module.exports})()",1)
    source+="\nmodule.exports.run(JSON.parse(require('node:fs').readFileSync(0,'utf8'))).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.log(JSON.stringify({pass:false}));process.exitCode=1});"
    result=subprocess.run(['docker','exec','-i',signing.PROJECT+'-app-1','node','-e',source],input=json.dumps(value).encode(),capture_output=True)
    if result.returncode or len(result.stdout)>65536:raise ValueError('Private webhook call failed; preserve intent and inspect provider state before any retry')
    return json.loads(result.stdout)


def provision_webhooks(signing,bindings):
    if not isinstance(bindings,list) or not 1<=len(bindings)<=2 or len({row.get('purpose') for row in bindings})!=len(bindings) or not {row.get('purpose') for row in bindings}<={'main','qa'} or len({row.get('connectionId') for row in bindings})!=len(bindings) or len({row.get('secret') for row in bindings})!=len(bindings):
        raise ValueError('Distinct main/QA core bindings required')
    for row in bindings:
        if set(row)!={'purpose','connectionId','secret'} or not re.fullmatch('[A-Za-z0-9_-]{8,160}',row['connectionId']) or not re.fullmatch('[a-f0-9]{64}',row['secret']):raise ValueError('Exact private webhook bindings required')
    directory=signing.ROOT;signing.installation(directory)
    for row in bindings:
        for suffix in ['intent.json','api-result.jsonl','bindings.json']:
            if (directory/('webhook.'+row['purpose']+'.'+suffix)).exists():raise FileExistsError('Retained webhook intent/result requires review')
        for purpose in {'main','qa'}-{row['purpose']}:
            other=directory/('webhook.'+purpose+'.intent.json')
            if other.exists():
                previous=json.loads(other.read_text())
                if previous['connectionId']==row['connectionId'] or previous['secret']==row['secret']:raise ValueError('Cross-owner webhook binding reuse denied')
    principals=json.loads((directory/'bootstrap.credentials.json').read_text())
    accounts=json.loads((directory/'bootstrap.intent.json').read_text())['accounts']
    intent=[]
    for row in bindings:
        selected=[v for v in principals if v['purpose']==row['purpose']];account=[v for v in accounts if v['purpose']==row['purpose']]
        if len(selected)!=1 or len(account)!=1:raise ValueError('Verified bootstrap identities required')
        intent.append({**row,'userId':selected[0]['userId'],'teamId':selected[0]['teamId'],'email':account[0]['email'],'password':account[0]['password']})
    for row in intent:signing.private(directory/('webhook.'+row['purpose']+'.intent.json'),json.dumps(row).encode())
    results=[]
    for row in intent:
        with (directory/('webhook.'+row['purpose']+'.api-result.jsonl')).open('xb',buffering=0) as output:
            os.chmod(output.name,0o600)
            accepted=webhook_client(signing,{**row,'action':'create'})
            output.write(json.dumps(accepted).encode()+b'\n');os.fsync(output.fileno())
            if accepted.get('pass') is not True:raise ValueError('Preserve partial webhook acknowledgement')
            checked=webhook_client(signing,{**row,'action':'inspect'})
            if checked!=accepted:raise ValueError('Webhook creation/ownership acceptance differs')
            results.append(accepted)
            signing.private(directory/('webhook.'+row['purpose']+'.bindings.json'),json.dumps(accepted).encode())
    print('PASS separate owned main/QA webhook creation through authenticated provider APIs; no event submitted.')


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['prepare','up','status','enable-provider']);args=parser.parse_args()
    if not hasattr(os,'geteuid') or os.geteuid()!=0:raise ValueError('Root-owned callback operator required')
    os.umask(0o077)
    if args.action=='prepare':prepare();return
    installation()
    import fcntl
    if args.action=='enable-provider':
        spec=importlib.util.spec_from_file_location('callback_recovery',Path(__file__).with_name('owned-signing-backup.py'))
        recovery=importlib.util.module_from_spec(spec);spec.loader.exec_module(recovery)
        with (recovery.ROOT/'operations.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);enable_provider(recovery.signing,recovery)
        return
    with (ROOT/'operations.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.action=='up':gateway.run(['docker','compose','--project-directory',str(ROOT),'-f',str(ROOT/'compose.json'),'up','-d','--pull','never'])
        status()


if __name__=='__main__':main()
