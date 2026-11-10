#!/usr/bin/env python3
"""Separate recipient-only process. Publish only its dedicated token-safe router."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request
import urllib.error

spec = importlib.util.spec_from_file_location('recipient_gateway', Path(__file__).with_name('owned-signing-gateway.py'))
gateway = importlib.util.module_from_spec(spec); spec.loader.exec_module(gateway)
ROOT = Path('/opt/codexdentist-signing-recipient')
PROJECT = 'codexdentist-signing-recipient'
PROVIDER_PROJECT = gateway.PROVIDER_PROJECT
EDGE = 'coolify'
ROUTE = Path('/data/coolify/proxy/dynamic/codexdentist-signing.yaml')
IMAGE = gateway.IMAGE


def template():
    source = gateway.TEMPLATE.read_text()
    common, servers = source.split('  # Private application API.', 1)
    _, recipient = servers.split('  # Recipient web ceremony only.', 1)
    # Use only the existing recipient listener, not the provider's app/database
    # network. The edge process cannot resolve/reach the provider database.
    return (common + '  # Recipient web ceremony only.' + recipient).replace('http://app:3000', 'http://proxy:8080').encode()


def configuration():
    if not re.fullmatch(r'codexdentist-(?:owned-signing|signing-test-[a-f0-9]{32})', PROVIDER_PROJECT):
        raise ValueError('Explicit isolated provider required')
    if PROJECT == 'codexdentist-signing-recipient':
        if PROVIDER_PROJECT != 'codexdentist-owned-signing' or EDGE != 'coolify': raise ValueError('Reviewed owned edge required')
    elif PROJECT != PROVIDER_PROJECT + '-recipient' or EDGE != PROJECT + '-edge':
        raise ValueError('Unique synthetic recipient edge required')
    return {'name': PROJECT, 'services': {'web': {
        'image': IMAGE, 'entrypoint': ['nginx', '-g', 'daemon off;'], 'restart': 'unless-stopped',
        'user': '101:101', 'read_only': True, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'cpus': 0.5, 'mem_limit': '128m', 'pids_limit': 64, 'logging': {'driver': 'none'},
        'ulimits': {'nofile': {'soft': 4096, 'hard': 4096}},
        'tmpfs': ['/tmp:rw,nosuid,noexec,size=80m,uid=101,gid=101,mode=0700'],
        'networks': {'ceremony': {}, 'edge': {'aliases': ['codexdentist-signing-recipient']}},
        'volumes': [{'type': 'bind', 'source': './nginx.conf', 'target': '/etc/nginx/nginx.conf', 'read_only': True}]}},
        'networks': {'ceremony': {'external': True, 'name': PROVIDER_PROJECT + '-gateway_recipient'},
                     'edge': {'external': True, 'name': EDGE}}}


def router():
    base = {'rule': 'Host(`sign.codexdentist.com`)', 'priority': 250000,
            'service': 'codexdentist-signing', 'observability': {'accessLogs': False, 'tracing': False}}
    return {'http': {'routers': {
        'codexdentist-signing-https': {**base, 'entryPoints': ['https'], 'tls': {}},
        'codexdentist-signing-http': {**base, 'entryPoints': ['http'], 'middlewares': ['codexdentist-signing-redirect']}},
        'services': {'codexdentist-signing': {'loadBalancer': {'servers': [{'url': 'http://codexdentist-signing-recipient:8080'}]}}},
        'middlewares': {'codexdentist-signing-redirect': {'redirectScheme': {'scheme': 'https', 'permanent': True}}}}}


def prepare():
    if ROOT.exists(): raise ValueError('Preserve existing recipient installation')
    existing = subprocess.run(['docker', 'inspect', PROJECT + '-web-1'], capture_output=True)
    if existing.returncode == 0: raise ValueError('Preserve existing recipient container without its installation')
    gateway.installation(); gateway.status()
    edge = json.loads(gateway.run(['docker', 'network', 'inspect', EDGE]))[0]
    if edge.get('Internal') is not (PROJECT != 'codexdentist-signing-recipient'): raise ValueError('Explicit existing proxy edge required')
    ROOT.mkdir(mode=0o700)
    gateway.private(ROOT / 'nginx.conf', template(), 101)
    gateway.private(ROOT / 'compose.json', json.dumps(configuration()).encode())
    gateway.private(ROOT / 'router.json', json.dumps(router()).encode())
    gateway.private(ROOT / 'manifest.json', json.dumps({'version': 1, 'image': IMAGE,
        'configSha256': hashlib.sha256(template()).hexdigest(), 'published': False, 'coreConnected': False}).encode())


def installation(expected_template=None, expected_configuration=None):
    if ROOT.is_symlink() or ROOT.stat().st_uid != 0 or ROOT.stat().st_mode & 0o077: raise ValueError('Private recipient custody required')
    for name in ['nginx.conf', 'compose.json', 'router.json', 'manifest.json']:
        path = ROOT / name; owner = 101 if name == 'nginx.conf' else 0
        if path.is_symlink() or not path.is_file() or path.stat().st_uid != owner or path.stat().st_gid != owner or path.stat().st_mode & 0o777 != 0o600:
            raise ValueError('Recipient configuration custody differs')
    pin = json.loads((ROOT / 'manifest.json').read_text())
    expected_template = template() if expected_template is None else expected_template
    if pin != {'version': 1, 'image': IMAGE, 'configSha256': hashlib.sha256(expected_template).hexdigest(),
               'published': pin.get('published'), 'coreConnected': False} or type(pin.get('published')) is not bool:
        raise ValueError('Reviewed recipient identity required')
    if (ROOT / 'nginx.conf').read_bytes() != expected_template or json.loads((ROOT / 'compose.json').read_text()) != (configuration() if expected_configuration is None else expected_configuration) or json.loads((ROOT / 'router.json').read_text()) != router():
        raise ValueError('Preserve changed recipient configuration')
    return pin


def status():
    pin = installation()
    info = json.loads(gateway.run(['docker', 'inspect', PROJECT + '-web-1']))[0]; host = info['HostConfig']
    if not info['State']['Running'] or info['State'].get('Restarting') or info['Config']['Image'] != IMAGE or info['Config']['User'] != '101:101' or host.get('PortBindings') or host.get('Privileged') or not host['ReadonlyRootfs']:
        raise ValueError('Recipient process isolation differs')
    if set(info['NetworkSettings']['Networks']) != {PROVIDER_PROJECT + '-gateway_recipient', EDGE} or host.get('LogConfig', {}).get('Type') != 'none' or 'ALL' not in host.get('CapDrop', []) or not any(x.startswith('no-new-privileges') for x in host.get('SecurityOpt', [])):
        raise ValueError('Recipient network/log/capability isolation differs')
    if not any(row == {'Name': 'nofile', 'Soft': 4096, 'Hard': 4096} for row in host.get('Ulimits') or []):
        raise ValueError('Recipient descriptor capacity differs')
    mounts = info['Mounts']
    if len(mounts) != 1 or mounts[0]['Source'] != str(ROOT / 'nginx.conf') or mounts[0]['Destination'] != '/etc/nginx/nginx.conf' or mounts[0]['RW']:
        raise ValueError('Recipient must mount only its read-only HTTP configuration')
    if pin['published'] and (ROUTE.is_symlink() or not ROUTE.is_file() or ROUTE.read_bytes() != (ROOT / 'router.json').read_bytes()):
        raise ValueError('Published route differs; preserve for review')
    gateway.status()
    print('PASS separate recipient-only process; private API remains internal and no provider secrets are mounted.')


def request(path, public=False):
    if public:
        # Never follow redirects into a broader administrative origin.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args): return None
        opener = urllib.request.build_opener(NoRedirect)
        try:
            request = urllib.request.Request('https://sign.codexdentist.com' + path,
                headers={'User-Agent': 'Codexdentist-Readiness/1.0', 'Cache-Control': 'no-cache'})
            with opener.open(request, timeout=15) as response:
                return response.status, response.read(65537)
        except urllib.error.HTTPError as error: return error.code, error.read(65537)
    script = "const http=require('http');const r=http.get({hostname:process.argv[1],port:8080,path:process.argv[2],headers:{host:'sign.codexdentist.com'}},s=>{let b='';s.on('data',c=>{b+=c;if(b.length>65536)r.destroy(Error())});s.on('end',()=>console.log(JSON.stringify([s.statusCode,b])))});r.setTimeout(10000,()=>r.destroy(Error()));r.on('error',()=>process.exit(1));"
    image = gateway.PROBE_IMAGE or 'codexdentist:' + json.loads(Path('/opt/codexdentist-deploy/current.json').read_text())['sha']
    if not re.fullmatch(r'codexdentist:(?:ci|[a-f0-9]{40})', image): raise ValueError('Exact compatible image required')
    result = gateway.run(['docker', 'run', '--rm', '--network', EDGE, '--read-only', '--user', '101:101', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '0.5', '--entrypoint', 'node', image,
        '-e', script, 'codexdentist-signing-recipient', path])
    status_code, body = json.loads(result); return status_code, body.encode()


def probe(public=False):
    for attempt in range(20):
        try:
            if request('/ready', public) == (200, b'recipient gateway ready'): break
        except (RuntimeError, OSError): pass
        if attempt == 19: raise ValueError('Recipient readiness failed')
        time.sleep(0.5)
    for path in ['/', '/signup', '/signin', '/admin/users.data', '/api/auth/csrf', '/api/v2/envelope', '/api/trpc/apiToken.create', '/api/trpc/recipient.completeDocumentWithToken,apiToken.create']:
        if request(path, public)[0] != 404: raise ValueError('Recipient administrative surface exposed')
    if not public:
        image = gateway.PROBE_IMAGE or 'codexdentist:' + json.loads(Path('/opt/codexdentist-deploy/current.json').read_text())['sha']
        if not re.fullmatch(r'codexdentist:(?:ci|[a-f0-9]{40})', image): raise ValueError('Exact compatible image required')
        code = "const n=require('net'),s=n.createConnection({host:'codexdentist-signing-recipient',port:3443});s.setTimeout(5000,()=>{s.destroy();process.exit(1)});s.on('connect',()=>{s.destroy();process.exit(1)});s.on('error',e=>process.exit(e.code==='ECONNREFUSED'?0:1));"
        gateway.run(['docker', 'run', '--rm', '--network', EDGE, '--read-only', '--user', '101:101', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '0.5', '--entrypoint', 'node', image, '-e', code])
    print('PASS ' + ('public HTTPS' if public else 'edge-network') + ' recipient health and administrative/API denials; no messages submitted.')


def recovery_module():
    spec = importlib.util.spec_from_file_location('recipient_recovery', Path(__file__).with_name('owned-signing-backup.py'))
    recovery = importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)
    return recovery


def restored_snapshot(snapshot):
    # The exact combined snapshot must already contain and restore this frontend.
    recovery = recovery_module()
    manifest = recovery.validate_snapshot(snapshot)
    proof = json.loads((snapshot / 'restore-verified.json').read_text())
    required = ['allHashes', 'ownershipAndModes', 'applicationConfigurationUsable', 'databaseCounts',
                'cacheAuthenticationAndAof', 'certificatePassphrase', 'gatewayConfigurationUsable', 'recipientConfigurationUsable']
    if any(proof.get(name) is not True for name in required) or proof.get('appOrMailWorkersStarted') is not False:
        raise ValueError('Recipient recovery must precede publication')
    for name in recovery.RECIPIENT:
        if manifest['files'].get(name) != hashlib.sha256((ROOT / name.removeprefix('recipient/')).read_bytes()).hexdigest():
            raise ValueError('Exact current recipient recovery required')


def publish(snapshot):
    pin = installation()
    if pin['published']: status(); probe(True); return
    if ROUTE.exists() or ROUTE.is_symlink(): raise ValueError('Preserve existing proxy route')
    status(); probe(); restored_snapshot(snapshot)
    proposed = (ROOT / 'router.json').read_bytes()
    intent = ROOT / 'publication.intent.json'
    gateway.private(intent, json.dumps({'routeSha256': hashlib.sha256(proposed).hexdigest()}).encode())
    before_manifest = (ROOT / 'manifest.json').read_bytes()
    after_manifest = json.dumps({**pin, 'published': True}).encode()
    # An atomic no-replace link prevents the file watcher seeing a partial route.
    pending = ROUTE.with_suffix('.pending')
    gateway.private(pending, proposed)
    try:
        os.link(pending, ROUTE); pending.unlink()
        probe(True)
        gateway.replace(ROOT / 'manifest.json', after_manifest)
        status()
    except BaseException:
        if ROUTE.is_file() and not ROUTE.is_symlink() and ROUTE.read_bytes() == proposed and (ROOT / 'manifest.json').read_bytes() in [before_manifest, after_manifest]:
            # Remove only our exact newly-created router; never touch global proxy configuration.
            ROUTE.unlink()
            gateway.replace(ROOT / 'manifest.json', before_manifest)
        else: raise ValueError('Preserve concurrent proxy route changes for review')
        raise
    gateway.private(ROOT / 'publication.accepted.json', json.dumps({'https': True, 'adminDenied': True,
        'privateApiExposed': False, 'externalMailSent': False, 'coreConnected': False}).encode())


def concurrent_probe():
    image = gateway.PROBE_IMAGE or 'codexdentist:' + json.loads(Path('/opt/codexdentist-deploy/current.json').read_text())['sha']
    if not re.fullmatch(r'codexdentist:(?:ci|[a-f0-9]{40})', image): raise ValueError('Exact compatible image required')
    # A small synthetic static response still opens both proxy hops. No token,
    # patient file or mutation is involved in this capacity regression gate.
    code = "const http=require('http');function req(){return new Promise((ok,bad)=>{const r=http.get({hostname:'codexdentist-signing-recipient',port:8080,path:'/fonts/nonexistent-synthetic-capacity-probe.woff2'},s=>{s.resume();s.on('end',()=>s.statusCode===404?ok():bad(Error()))});r.setTimeout(10000,()=>r.destroy(Error()));r.on('error',bad)})}Promise.all(Array.from({length:220},req)).then(()=>console.log('PASS 220 concurrent recipient static requests without resets or 502')).catch(()=>process.exit(1));"
    gateway.run(['docker', 'run', '--rm', '--network', EDGE, '--read-only', '--cap-drop', 'ALL', '--memory', '128m',
                 '--cpus', '0.5', '--entrypoint', 'node', image, '-e', code])


def upgrade_capacity():
    pairs = [(gateway.ROOT, gateway.template(), gateway.configuration(), gateway.installation),
             (ROOT, template(), configuration(), installation)]
    changes = []
    for root, desired, config, validate in pairs:
        old = desired.replace(b'worker_connections 1024;', b'worker_connections 256;')
        old_config = json.loads(json.dumps(config)); next(iter(old_config['services'].values())).pop('ulimits')
        if (root / 'nginx.conf').read_bytes() != old: raise ValueError('Only exact reviewed capacity transition allowed')
        validate(old, old_config)
        for name, after in [('nginx.conf', desired), ('compose.json', json.dumps(config).encode())]:
            changes.append((root / name, (root / name).read_bytes(), after, 101 if name == 'nginx.conf' else 0))
        pin = json.loads((root / 'manifest.json').read_text()); pin['configSha256'] = hashlib.sha256(desired).hexdigest()
        changes.append((root / 'manifest.json', (root / 'manifest.json').read_bytes(), json.dumps(pin).encode(), 0))
    record = ROOT / 'capacity-upgrade-before'; record.mkdir(mode=0o700)
    for index, (path, before, after, uid) in enumerate(changes): gateway.private(record / str(index), before)
    def recreate():
        gateway.recreate()
        gateway.run(['docker', 'compose', '--project-directory', str(ROOT), '-f', str(ROOT / 'compose.json'),
            'up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', 'web'])
    try:
        for path, before, after, uid in changes: gateway.replace(path, after, uid)
        recreate(); status(); gateway.probe(); probe(); concurrent_probe(); probe(True)
    except BaseException:
        if any(path.is_symlink() or path.read_bytes() not in [before, after] for path,before,after,uid in changes):
            raise ValueError('Preserve concurrent capacity configuration changes')
        for path,before,after,uid in changes: gateway.replace(path,before,uid)
        recreate()
        raise
    gateway.private(ROOT / 'capacity-upgrade-accepted.json', json.dumps({'workerConnections': 1024,
        'nofile': 4096, 'concurrentStaticRequests': 220, 'tlsIdentityPreserved': True, 'routerPreserved': True}).encode())


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('action', choices=['prepare', 'up', 'status', 'probe', 'publish', 'upgrade-capacity']); parser.add_argument('--snapshot'); args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Root-owned recipient operator required')
    os.umask(0o077)
    if args.action == 'prepare': prepare(); return
    if args.action == 'upgrade-capacity':
        import fcntl
        from contextlib import ExitStack
        with ExitStack() as stack:
            for root in [gateway.PROVIDER, gateway.ROOT, ROOT]:
                if root.is_symlink() or root.stat().st_uid != 0 or root.stat().st_mode & 0o077: raise ValueError('Private installation required')
                lock = stack.enter_context((root / 'operations.lock').open('a')); fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            upgrade_capacity()
        return
    installation()
    import fcntl
    with (ROOT / 'operations.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'publish':
            if not args.snapshot: raise ValueError('Explicit restored combined snapshot required')
            publish(Path(args.snapshot)); return
        if args.action == 'up': gateway.run(['docker', 'compose', '--project-directory', str(ROOT), '-f', str(ROOT / 'compose.json'), 'up', '-d', '--pull', 'never'])
        status()
        if args.action in ['up', 'probe']: probe()


if __name__ == '__main__': main()
