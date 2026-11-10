#!/usr/bin/env python3
"""Prepare an internal TLS API and recipient proxy; publication is a later gate."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path('/opt/codexdentist-owned-signing-gateway')
PROVIDER = Path('/opt/codexdentist-owned-signing')
PROJECT = 'codexdentist-owned-signing-gateway'
PROVIDER_PROJECT = 'codexdentist-owned-signing'
PROBE_IMAGE = None
IMAGE = 'ghcr.io/nginx/nginx-unprivileged@sha256:e333a5b95605942b5e495645ee54fab02b112081de6dbe45d2ead3ef38e03e31'
TEMPLATE = Path(__file__).parent / 'owned-signing-gateway/nginx.conf'


def template():
    if not __import__('re').fullmatch(r'codexdentist-(?:owned-signing|signing-test-[a-f0-9]{32})', PROVIDER_PROJECT):
        raise ValueError('Explicit owned or unique synthetic provider identity required')
    # Compose's service alias is scoped to this one provider network. Generated
    # project/container names can exceed DNS's 63-byte single-label limit.
    return TEMPLATE.read_text().encode()


def run(args, **kwargs):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if result.returncode: raise RuntimeError('Private signing gateway failed; preserve configuration/keys for review')
    return result.stdout


def configuration():
    service = {'image': IMAGE, 'entrypoint': ['nginx', '-g', 'daemon off;'], 'restart': 'unless-stopped',
        'user': '101:101', 'read_only': True, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'cpus': 0.5, 'mem_limit': '128m', 'pids_limit': 64, 'logging': {'driver': 'none'},
        'tmpfs': ['/tmp:rw,nosuid,noexec,size=80m,uid=101,gid=101,mode=0700'],
        'networks': {'provider': {}, 'api': {'aliases': ['codexdentist-signing-gateway']}, 'recipient': {}},
        'volumes': [{'type': 'bind', 'source': './nginx.conf', 'target': '/etc/nginx/nginx.conf', 'read_only': True}] + [
            {'type': 'bind', 'source': './' + name, 'target': '/secrets/' + name, 'read_only': True} for name in ['gateway.key.pem', 'gateway.cert.pem']]}
    return {'name': PROJECT, 'services': {'proxy': service}, 'networks': {'provider': {'external': True, 'name': PROVIDER_PROJECT + '_private'},
        'api': {'internal': True}, 'recipient': {'internal': True}}}


def private(path, value, uid=0):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as output: output.write(value); output.flush(); os.fsync(output.fileno())
    os.chown(path, uid, uid)


def prepare():
    if ROOT.exists(): raise ValueError('Preserve existing gateway keys/configuration')
    if not (PROVIDER / 'bootstrap.completed.json').is_file(): raise ValueError('Verified private service bootstrap required first')
    network = json.loads(run(['docker', 'network', 'inspect', PROVIDER_PROJECT + '_private']))[0]
    if network['Internal'] is not True: raise ValueError('Provider network must remain private')
    run(['docker', 'image', 'inspect', IMAGE])
    ROOT.mkdir(mode=0o700)
    for name in ['gateway.key.pem', 'gateway.cert.pem']:
        if (ROOT / name).exists(): raise ValueError('Never replace gateway key identity')
    run(['openssl', 'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '365',
        '-subj', '/CN=codexdentist-signing-gateway', '-addext', 'subjectAltName=DNS:codexdentist-signing-gateway',
        '-keyout', str(ROOT / 'gateway.key.pem'), '-out', str(ROOT / 'gateway.cert.pem')])
    for name in ['gateway.key.pem', 'gateway.cert.pem']:
        (ROOT / name).chmod(0o600); os.chown(ROOT / name, 101, 101)
    private(ROOT / 'nginx.conf', template(), 101)
    private(ROOT / 'compose.json', json.dumps(configuration()).encode())
    private(ROOT / 'manifest.json', json.dumps({'version': 1, 'image': IMAGE, 'published': False,
        'coreConnected': False, 'configSha256': hashlib.sha256(template()).hexdigest(),
        'certificateSha256': hashlib.sha256((ROOT / 'gateway.cert.pem').read_bytes()).hexdigest()}).encode())


def installation():
    if ROOT.is_symlink() or ROOT.stat().st_uid != 0 or ROOT.stat().st_mode & 0o077: raise ValueError('Private root-owned gateway installation required')
    pin = json.loads((ROOT / 'manifest.json').read_text())
    if pin.get('version') != 1 or pin.get('image') != IMAGE or pin.get('published') is not False or pin.get('coreConnected') is not False:
        raise ValueError('Reviewed private gateway stage required')
    if json.loads((ROOT / 'compose.json').read_text()) != configuration() or pin['configSha256'] != hashlib.sha256(template()).hexdigest() or pin['configSha256'] != hashlib.sha256((ROOT / 'nginx.conf').read_bytes()).hexdigest():
        raise ValueError('Preserve changed gateway configuration')
    if pin['certificateSha256'] != hashlib.sha256((ROOT / 'gateway.cert.pem').read_bytes()).hexdigest(): raise ValueError('Gateway certificate identity differs')


def status():
    installation()
    info = json.loads(run(['docker', 'inspect', PROJECT + '-proxy-1']))[0]; host = info['HostConfig']
    if not info['State']['Running'] or info['State'].get('Restarting') or info['Config']['Image'] != IMAGE or info['Config']['User'] != '101:101' or host.get('PortBindings') or not host['ReadonlyRootfs'] or host.get('Privileged'):
        raise ValueError('Gateway runtime isolation differs')
    if set(info['NetworkSettings']['Networks']) != {PROVIDER_PROJECT + '_private', PROJECT + '_api', PROJECT + '_recipient'}:
        raise ValueError('Gateway network membership differs')
    for name in info['NetworkSettings']['Networks']:
        if json.loads(run(['docker', 'network', 'inspect', name]))[0]['Internal'] is not True: raise ValueError('Gateway networks must remain private')
    if host.get('LogConfig', {}).get('Type') != 'none' or 'ALL' not in (host.get('CapDrop') or []) or not any(value.startswith('no-new-privileges') for value in host.get('SecurityOpt', [])):
        raise ValueError('Gateway privacy/capability guard differs')
    print('PASS private signing gateway: exact image, strict TLS API, recipient-only proxy and no public port/core connection.')


def probe():
    # Only existing provider API tokens enter stdin in a private process; never
    # command arguments, logs, proxy configuration or published artifacts.
    value = json.loads((PROVIDER / 'bootstrap.credentials.json').read_text())
    image = PROBE_IMAGE or 'codexdentist:' + json.loads((Path('/opt/codexdentist-deploy/current.json')).read_text())['sha']
    if not __import__('re').fullmatch(r'codexdentist:(?:ci|[a-f0-9]{40})', image): raise ValueError('Exact compatible app image required')
    code = r'''const fs=require('fs'),https=require('https'),http=require('http');
const tokens=JSON.parse(fs.readFileSync(0,'utf8')),ca=fs.readFileSync('/proof/gateway.cert.pem');let step='ready';
function request(path,{plain=false,token,trust=true}={}){return new Promise((resolve,reject)=>{
const lib=plain?http:https;const r=lib.request({hostname:'codexdentist-signing-gateway',port:plain?8080:3443,path,
...(plain?{}:{ca:trust?ca:undefined,rejectUnauthorized:true,servername:'codexdentist-signing-gateway'}),headers:{host:'sign.codexdentist.com',...(token?{authorization:'Bearer '+token}:{})}},response=>{
let body='';response.on('data',chunk=>{body+=chunk;if(body.length>65536)r.destroy(new Error())});response.on('end',()=>resolve({status:response.statusCode,body}));});
r.setTimeout(10000,()=>r.destroy(new Error()));r.on('error',reject);r.end()})}
(async()=>{
let ready=false;for(let i=0;i<20;i++){try{const healthy=await request('/ready');const health=JSON.parse(healthy.body);if(healthy.status===200&&health.status==='ok'&&health.checks.database.status==='ok'&&health.checks.certificate.status==='ok'){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,500))}if(!ready)throw Error();
step='untrusted-ca';let tlsDenied=false;try{await request('/ready',{trust:false})}catch(error){tlsDenied=['DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN'].includes(error.code)}if(!tlsDenied)throw Error();
step='valid-api-token';for(const row of tokens){const reply=await request('/api/v2/envelope?perPage=1',{token:row.apiToken});if(reply.status!==200||!Array.isArray(JSON.parse(reply.body).data))throw Error()}
step='invalid-api-token';
const invalid=await request('/api/v2/envelope?perPage=1',{token:'api_invalid_gateway_acceptance'});if(![401,403].includes(invalid.status))throw Error();
const paths=['/admin/users.data?_routes=routes%2F_authenticated%2B%2Fadmin%2B%2Fusers._index','/signup','/signin','/api/auth/csrf','/api/v2/envelope','/api/trpc/apiToken.create','/api/trpc/recipient.completeDocumentWithToken,apiToken.create','/api/trpc/envelope.field.sign/../apiToken.create'];
for(const [index,path] of paths.entries()){step='public-denial-'+index;const reply=await request(path,{plain:true});if(reply.status!==404)throw Error()}
console.log(JSON.stringify({pass:true,strictTls:true,untrustedCaDenied:true,separateApiTokens:true,invalidApiTokenDenied:true,publicAdminAndAuthDenied:true,publicBulkApiDenied:true,batchProcedureSmugglingDenied:true,published:false,coreConnected:false}));
})().catch(error=>{console.log(JSON.stringify({pass:false,step,networkError:['ENOTFOUND','ECONNREFUSED','ECONNRESET'].includes(error.code)?error.code:null}))});'''
    result = run(['docker', 'run', '--rm', '-i', '--network', PROJECT + '_api', '--read-only', '--user', '101:101',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '0.5',
        '--mount', 'type=bind,source=' + str(ROOT / 'gateway.cert.pem') + ',target=/proof/gateway.cert.pem,readonly',
        '--entrypoint', 'node', image, '-e', code], input=json.dumps(value).encode())
    proof = json.loads(result)
    if proof.get('pass') is not True: raise ValueError('Gateway acceptance differs: ' + str(proof.get('step')) + ' ' + str(proof.get('networkError')))
    target = ROOT / 'private-acceptance.json'
    if target.exists():
        if target.is_symlink() or json.loads(target.read_text()) != proof: raise ValueError('Preserve changed gateway acceptance evidence')
    else: private(target, result)
    print('PASS actual signing gateway TLS, provider APIs and recipient-surface isolation; no message or core write.')


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['prepare', 'up', 'status', 'probe']); args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Root-owned gateway operator required')
    os.umask(0o077)
    if args.action == 'prepare': prepare(); return
    installation()
    import fcntl
    with (ROOT / 'operations.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'up': run(['docker', 'compose', '--project-directory', str(ROOT), '-f', str(ROOT / 'compose.json'), 'up', '-d', '--pull', 'never'])
        status()
        if args.action == 'probe': probe()


if __name__ == '__main__': main()
