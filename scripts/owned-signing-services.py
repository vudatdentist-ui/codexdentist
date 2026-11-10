#!/usr/bin/env python3
"""Private, closed-signup Documenso CE runtime; no publication or core writes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import time

ROOT = Path('/opt/codexdentist-owned-signing')
PROJECT = 'codexdentist-owned-signing'
IMAGES = {
    'app': 'documenso/documenso@sha256:41a69062febc915d1508b87be8c5bbe72ecd3c49232ddcd983490f5f7832f053',
    'database': 'postgres@sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac',
    'cache': 'valkey/valkey@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a',
    'capture': 'axllent/mailpit@sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce',
}
SOURCE = '8707e33c124e4b1a68dde92d5e05178c9aabd0be'  # Documenso CE v2.21.1


def run(args, **kwargs):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        raise RuntimeError('Owned signing operator failed; preserve private state for review')
    return result.stdout


def configuration(keys):
    required = {'database', 'cache', 'auth', 'encryption', 'secondary', 'certificate'}
    if set(keys) != required or any(not isinstance(value, str) or len(value) != 64 or
            any(char not in '0123456789abcdef' for char in value) for value in keys.values()):
        raise ValueError('Independent, generated signing secrets required')
    if len(set(keys.values())) != len(required): raise ValueError('Signing purposes require separate keys')
    limits = {'restart': 'unless-stopped', 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'cpus': 1.0, 'mem_limit': '512m', 'pids_limit': 128, 'networks': ['private'],
        # Upstream job errors can contain email addresses and signing tokens.
        # Health and our bounded acceptance records are the operational oracle.
        'logging': {'driver': 'none'}}
    app = {**limits, 'image': IMAGES['app'], 'user': '1001:1001', 'read_only': True,
        'mem_limit': '1536m', 'tmpfs': ['/tmp:rw,nosuid,size=128m,uid=1001,gid=1001,mode=0700'],
        'volumes': [{'type': 'bind', 'source': './signing.p12', 'target': '/secrets/signing.p12', 'read_only': True},
            {'type': 'bind', 'source': './license-cache.json', 'target': '/app/.documenso-license.json', 'read_only': False}],
        'depends_on': {'database': {'condition': 'service_healthy'}, 'cache': {'condition': 'service_started'},
            'capture': {'condition': 'service_started'}},
        'environment': {
            'PORT': '3000', 'TZ': 'Asia/Ho_Chi_Minh', 'NEXTAUTH_SECRET': keys['auth'],
            'NEXT_PRIVATE_ENCRYPTION_KEY': keys['encryption'], 'NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY': keys['secondary'],
            'NEXT_PUBLIC_WEBAPP_URL': 'https://sign.codexdentist.com', 'NEXT_PRIVATE_INTERNAL_WEBAPP_URL': 'http://localhost:3000',
            'NEXT_PRIVATE_DATABASE_URL': 'postgresql://signing:' + keys['database'] + '@database:5432/signing',
            'NEXT_PRIVATE_JOBS_PROVIDER': 'bullmq', 'NEXT_PRIVATE_REDIS_URL': 'redis://:' + keys['cache'] + '@cache:6379',
            'NEXT_PRIVATE_BULLMQ_CONCURRENCY': '2', 'NEXT_PUBLIC_UPLOAD_TRANSPORT': 'database',
            'NEXT_PRIVATE_SMTP_TRANSPORT': 'smtp-auth', 'NEXT_PRIVATE_SMTP_HOST': 'capture', 'NEXT_PRIVATE_SMTP_PORT': '1025',
            'NEXT_PRIVATE_SMTP_FROM_ADDRESS': 'no-reply@codexdentist.com', 'NEXT_PRIVATE_SMTP_FROM_NAME': 'Codexdentist',
            'NEXT_PRIVATE_SIGNING_TRANSPORT': 'local', 'NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH': '/secrets/signing.p12',
            'NEXT_PRIVATE_SIGNING_PASSPHRASE': keys['certificate'], 'NEXT_PUBLIC_DISABLE_SIGNUP': 'true',
            'NEXT_PUBLIC_DISABLE_GOOGLE_SIGNUP': 'true', 'NEXT_PUBLIC_DISABLE_MICROSOFT_SIGNUP': 'true',
            'NEXT_PUBLIC_DISABLE_OIDC_SIGNUP': 'true', 'NEXT_PUBLIC_FEATURE_BILLING_ENABLED': 'false',
            'NEXT_PUBLIC_IS_DOCUMENSO_CLOUD': 'false', 'DOCUMENSO_DISABLE_TELEMETRY': 'true',
            'NEXT_TELEMETRY_DISABLED': '1', 'npm_config_cache': '/tmp/npm', 'PRISMA_HIDE_UPDATE_MESSAGE': '1'}}
    database = {**limits, 'image': IMAGES['database'], 'cap_add': ['CHOWN', 'FOWNER', 'SETUID', 'SETGID', 'DAC_OVERRIDE'],
        'environment': {'POSTGRES_USER': 'signing', 'POSTGRES_DB': 'signing', 'POSTGRES_PASSWORD': keys['database']},
        'volumes': [{'type': 'volume', 'source': 'database', 'target': '/var/lib/postgresql/data', 'volume': {'nocopy': True}}],
        'healthcheck': {'test': ['CMD', 'pg_isready', '-h', '127.0.0.1', '-U', 'signing', '-d', 'signing'],
            'interval': '5s', 'timeout': '3s', 'retries': 30}}
    cache = {**limits, 'image': IMAGES['cache'], 'mem_limit': '160m', 'user': '999:1000',
        'command': ['valkey-server', '--requirepass', keys['cache'], '--appendonly', 'yes', '--maxmemory', '96mb', '--maxmemory-policy', 'noeviction'],
        'volumes': [{'type': 'volume', 'source': 'cache', 'target': '/data', 'volume': {'nocopy': True}}]}
    capture = {**limits, 'image': IMAGES['capture'], 'read_only': True, 'mem_limit': '128m',
        'tmpfs': ['/tmp:rw,nosuid,size=32m'], 'environment': {'MP_MAX_MESSAGES': '100',
            'MP_SMTP_AUTH_ACCEPT_ANY': 'false', 'MP_DISABLE_VERSION_CHECK': 'true'}}
    return {'name': PROJECT, 'services': {'app': app, 'database': database, 'cache': cache, 'capture': capture},
        'networks': {'private': {'internal': True}}, 'volumes': {name: {'name': PROJECT + '_' + name,
            'labels': {'com.codexdentist.signing': name}} for name in ['database', 'cache']}}


def private(path, data, app_readable=False):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as target:
        target.write(data); target.flush(); os.fsync(target.fileno())
    if app_readable: os.chown(path, 1001, 1001)


def prepare(directory):
    if directory.exists(): raise ValueError('Preserve existing signing installation; prepare never replaces it')
    for name in ['database', 'cache']:
        result = subprocess.run(['docker', 'volume', 'inspect', PROJECT + '_' + name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode == 0: raise ValueError('Preserve pre-existing signing volume')
    for image in IMAGES.values():
        run(['docker', 'image', 'inspect', image])  # Pull exact pins separately; no implicit upgrade.
    directory.mkdir(mode=0o700)
    keys = {name: secrets.token_hex(32) for name in ['database', 'cache', 'auth', 'encryption', 'secondary', 'certificate']}
    private(directory / 'keys.json', json.dumps(keys).encode())
    private(directory / 'certificate.pass', keys['certificate'].encode())
    run(['openssl', 'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '365',
        '-subj', '/CN=Codexdentist owned document signing', '-keyout', str(directory / 'signing.key.pem'), '-out', str(directory / 'signing.cert.pem')])
    run(['openssl', 'pkcs12', '-export', '-out', str(directory / 'signing.p12'), '-inkey', str(directory / 'signing.key.pem'),
        '-in', str(directory / 'signing.cert.pem'), '-passout', 'file:' + str(directory / 'certificate.pass')])
    for name in ['signing.key.pem', 'signing.cert.pem', 'signing.p12']: (directory / name).chmod(0o600)
    os.chown(directory / 'signing.p12', 1001, 1001)
    private(directory / 'license-cache.json', b'{}', True)
    private(directory / 'compose.json', json.dumps(configuration(keys)).encode())
    private(directory / 'manifest.json', json.dumps({'version': 1, 'upstream': SOURCE, 'images': IMAGES,
        'published': False, 'externalMail': False, 'applicationConnected': False,
        'certificateSha256': hashlib.sha256((directory / 'signing.cert.pem').read_bytes()).hexdigest()}).encode())
    # Run Valkey directly as its image's unprivileged identity. Its root
    # entrypoint cannot traverse private AOF directories after a restart with
    # capabilities dropped; widening permissions would expose signing jobs.
    volume = PROJECT + '_cache'
    run(['docker', 'volume', 'create', '--label', 'com.codexdentist.signing=cache', volume])
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0', '--cap-drop', 'ALL',
        '--cap-add', 'CHOWN', '--cap-add', 'FOWNER', '--security-opt', 'no-new-privileges',
        '--mount', 'type=volume,source=' + volume + ',target=/data,volume-nocopy', '--entrypoint', 'node', IMAGES['app'], '-e',
        "const fs=require('fs');if(fs.readdirSync('/data').length)throw Error();fs.chmodSync('/data',0o700);fs.chownSync('/data',999,1000)"])


def installation(directory):
    if directory.is_symlink() or directory.stat().st_uid != 0 or directory.stat().st_mode & 0o077:
        raise ValueError('Private root-owned signing installation required')
    manifest = json.loads((directory / 'manifest.json').read_text())
    expected = configuration(json.loads((directory / 'keys.json').read_text()))
    if manifest.get('version') != 1 or manifest.get('upstream') != SOURCE or manifest.get('images') != IMAGES or any(
            manifest.get(key) is not False for key in ['published', 'externalMail', 'applicationConnected']):
        raise ValueError('Reviewed private signing stage required')
    if json.loads((directory / 'compose.json').read_text()) != expected:
        raise ValueError('Signing configuration differs; preserve it for review')
    if hashlib.sha256((directory / 'signing.cert.pem').read_bytes()).hexdigest() != manifest['certificateSha256']:
        raise ValueError('Signing certificate identity differs')
    return expected


def status(directory):
    expected = installation(directory)
    for name, service in expected['services'].items():
        info = json.loads(run(['docker', 'inspect', PROJECT + '-' + name + '-1']))[0]
        host = info['HostConfig']
        if not info['State']['Running'] or any(info['State'].get(key) for key in ['Restarting', 'Paused', 'Dead', 'OOMKilled']) or info['Config']['Image'] != service['image'] or host.get('PortBindings') or host.get('Privileged'):
            raise ValueError('Signing runtime identity or isolation differs')
        if set(info['NetworkSettings']['Networks']) != {PROJECT + '_private'}:
            raise ValueError('Signing runtime has unexpected network access')
        if service.get('read_only') and not host['ReadonlyRootfs']:
            raise ValueError('Signing read-only root required')
        if host.get('LogConfig', {}).get('Type') != 'none' or 'ALL' not in (host.get('CapDrop') or []) or not any(
                value.startswith('no-new-privileges') for value in host.get('SecurityOpt', [])):
            raise ValueError('Signing privacy/capability guard differs')
        environment = dict(value.split('=', 1) for value in info['Config']['Env'])
        if any(environment.get(key) != value for key, value in service.get('environment', {}).items()):
            raise ValueError('Signing environment differs')
        if service.get('user') and info['Config']['User'] != service['user']: raise ValueError('Unprivileged signing service required')
    if json.loads(run(['docker', 'network', 'inspect', PROJECT + '_private']))[0]['Internal'] is not True:
        raise ValueError('Private signing network required')
    print('PASS private pinned signing runtime: closed signup, captured mail, no public ports/core connection.')


def health(directory=ROOT):
    password = json.loads((directory / 'keys.json').read_text())['cache']
    for attempt in range(30):
        try:
            reply = run(['docker', 'exec', '-i', PROJECT + '-cache-1', 'sh', '-c',
                'IFS= read -r REDISCLI_AUTH; export REDISCLI_AUTH; exec valkey-cli --no-auth-warning PING'], input=(password + '\n').encode())
            if reply.strip() != b'PONG': raise RuntimeError('Private signing cache unavailable')
            break
        except RuntimeError:
            if attempt == 29: raise
            time.sleep(0.5)
    code = r'''(async()=>{let ready=false;const deadline=Date.now()+180000;while(Date.now()<deadline){try{
const response=await fetch('http://localhost:3000/api/health',{signal:AbortSignal.timeout(3000),redirect:'error'});
const data=await response.json();if(response.status===200&&data.status==='ok'&&data.checks.database.status==='ok'&&data.checks.certificate.status==='ok'){ready=true;break}
}catch{}await new Promise(resolve=>setTimeout(resolve,500))}if(!ready)throw Error('Private signing health unavailable');
const denied=await fetch('http://localhost:3000/api/auth/email-password/signup',{method:'POST',redirect:'error',signal:AbortSignal.timeout(3000),
headers:{'content-type':'application/json','origin':'https://sign.codexdentist.com'},body:JSON.stringify({name:'Synthetic signup denial',email:'closed-signup-'+crypto.randomUUID()+'@example.test',password:'SyntheticOnly2026!Password'})});
const body=await denied.json();if(denied.status!==400||body.code!=='SIGNUP_DISABLED')throw Error('Signup guard differs');
})().catch(()=>process.exitCode=1);'''
    run(['docker', 'exec', PROJECT + '-app-1', 'node', '-e', code])
    print('PASS actual signing database/certificate health and disabled signup API.')


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('action', choices=['prepare', 'up', 'status'])
    args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Root-owned operator execution required')
    os.umask(0o077)
    if args.action == 'prepare': prepare(ROOT); return
    installation(ROOT)
    import fcntl
    with (ROOT / 'operations.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'up': run(['docker', 'compose', '--project-directory', str(ROOT), '-f', str(ROOT / 'compose.json'), 'up', '-d', '--pull', 'never'])
        status(ROOT); health()


if __name__ == '__main__': main()
