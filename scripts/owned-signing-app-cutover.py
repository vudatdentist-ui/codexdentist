#!/usr/bin/env python3
"""Reviewed same-image private signing attachment; never create a consent or email."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import time
import uuid


def load(name, filename):
    path = Path(filename)
    spec = importlib.util.spec_from_file_location(name, path if path.is_absolute() else Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


mail = load('signing_app_mail', 'owned-mail-app-cutover.py')
trust = load('signing_app_trust', 'runtime-public-ca.py')
smtp = load('signing_app_smtp', 'owned-signing-smtp.py')
attachments = load('signing_app_attachments', 'owned-mail-attachments.py')
ROOT = mail.ROOT
SIGNING = Path('/opt/codexdentist-owned-signing')
GATEWAY = Path('/opt/codexdentist-owned-signing-gateway')
COMPOSE = mail.COMPOSE
CONTAINER = mail.CONTAINER
NETWORKS = {'owned_signing_api': 'codexdentist-owned-signing-gateway_api',
    'owned_signing_callback_core': 'codexdentist-signing-callback_core'}
ALIAS = 'codexdentist-signing-core'
UPDATES = {'DOCUMENSO_DEFAULT_BASE_URL': 'https://codexdentist-signing-gateway:3443/api/v2',
    'DOCUMENSO_SEND_OWNER_EMAILS': 'false', 'NODE_EXTRA_CA_CERTS': trust.SERVICE_TARGET}


def compose_text(text):
    if any(key in text for key in [*NETWORKS, trust.SERVICE_SOURCE, trust.SERVICE_TARGET]):
        raise ValueError('Preserve existing signing network/trust transition')
    blocks = list(re.finditer(r'(?m)^  codexdentist:\s*\n(?:(?:^    [^\r\n]*|^[ \t]*)\n)*', text))
    if len(blocks) != 1: raise ValueError('Exactly one existing core service required')
    block = blocks[0]; lines = block.group().splitlines(keepends=True)
    positions = [i for i, line in enumerate(lines) if line == '    networks:\n']
    if len(positions) != 1: raise ValueError('Exactly one core network list required')
    first = positions[0] + 1; end = first; existing = []
    while end < len(lines):
        row = re.fullmatch(r'\s{4,6}- ([A-Za-z0-9_-]+)\n', lines[end])
        if not row: break
        existing.append(row[1]); end += 1
    if not existing or len(existing) != len(set(existing)) or (end < len(lines) and lines[end].startswith('      ')):
        raise ValueError('Review a non-sequence existing network configuration')
    lines[first:end] = ['      ' + key + ': null\n' for key in existing] + [
        '      owned_signing_api: null\n', '      owned_signing_callback_core:\n',
        '        aliases:\n', '          - ' + ALIAS + '\n']
    positions = [i for i, line in enumerate(lines) if line == '    volumes:\n']
    if len(positions) != 1: raise ValueError('Exactly one existing core volume list required')
    first = positions[0] + 1
    if first >= len(lines) or not re.match(r'^(    |      )- ', lines[first]): raise ValueError('Core volume sequence required')
    indent = lines[first].split('-', 1)[0]; end = first
    while end < len(lines) and (lines[end].startswith('      ') or lines[end].startswith('    - ')): end += 1
    lines[end:end] = [indent + value + '\n' for value in ['- type: bind', '  source: ' + trust.SERVICE_SOURCE,
        '  target: ' + trust.SERVICE_TARGET, '  read_only: true']]
    updated = text[:block.start()] + ''.join(lines) + text[block.end():]
    extra = ''.join('  ' + key + ':\n    external: true\n    name: ' + name + '\n' for key, name in NETWORKS.items())
    updated, count = re.subn(r'(?m)^networks:\n', 'networks:\n' + extra, updated)
    if count != 1: raise ValueError('Existing global networks required')
    return updated


def equivalent_config(before, after):
    expected = json.loads(json.dumps(before)); core = expected['services']['codexdentist']
    if any(key in expected['networks'] or key in core['networks'] for key in NETWORKS):
        raise ValueError('Review an existing signing configuration')
    for key, name in NETWORKS.items():
        expected['networks'][key] = {'external': True, 'name': name, 'ipam': {}}
        core['networks'][key] = {'aliases': [ALIAS]} if key == 'owned_signing_callback_core' else None
    core['environment'].update(UPDATES)
    core['volumes'].append({'type': 'bind', 'source': trust.SERVICE_SOURCE, 'target': trust.SERVICE_TARGET, 'read_only': True})
    if after != expected: raise ValueError('Unexpected change outside signing environment, private networks and public CA bundle')


def validate_runtime(before, after):
    old = mail.runtime_environment(before); actual = mail.runtime_environment(after)
    if after['Image'] != before['Image'] or actual != {**old, **UPDATES}:
        raise ValueError('Signing cutover changed the image or unrelated secrets/environment')
    if set(after['NetworkSettings']['Networks']) != set(before['NetworkSettings']['Networks']) | set(NETWORKS.values()):
        raise ValueError('Signing cutover changed unrelated networks')
    if ALIAS not in (after['NetworkSettings']['Networks'][NETWORKS['owned_signing_callback_core']].get('Aliases') or []):
        raise ValueError('Exact private core callback alias required')
    retained = [mount for mount in after['Mounts'] if mount['Destination'] != trust.SERVICE_TARGET]
    if sorted(retained, key=lambda row: row['Destination']) != sorted(before['Mounts'], key=lambda row: row['Destination']):
        raise ValueError('Signing cutover changed existing storage or mounts')
    trust.public_ca_arguments(after)


def callback_alias_available():
    network = json.loads(mail.run(['docker', 'network', 'inspect', NETWORKS['owned_signing_callback_core']]))[0]
    if network['Internal'] is not True: raise ValueError('Internal callback network required')
    for identity in network.get('Containers', {}):
        info = json.loads(mail.run(['docker', 'inspect', identity]))[0]
        aliases = info['NetworkSettings']['Networks'][NETWORKS['owned_signing_callback_core']].get('Aliases') or []
        if ALIAS in aliases: raise ValueError('Retire the accepted synthetic QA callback alias before production attachment')


def probe_provider():
    code = "fetch('https://codexdentist-signing-gateway:3443/api/v2/envelope?perPage=1',{redirect:'error',signal:AbortSignal.timeout(10000)}).then(r=>{if(![401,403].includes(r.status))throw Error()}).catch(()=>process.exit(1))"
    mail.run(['docker', 'exec', CONTAINER, 'node', '-e', code])


def cutover(sha, apply=False):
    marker = ROOT / 'needs-attention.json'
    if marker.exists(): raise ValueError('Preserve unresolved deployment attention marker')
    before = json.loads(mail.run(['docker', 'inspect', CONTAINER]))[0]; environment = mail.runtime_environment(before)
    if not re.fullmatch('[a-f0-9]{40}', sha) or json.loads((ROOT / 'current.json').read_text())['sha'] != sha or before['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != sha:
        raise ValueError('Exact deployed revision required')
    if environment.get('NOTIFICATION_DELIVERY_MODE') != 'owned-mail' or environment.get('NODE_EXTRA_CA_CERTS') != trust.TARGET or environment.get('DOCUMENSO_SEND_OWNER_EMAILS') == 'false':
        raise ValueError('Accepted existing owned-mail stage and unused signing configuration required')
    # Activation follows, rather than reinterprets, existing clinical requests.
    query = '''const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,max:1});(async()=>{try{const r=await p.query(`SELECT count(*)::int n FROM "IntegrationConnection" WHERE provider='documenso'`);if(r.rows[0].n!==0)throw Error()}finally{await p.end()}})().catch(()=>process.exit(1));'''
    mail.run(['docker', 'exec', CONTAINER, 'node', '-e', query])
    smtp.signing.status(SIGNING); smtp.signing.health(SIGNING); smtp.smtp_network(True)
    accepted = json.loads((SIGNING / 'smtp.completed.json').read_text())
    if accepted.get('pass') is not True or accepted.get('globalAndQaMailCaptured') is not True:
        raise ValueError('Accepted main-only SMTP with QA capture required')
    attachments.require_accepted()
    smtp.client(smtp.admin_input(SIGNING, 'inspect'))
    callback_alias_available()
    for name in NETWORKS.values():
        if json.loads(mail.run(['docker', 'network', 'inspect', name]))[0]['Internal'] is not True:
            raise ValueError('Only reviewed internal signing networks allowed')
    env_file = COMPOSE.parent / 'env/codexdentist.env'
    original_env = env_file.read_bytes(); original_compose = COMPOSE.read_bytes()
    proposed_env = mail.environment_text(original_env.decode(), UPDATES).encode()
    proposed_compose = compose_text(original_compose.decode()).encode()
    mail.probe(environment['JOB_SECRET'], 'owned-mail')
    print(json.dumps({'revision': sha, 'sameImage': True, 'mainOnlySmtpAccepted': True, 'vaultBindings': 0,
        'privateCallbackAliasAvailable': True, 'externalMailSent': False, 'apply': apply}), flush=True)
    if not apply: return
    if Path(trust.SERVICE_SOURCE).parent.exists(): raise ValueError('Preserve retained signing app trust transition')
    deployer = load('signing_app_deployer', str(ROOT / 'deploy-hostinger.py')); deployer.backup_current()
    state = SIGNING / ('core-cutover-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())); state.mkdir(mode=0o700)
    for name, value in [('compose.before', original_compose), ('environment.before', original_env)]: mail.replace(state / name, value)
    bundle = b''
    for source, hostname in [(Path(trust.SOURCE), 'codexdentist-mail-gateway'), (GATEWAY / 'gateway.cert.pem', 'codexdentist-signing-gateway')]:
        if source.is_symlink() or not source.is_file(): raise ValueError('Owned public gateway certificate required')
        value = source.read_bytes()
        if b'PRIVATE KEY' in value or not value.startswith(b'-----BEGIN CERTIFICATE-----'): raise ValueError('Only public certificates enter core trust')
        mail.run(['openssl', 'x509', '-in', str(source), '-noout', '-checkend', '86400', '-checkhost', hostname])
        bundle += value.rstrip() + b'\n'
    Path(trust.SERVICE_SOURCE).parent.mkdir(mode=0o700)
    mail.replace(Path(trust.SERVICE_SOURCE), bundle); Path(trust.SERVICE_SOURCE).chmod(0o644)
    original_resolved = json.loads(mail.run(['docker', 'compose', '-f', str(COMPOSE), 'config', '--format', 'json']))
    operation = uuid.uuid4().hex
    evidence = {'operation': operation, 'type': 'owned-signing-app-cutover', 'sha': sha, 'recovery': str(state)}
    smtp.signing.private(marker, json.dumps(evidence).encode())
    try:
        mail.replace(env_file, proposed_env); mail.replace(COMPOSE, proposed_compose)
        equivalent_config(original_resolved, json.loads(mail.run(['docker', 'compose', '-f', str(COMPOSE), 'config', '--format', 'json'])))
        mail.recreate(); mail.wait(environment['JOB_SECRET'], 'owned-mail'); probe_provider()
        after = json.loads(mail.run(['docker', 'inspect', CONTAINER]))[0]; validate_runtime(before, after)
        mail.replace(state / 'accepted.json', json.dumps({**evidence, 'sameImage': True, 'mailReadinessPreserved': True,
            'strictPrivateSigningTls': True, 'vaultBindings': 0, 'externalMailSent': False}).encode())
        if json.loads(marker.read_text()).get('operation') != operation: raise ValueError('Preserve foreign attention marker')
        marker.unlink()
        print('PASS same-image private signing attachment and preserved mail/storage; tenant vault binding remains next.')
    except BaseException:
        if COMPOSE.read_bytes() not in [original_compose, proposed_compose] or env_file.read_bytes() not in [original_env, proposed_env]:
            raise ValueError('Preserve foreign configuration changes during signing rollback')
        mail.replace(env_file, original_env); mail.replace(COMPOSE, original_compose); mail.recreate(); mail.wait(environment['JOB_SECRET'], 'owned-mail')
        mail.replace(state / 'rolled-back.json', json.dumps(evidence).encode())
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--sha', required=True); parser.add_argument('--apply', action='store_true'); args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Reviewed root-owned cutover required')
    os.umask(0o077)
    import fcntl
    # Match provider backup's provider -> gateway -> callback lock order.
    with (ROOT / 'deploy.lock').open('a') as deploy, (SIGNING / 'operations.lock').open('a') as provider, (GATEWAY / 'operations.lock').open('a') as gateway, (Path('/opt/codexdentist-signing-callback') / 'operations.lock').open('a') as callback, (Path('/opt/codexdentist-owned-mail') / 'operations.lock').open('a') as mail_lock:
        for lock in [deploy, provider, gateway, callback, mail_lock]: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        cutover(args.sha, args.apply)


if __name__ == '__main__': main()
