#!/usr/bin/env python3
"""Cold signing recovery. Restored app, mail and BullMQ workers never start."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile
import time
import uuid

spec = importlib.util.spec_from_file_location('signing', Path(__file__).with_name('owned-signing-services.py'))
signing = importlib.util.module_from_spec(spec); spec.loader.exec_module(signing)
ROOT = signing.ROOT
CONFIG = ['compose.json', 'manifest.json', 'keys.json', 'certificate.pass', 'signing.key.pem',
    'signing.cert.pem', 'signing.p12', 'license-cache.json']
TRUST = ['callback-trust.cert.pem', 'smtp-trust.cert.pem', 'provider-trust.cert.pem']
BOOTSTRAP = ['bootstrap.intent.json', 'bootstrap.before.json', 'bootstrap.api-result.json',
    'bootstrap.credentials.json', 'bootstrap.completed.json', 'smtp-admin.intent.json', 'smtp-admin.api-result.json',
    'smtp-admin.completed.json', 'smtp.intent.json', 'smtp.api-result.json', 'smtp.completed.json'] + ['webhook.'+purpose+'.'+suffix for purpose in ['main','qa','qa-rebind'] for suffix in ['intent.json','api-result.jsonl','bindings.json']]
GATEWAY = ['gateway/compose.json', 'gateway/manifest.json', 'gateway/nginx.conf', 'gateway/gateway.cert.pem', 'gateway/gateway.key.pem']
GATEWAY_ROOT = Path('/opt/codexdentist-owned-signing-gateway')
RECIPIENT = ['recipient/' + name for name in ['compose.json', 'manifest.json', 'nginx.conf', 'router.json']]
RECIPIENT_ROOT = Path('/opt/codexdentist-signing-recipient')
CALLBACK = ['callback/' + name for name in ['compose.json','manifest.json','nginx.conf','callback.key.pem','callback.cert.pem']]
CALLBACK_ROOT = Path('/opt/codexdentist-signing-callback')
GATEWAY_IMAGE = 'ghcr.io/nginx/nginx-unprivileged@sha256:e333a5b95605942b5e495645ee54fab02b112081de6dbe45d2ead3ef38e03e31'


def config_owner(name):
    if name.startswith('callback/'):return 0 if name.endswith(('compose.json','manifest.json')) else 101
    if name.startswith('recipient/'): return 101 if name.endswith('/nginx.conf') else 0
    if name.startswith('gateway/'):
        return 0 if name.endswith(('compose.json', 'manifest.json')) else 101
    return 1001 if name in ['signing.p12', 'license-cache.json'] + TRUST else 0

TREE = r'''const fs=require('fs'),path=require('path'),crypto=require('crypto'),rows=[];
function walk(p){const s=fs.lstatSync(p);if(s.isSymbolicLink()||(!s.isFile()&&!s.isDirectory()))throw Error();
rows.push([path.relative('/snapshot',p),s.isDirectory()?'directory':crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),s.size*(s.isFile()?1:0),s.uid,s.gid,s.mode&0o777]);
if(s.isDirectory())for(const name of fs.readdirSync(p).sort())walk(path.join(p,name));}walk('/snapshot');console.log(JSON.stringify(rows));'''


def inspect(kind, name): return json.loads(signing.run(['docker', kind, 'inspect', name]))[0]


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''): digest.update(block)
    return digest.hexdigest()


def volume_command(volume, writable=False):
    return ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0', '--cap-drop', 'ALL',
        '--cap-add', 'DAC_OVERRIDE', *(['--cap-add', 'CHOWN', '--cap-add', 'FOWNER', '-i'] if writable else []),
        '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '0.5',
        '--mount', 'type=volume,source=' + volume + ',target=/snapshot,volume-nocopy' + ('' if writable else ',readonly')]


def inventory(volume):
    return json.loads(signing.run(volume_command(volume) + ['--entrypoint', 'node', signing.IMAGES['app'], '-e', TREE]))


def validate_archive(archive):
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise ValueError('Unsafe signing archive entry')


def sql(container, password, query):
    return signing.run(['docker', 'exec', '-i', container, 'sh', '-c',
        'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -h 127.0.0.1 -U signing -d signing -At -v ON_ERROR_STOP=1 -c "$1"',
        'sh', query], input=(password + '\n').encode()).decode().strip()


def counts(container, password):
    tables = sql(container, password, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
    result = {}
    for table in tables:
        if not table or any(char not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_' for char in table):
            raise ValueError('Unexpected signing table name')
        result[table] = int(sql(container, password, 'SELECT count(*) FROM "' + table + '"'))
    if '_prisma_migrations' not in result or result['_prisma_migrations'] == 0: raise ValueError('Signing schema missing')
    return result


def backup_data():
    signing.status(ROOT)
    for name in ['database', 'cache']:
        if inspect('volume', signing.PROJECT + '_' + name).get('Labels', {}).get('com.codexdentist.signing') != name:
            raise ValueError('Signing volume ownership differs')
    active = [name for name in ['app', 'capture', 'cache', 'database'] if inspect('container', signing.PROJECT + '-' + name + '-1')['State']['Running']]
    parent = ROOT / 'backups'; parent.mkdir(mode=0o700, exist_ok=True)
    snapshot = parent / (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8])
    snapshot.mkdir(mode=0o700)
    manifest = {'version': 1, 'images': signing.IMAGES, 'files': {}, 'fileMetadata': {}, 'volumes': {}}
    try:
        signing.run(['docker', 'stop', '--time', '30', signing.PROJECT + '-app-1'])
        password = json.loads((ROOT / 'keys.json').read_text())['database']
        manifest['databaseCounts'] = counts(signing.PROJECT + '-database-1', password)
        for name in active:
            if name != 'app': signing.run(['docker', 'stop', '--time', '30', signing.PROJECT + '-' + name + '-1'])
        gateway_files = []
        if GATEWAY_ROOT.exists():
            if GATEWAY_ROOT.is_symlink() or GATEWAY_ROOT.stat().st_uid != 0 or GATEWAY_ROOT.stat().st_mode & 0o077:
                raise ValueError('Private owned gateway recovery required')
            gateway_files = GATEWAY
            (snapshot / 'gateway').mkdir(mode=0o700)
        recipient_files = []
        if RECIPIENT_ROOT.exists():
            if RECIPIENT_ROOT.is_symlink() or RECIPIENT_ROOT.stat().st_uid != 0 or RECIPIENT_ROOT.stat().st_mode & 0o077:
                raise ValueError('Private owned recipient recovery required')
            spec = importlib.util.spec_from_file_location('live_recipient_recovery', Path(__file__).with_name('owned-signing-recipient.py'))
            recipient = importlib.util.module_from_spec(spec); spec.loader.exec_module(recipient)
            recipient.ROOT = RECIPIENT_ROOT; recipient.PROVIDER_PROJECT = signing.PROJECT
            if signing.PROJECT != 'codexdentist-owned-signing':
                recipient.PROJECT = signing.PROJECT + '-recipient'; recipient.EDGE = recipient.PROJECT + '-edge'
            pin = recipient.installation()
            if pin['published'] and (recipient.ROUTE.is_symlink() or not recipient.ROUTE.is_file() or recipient.ROUTE.read_bytes() != (RECIPIENT_ROOT / 'router.json').read_bytes()):
                raise ValueError('Preserve changed published recipient route before recovery')
            recipient_files = RECIPIENT
            (snapshot / 'recipient').mkdir(mode=0o700)
        callback_files=[]
        if CALLBACK_ROOT.exists():
            if CALLBACK_ROOT.is_symlink() or CALLBACK_ROOT.stat().st_uid!=0 or CALLBACK_ROOT.stat().st_mode&0o077:raise ValueError('Private callback recovery required')
            callback_files=CALLBACK;(snapshot/'callback').mkdir(mode=0o700)
        for name in CONFIG + [name for name in TRUST + BOOTSTRAP if (ROOT / name).exists()] + gateway_files + recipient_files + callback_files:
            source = (GATEWAY_ROOT / name.removeprefix('gateway/') if name in GATEWAY else
                      RECIPIENT_ROOT / name.removeprefix('recipient/') if name in RECIPIENT else
                      CALLBACK_ROOT/name.removeprefix('callback/') if name in CALLBACK else ROOT / name)
            if source.is_symlink() or not source.is_file(): raise ValueError('Unsafe signing configuration')
            metadata = source.stat()
            owner = config_owner(name)
            if metadata.st_uid != owner or metadata.st_gid != owner or metadata.st_mode & 0o777 != 0o600:
                raise ValueError('Signing configuration ownership/private modes differ')
            shutil.copyfile(source, snapshot / name); (snapshot / name).chmod(0o600)
            manifest['files'][name] = checksum(snapshot / name)
            manifest['fileMetadata'][name] = {'uid': metadata.st_uid, 'gid': metadata.st_gid, 'mode': metadata.st_mode & 0o777}
        for name in ['database', 'cache']:
            volume = signing.PROJECT + '_' + name; before = inventory(volume); target = snapshot / (name + '.tar')
            with target.open('xb') as output:
                result = subprocess.run(volume_command(volume) + ['--entrypoint', 'tar', signing.IMAGES['app'], '--numeric-owner', '-cpf', '-', '-C', '/snapshot', '.'], stdout=output, stderr=subprocess.PIPE)
                if result.returncode: raise RuntimeError('Signing volume archive failed')
            target.chmod(0o600)
            with tarfile.open(target) as archive: validate_archive(archive)
            if inventory(volume) != before: raise ValueError('Cold signing volume changed')
            manifest['volumes'][name] = {'sha256': checksum(target), 'entries': before}
        signing.private(snapshot / 'backup-manifest.json', json.dumps(manifest).encode())
    finally:
        failures = []
        for name in reversed(active):
            try: signing.run(['docker', 'start', signing.PROJECT + '-' + name + '-1'])
            except Exception as error: failures.append(error)
        if failures: raise RuntimeError('Signing service restart failed; preserve snapshot and review every service') from failures[0]
    signing.status(ROOT); signing.health(ROOT)
    return snapshot


def backup():
    from contextlib import ExitStack
    with ExitStack() as locks:
        if GATEWAY_ROOT.exists():
            if GATEWAY_ROOT.is_symlink() or GATEWAY_ROOT.stat().st_uid != 0 or GATEWAY_ROOT.stat().st_mode & 0o077:
                raise ValueError('Private owned gateway recovery required')
            import fcntl
            lock = locks.enter_context((GATEWAY_ROOT / 'operations.lock').open('a'))
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if RECIPIENT_ROOT.exists():
            if RECIPIENT_ROOT.is_symlink() or RECIPIENT_ROOT.stat().st_uid != 0 or RECIPIENT_ROOT.stat().st_mode & 0o077:
                raise ValueError('Private owned recipient recovery required')
            import fcntl
            lock = locks.enter_context((RECIPIENT_ROOT / 'operations.lock').open('a'))
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if CALLBACK_ROOT.exists():
            if CALLBACK_ROOT.is_symlink() or CALLBACK_ROOT.stat().st_uid!=0 or CALLBACK_ROOT.stat().st_mode&0o077:raise ValueError('Private callback recovery required')
            import fcntl
            lock=locks.enter_context((CALLBACK_ROOT/'operations.lock').open('a'));fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        return backup_data()


def validate_snapshot(snapshot):
    if snapshot.resolve() != snapshot or snapshot.parent != ROOT / 'backups' or snapshot.is_symlink() or snapshot.stat().st_uid != 0 or snapshot.stat().st_mode & 0o077:
        raise ValueError('Exact private signing snapshot required')
    manifest = json.loads((snapshot / 'backup-manifest.json').read_text())
    present = set(manifest.get('files', {}))
    if manifest.get('version') != 1 or manifest.get('images') != signing.IMAGES or not set(CONFIG) <= present or not present <= set(CONFIG + TRUST + BOOTSTRAP + GATEWAY + RECIPIENT + CALLBACK) or set(manifest.get('fileMetadata', {})) != present or set(manifest.get('volumes', {})) != {'database', 'cache'} or (present & set(GATEWAY) and not set(GATEWAY) <= present) or (present & set(RECIPIENT) and not set(RECIPIENT) <= present) or (present & set(CALLBACK) and not set(CALLBACK)<=present):
        raise ValueError('Signing recovery manifest differs')
    for name, digest in manifest['files'].items():
        if (snapshot / name).is_symlink() or checksum(snapshot / name) != digest: raise ValueError('Signing configuration/key checksum differs')
        owner = config_owner(name)
        if manifest['fileMetadata'][name] != {'uid': owner, 'gid': owner, 'mode': 0o600}:
            raise ValueError('Signing restore configuration ownership/mode differs')
    if present & set(GATEWAY):
        directory = snapshot / 'gateway'
        if directory.is_symlink() or not directory.is_dir() or directory.stat().st_uid != 0 or directory.stat().st_mode & 0o077:
            raise ValueError('Private gateway snapshot directory required')
    if present & set(RECIPIENT):
        directory = snapshot / 'recipient'
        if directory.is_symlink() or not directory.is_dir() or directory.stat().st_uid != 0 or directory.stat().st_mode & 0o077:
            raise ValueError('Private recipient snapshot directory required')
    if present & set(CALLBACK):
        directory=snapshot/'callback'
        if directory.is_symlink() or not directory.is_dir() or directory.stat().st_uid!=0 or directory.stat().st_mode&0o077:raise ValueError('Private callback snapshot directory required')
    for name, record in manifest['volumes'].items():
        target = snapshot / (name + '.tar')
        if target.is_symlink() or checksum(target) != record['sha256']: raise ValueError('Signing archive checksum differs')
        with tarfile.open(target) as archive: validate_archive(archive)
    return manifest


def database_probe(volume, password, expected):
    name = 'codexdentist-signing-restore-' + uuid.uuid4().hex
    # Alpine PostgreSQL's exact pinned image owns data as UID/GID 70. Verify
    # that identity before using it; never relax source or restored permissions.
    uid = signing.run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--entrypoint', 'id', signing.IMAGES['database'], '-u', 'postgres']).decode().strip()
    if uid != '70': raise ValueError('Pinned PostgreSQL identity differs')
    try:
        signing.run(['docker', 'run', '-d', '--name', name, '--label', 'com.codexdentist.restore=' + name,
            '--network', 'none', '--read-only', '--user', '70:70', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--memory', '512m', '--cpus', '0.5', '--log-driver', 'none', '--tmpfs', '/var/run/postgresql:rw,nosuid,size=8m,uid=70,gid=70,mode=0700',
            '--mount', 'type=volume,source=' + volume + ',target=/var/lib/postgresql/data,volume-nocopy', signing.IMAGES['database'],
            'postgres', '-c', 'listen_addresses=127.0.0.1'])
        for attempt in range(60):
            try:
                sql(name, password, 'SELECT 1'); break
            except RuntimeError:
                if attempt == 59: raise
                time.sleep(0.5)
        if counts(name, password) != expected: raise ValueError('Restored signing database counts differ')
    finally:
        probe = subprocess.run(['docker', 'inspect', name], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if probe.returncode == 0:
            if json.loads(probe.stdout)[0].get('Config', {}).get('Labels', {}).get('com.codexdentist.restore') != name:
                raise ValueError('Restore container ownership differs')
            signing.run(['docker', 'rm', '-f', name])


def cache_probe(volume, password):
    name = 'codexdentist-signing-cache-restore-' + uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix='signing-cache-restore-') as temporary:
        config = Path(temporary) / 'valkey.conf'
        signing.private(config, ('bind 127.0.0.1\nport 6379\nrequirepass ' + password + '\nappendonly yes\ndir /data\nmaxmemory 96mb\nmaxmemory-policy noeviction\n').encode())
        os.chown(config, 999, 1000)
        try:
            signing.run(['docker', 'run', '-d', '--name', name, '--label', 'com.codexdentist.restore=' + name,
                '--network', 'none', '--read-only', '--user', '999:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                '--memory', '160m', '--cpus', '0.5', '--log-driver', 'none',
                '--mount', 'type=volume,source=' + volume + ',target=/data,volume-nocopy',
                '--mount', 'type=bind,source=' + str(config) + ',target=/secrets/valkey.conf,readonly',
                '--entrypoint', 'valkey-server', signing.IMAGES['cache'], '/secrets/valkey.conf'])
            for attempt in range(30):
                try:
                    reply = signing.run(['docker', 'exec', '-i', name, 'sh', '-c',
                        'IFS= read -r REDISCLI_AUTH; export REDISCLI_AUTH; exec valkey-cli --no-auth-warning PING'], input=(password + '\n').encode())
                    if reply.strip() != b'PONG': raise RuntimeError('Restored signing cache unavailable')
                    break
                except RuntimeError:
                    if attempt == 29: raise
                    time.sleep(0.5)
        finally:
            probe = subprocess.run(['docker', 'inspect', name], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if probe.returncode == 0:
                if json.loads(probe.stdout)[0].get('Config', {}).get('Labels', {}).get('com.codexdentist.restore') != name:
                    raise ValueError('Restored cache container ownership differs')
                signing.run(['docker', 'rm', '-f', name])


def configuration_probe(snapshot, metadata):
    # Snapshot files stay root-only in custody. Recreate deployment ownership
    # only on disposable copies and prove the actual app UID can use them.
    with tempfile.TemporaryDirectory(prefix='signing-config-restore-') as temporary:
        restored = Path(temporary)
        for name in CONFIG + [name for name in TRUST if (snapshot / name).exists()]:
            shutil.copyfile(snapshot / name, restored / name)
            row = metadata[name]; os.chown(restored / name, row['uid'], row['gid']); (restored / name).chmod(row['mode'])
        pin=json.loads((snapshot/'manifest.json').read_text())
        # Validate exact trust bundle and stage composition on the restored
        # copies, without starting a producer or releasing queued email.
        signing.installation(restored)
        if pin.get('callbackCertificateSha256') is not None:
            certificate=restored/'callback-trust.cert.pem'
            if not certificate.is_file() or checksum(certificate)!=pin['callbackCertificateSha256']:
                raise ValueError('Restored provider callback trust differs')
            signing.run(['openssl','x509','-in',str(certificate),'-noout','-checkend','0'])
            signing.run(['docker','run','--rm','--network','none','--read-only','--user','1001:1001','--cap-drop','ALL',
                '--mount','type=bind,source='+str(certificate)+',target=/proof/callback.cert.pem,readonly','--entrypoint','node',signing.IMAGES['app'],
                '-e',"new(require('node:crypto').X509Certificate)(require('node:fs').readFileSync('/proof/callback.cert.pem'))"])
        elif (restored/'callback-trust.cert.pem').exists():raise ValueError('Unexpected restored callback trust')
        signing.run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '1001:1001',
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '0.5',
            '--mount', 'type=bind,source=' + str(restored / 'signing.p12') + ',target=/secrets/signing.p12,readonly',
            '--mount', 'type=bind,source=' + str(restored / 'license-cache.json') + ',target=/app/.documenso-license.json',
            '--entrypoint', 'node', signing.IMAGES['app'], '-e',
            "const fs=require('fs');if(!fs.readFileSync('/secrets/signing.p12').length)throw Error();const p='/app/.documenso-license.json';const value=fs.readFileSync(p);fs.writeFileSync(p,value)"])


def gateway_probe(snapshot):
    directory = snapshot / 'gateway'
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest.get('image') != GATEWAY_IMAGE or manifest.get('published') is not False or manifest.get('coreConnected') is not False:
        raise ValueError('Only the accepted private gateway restore stage is supported')
    if checksum(directory / 'nginx.conf') != manifest['configSha256'] or checksum(directory / 'gateway.cert.pem') != manifest['certificateSha256']:
        raise ValueError('Gateway restore identity differs')
    public = signing.run(['openssl', 'x509', '-in', str(directory / 'gateway.cert.pem'), '-pubkey', '-noout'])
    key_public = signing.run(['openssl', 'pkey', '-in', str(directory / 'gateway.key.pem'), '-pubout'])
    if public != key_public: raise ValueError('Restored gateway TLS key/certificate differ')
    with tempfile.TemporaryDirectory(prefix='signing-gateway-restore-') as temporary:
        root = Path(temporary)
        for name in ['nginx.conf', 'gateway.key.pem', 'gateway.cert.pem']:
            shutil.copyfile(directory / name, root / name); os.chown(root / name, 101, 101); (root / name).chmod(0o600)
        mounts = []
        for name, target in [('nginx.conf', '/etc/nginx/nginx.conf'), ('gateway.key.pem', '/secrets/gateway.key.pem'), ('gateway.cert.pem', '/secrets/gateway.cert.pem')]:
            mounts += ['--mount', 'type=bind,source=' + str(root / name) + ',target=' + target + ',readonly']
        signing.run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '101:101', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '0.5', '--tmpfs', '/tmp:rw,nosuid,size=16m,uid=101,gid=101,mode=0700',
            *mounts, '--entrypoint', 'nginx', GATEWAY_IMAGE, '-t'])


def recipient_probe(snapshot):
    spec = importlib.util.spec_from_file_location('restored_recipient', Path(__file__).with_name('owned-signing-recipient.py'))
    recipient = importlib.util.module_from_spec(spec); spec.loader.exec_module(recipient)
    directory = snapshot / 'recipient'
    config = json.loads((directory / 'compose.json').read_text())
    recipient.PROJECT = config['name']
    recipient.PROVIDER_PROJECT = config['networks']['ceremony']['name'].removesuffix('-gateway_recipient')
    recipient.EDGE = config['networks']['edge']['name']
    pin = json.loads((directory / 'manifest.json').read_text())
    if config != recipient.configuration() or json.loads((directory / 'router.json').read_text()) != recipient.router() or (directory / 'nginx.conf').read_bytes() != recipient.template() or pin != {
        'version': 1, 'image': GATEWAY_IMAGE, 'configSha256': hashlib.sha256(recipient.template()).hexdigest(),
        'published': pin.get('published'), 'coreConnected': False} or type(pin.get('published')) is not bool:
        raise ValueError('Restored recipient configuration differs')
    with tempfile.TemporaryDirectory(prefix='signing-recipient-restore-') as temporary:
        config_path = Path(temporary) / 'nginx.conf'
        shutil.copyfile(directory / 'nginx.conf', config_path); os.chown(config_path, 101, 101); config_path.chmod(0o600)
        signing.run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '101:101', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '0.5', '--tmpfs', '/tmp:rw,nosuid,size=16m,uid=101,gid=101,mode=0700',
            '--mount', 'type=bind,source=' + str(config_path) + ',target=/etc/nginx/nginx.conf,readonly',
            '--entrypoint', 'nginx', GATEWAY_IMAGE, '-t'])


def callback_probe(snapshot):
    spec=importlib.util.spec_from_file_location('restored_callback',Path(__file__).with_name('owned-signing-callback.py'))
    callback=importlib.util.module_from_spec(spec);spec.loader.exec_module(callback)
    directory=snapshot/'callback';config=json.loads((directory/'compose.json').read_text())
    callback.PROJECT=config['name'];callback.PROVIDER_PROJECT=config['networks']['provider']['name'].removesuffix('_private')
    pin=json.loads((directory/'manifest.json').read_text())
    if config!=callback.configuration() or (directory/'nginx.conf').read_bytes()!=callback.template() or pin!={
        'version':1,'image':GATEWAY_IMAGE,'coreConnected':False,'configSha256':checksum(directory/'nginx.conf'),
        'certificateSha256':checksum(directory/'callback.cert.pem')}:raise ValueError('Restored callback configuration differs')
    public=signing.run(['openssl','x509','-in',str(directory/'callback.cert.pem'),'-pubkey','-noout'])
    if public!=signing.run(['openssl','pkey','-in',str(directory/'callback.key.pem'),'-pubout']):raise ValueError('Restored callback TLS identity differs')
    with tempfile.TemporaryDirectory(prefix='signing-callback-restore-') as temporary:
        root=Path(temporary);mounts=[]
        for name,target in [('nginx.conf','/etc/nginx/nginx.conf'),('callback.key.pem','/secrets/callback.key.pem'),('callback.cert.pem','/secrets/callback.cert.pem')]:
            shutil.copyfile(directory/name,root/name);os.chown(root/name,101,101);(root/name).chmod(0o600)
            mounts+=['--mount','type=bind,source='+str(root/name)+',target='+target+',readonly']
        signing.run(['docker','run','--rm','--network','none','--read-only','--user','101:101','--cap-drop','ALL',
            '--tmpfs','/tmp:rw,nosuid,size=32m,uid=101,gid=101,mode=0700',*mounts,'--entrypoint','nginx',GATEWAY_IMAGE,'-t'])


def drill(snapshot):
    manifest = validate_snapshot(snapshot)
    signing.run(['openssl', 'pkcs12', '-in', str(snapshot / 'signing.p12'), '-passin', 'file:' + str(snapshot / 'certificate.pass'), '-noout'])
    configuration_probe(snapshot, manifest['fileMetadata'])
    if set(GATEWAY) <= set(manifest['files']): gateway_probe(snapshot)
    if set(RECIPIENT) <= set(manifest['files']): recipient_probe(snapshot)
    if set(CALLBACK)<=set(manifest['files']):callback_probe(snapshot)
    for name, record in manifest['volumes'].items():
        volume = 'codexdentist-signing-restore-' + uuid.uuid4().hex
        signing.run(['docker', 'volume', 'create', '--label', 'com.codexdentist.restore=' + volume, volume])
        try:
            with (snapshot / (name + '.tar')).open('rb') as source:
                signing.run(volume_command(volume, True) + ['--entrypoint', 'tar', signing.IMAGES['app'], '--numeric-owner', '-xpf', '-', '-C', '/snapshot'], stdin=source)
            if inventory(volume) != record['entries']: raise ValueError('Restored signing bytes/ownership/modes differ')
            keys = json.loads((snapshot / 'keys.json').read_text())
            if name == 'database': database_probe(volume, keys['database'], manifest['databaseCounts'])
            else: cache_probe(volume, keys['cache'])
        finally:
            if inspect('volume', volume).get('Labels', {}).get('com.codexdentist.restore') != volume: raise ValueError('Restore volume ownership differs')
            signing.run(['docker', 'volume', 'rm', volume])
    proof = {'allHashes': True, 'ownershipAndModes': True, 'applicationConfigurationUsable': True, 'databaseCounts': True, 'cacheAuthenticationAndAof': True,
        'certificatePassphrase': True, 'appOrMailWorkersStarted': False}
    if set(GATEWAY) <= set(manifest['files']): proof['gatewayConfigurationUsable'] = True
    if set(RECIPIENT) <= set(manifest['files']): proof['recipientConfigurationUsable'] = True
    if set(CALLBACK)<=set(manifest['files']):proof['callbackConfigurationUsable']=True
    proof = json.dumps(proof).encode()
    target = snapshot / 'restore-verified.json'
    if target.exists():
        if target.is_symlink() or target.read_bytes() != proof: raise ValueError('Preserve changed signing restore evidence')
    else: signing.private(target, proof)
    print('PASS isolated signing restore: all bytes/modes/keys and PostgreSQL counts; no app, mail or job workers.')


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['backup', 'drill']); parser.add_argument('--snapshot'); args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Root-owned recovery operator required')
    os.umask(0o077); signing.installation(ROOT)
    import fcntl
    with (ROOT / 'operations.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'backup':
            if args.snapshot: raise ValueError('Backup creates its own unique snapshot')
            snapshot = backup(); drill(snapshot); print(snapshot)
        else:
            if not args.snapshot: raise ValueError('Explicit private snapshot required')
            drill(Path(args.snapshot))


if __name__ == '__main__': main()
