#!/usr/bin/env python3
"""Reviewed same-image email cutover; no message submission or queued-job replay."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import time
import urllib.request
import uuid

ROOT = Path('/opt/codexdentist-deploy')
MAIL = Path('/opt/codexdentist-owned-mail')
COMPOSE = Path('/opt/namecheap-migration/compose.yml')
CONTAINER = 'namecheap-migration-codexdentist-1'
NETWORK = 'codexdentist-owned-mail_gateway'
NETWORK_KEY = 'owned_mail_gateway'
CA_SOURCE = MAIL / 'core-trust/gateway.cert.pem'
CA_TARGET = '/run/codexdentist-mail-ca.pem'


def run(args, **kwargs):
    import subprocess
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if result.returncode: raise RuntimeError('Owned mail app cutover command failed; preserve private recovery state')
    return result.stdout


def compose_text(text):
    blocks = list(re.finditer(r'(?m)^  codexdentist:\s*\n(?:(?:^    [^\r\n]*|^[ \t]*)\n)*', text))
    if len(blocks) != 1: raise ValueError('Exactly one existing Codexdentist service required')
    block = blocks[0]; body = block.group()
    if NETWORK_KEY in text or str(CA_SOURCE) in text or CA_TARGET in text: raise ValueError('Preserve existing mail trust/network configuration')
    def append_list(body, key, values):
        lines = body.splitlines(keepends=True); positions = [index for index, line in enumerate(lines) if line == '    ' + key + ':\n']
        if len(positions) != 1: raise ValueError('Exactly one existing ' + key + ' list required')
        first = positions[0] + 1
        if first >= len(lines) or not re.match(r'^(    |      )- ', lines[first]): raise ValueError('Existing ' + key + ' sequence required')
        indent = lines[first].split('-', 1)[0]; end = first
        while end < len(lines) and (lines[end].startswith('      ') or lines[end].startswith('    - ')): end += 1
        lines[end:end] = [indent + line + '\n' for line in values]
        return ''.join(lines)
    body = append_list(body, 'networks', ['- ' + NETWORK_KEY])
    body = append_list(body, 'volumes', ['- type: bind', '  source: ' + str(CA_SOURCE), '  target: ' + CA_TARGET, '  read_only: true'])
    updated = text[:block.start()] + body + text[block.end():]
    updated, count = re.subn(r'(?m)^networks:\n', 'networks:\n  ' + NETWORK_KEY + ':\n    external: true\n    name: ' + NETWORK + '\n', updated)
    if count != 1: raise ValueError('Existing global networks required')
    return updated


def environment_text(text, updates):
    lines = text.splitlines()
    for key, value in updates.items():
        if not re.fullmatch('[A-Z_]+', key) or re.search(r'[\r\n\x00]', value): raise ValueError('Single-line controlled environment values required')
        positions = [index for index, line in enumerate(lines) if re.match(r'\s*(?:export\s+)?' + key + r'\s*=', line)]
        if len(positions) > 1: raise ValueError('Duplicate controlled environment setting')
        # These operator-owned values have no shell, dotenv interpolation or quotes.
        if not re.fullmatch(r'[A-Za-z0-9_:/@.\-]+', value): raise ValueError('Literal mail environment value required')
        replacement = key + '=' + value
        if positions: lines[positions[0]] = replacement
        else: lines.append(replacement)
    return '\n'.join(lines) + '\n'


def equivalent_config(before, after, updates):
    expected = json.loads(json.dumps(before)); service = expected['services']['codexdentist']
    if NETWORK_KEY in expected['networks'] or NETWORK_KEY in service['networks']: raise ValueError('Mail network already configured')
    expected['networks'][NETWORK_KEY] = {'name': NETWORK, 'ipam': {}, 'external': True}
    service['networks'][NETWORK_KEY] = None
    service['environment'].update(updates)
    service.setdefault('volumes', []).append({'type': 'bind', 'source': str(CA_SOURCE), 'target': CA_TARGET,
        'read_only': True})
    if after != expected: raise ValueError('Unexpected Compose change outside email environment/trust/network')


def runtime_environment(info): return dict(value.split('=', 1) for value in info['Config']['Env'])


def probe(secret, mode):
    headers = {'Host': 'codexdentist.com', 'User-Agent': 'codexdentist-production-health'}
    request = urllib.request.Request('http://127.0.0.1:3100/api/readiness', headers={**headers, 'x-job-secret': secret})
    with urllib.request.urlopen(request, timeout=15) as response: value = json.load(response)
    if any(row['status'] != 'ok' for row in value['checks']) or next(row for row in value['checks'] if row['name'] == 'notifications').get('details') != ('resend configured' if mode == 'resend' else mode):
        raise ValueError('Mail cutover readiness failed')
    with urllib.request.urlopen(urllib.request.Request('https://codexdentist.com/api/health', headers=headers), timeout=15) as response: value = json.load(response)
    if any(value.get(key) != 'ok' for key in ['status', 'database', 'schema']): raise ValueError('Public app health failed')


def wait(secret, mode):
    for attempt in range(40):
        try: probe(secret, mode); return
        except (OSError, ValueError, StopIteration):
            if attempt == 39: raise
            time.sleep(1)


def replace(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.new')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as output: output.write(value); output.flush(); os.fsync(output.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def recreate(): run(['docker', 'compose', '-f', str(COMPOSE), 'up', '-d', '--no-deps', '--pull', 'never', 'codexdentist'])


def validate_runtime(before, after, updates):
    old, actual = runtime_environment(before), runtime_environment(after)
    if after['Image'] != before['Image'] or actual != {**old, **updates}: raise ValueError('Effective image or unrelated environment changed')
    if set(after['NetworkSettings']['Networks']) != set(before['NetworkSettings']['Networks']) | {NETWORK}:
        raise ValueError('Unrelated runtime networks changed')
    mounts = [row for row in after['Mounts'] if row['Destination'] != CA_TARGET]
    if sorted(mounts, key=lambda row: row['Destination']) != sorted(before['Mounts'], key=lambda row: row['Destination']) or len(after['Mounts']) != len(mounts) + 1:
        raise ValueError('Unrelated runtime mounts changed')
    added = next(row for row in after['Mounts'] if row['Destination'] == CA_TARGET)
    if added['Type'] != 'bind' or added['Source'] != str(CA_SOURCE) or added['RW']: raise ValueError('Exact read-only public CA mount required')


def restore_if_owned(env_file, original_env, proposed_env, original_compose, proposed_compose, secret):
    if COMPOSE.read_bytes() not in [original_compose, proposed_compose] or env_file.read_bytes() not in [original_env, proposed_env]:
        raise ValueError('Preserve unexpected concurrent configuration; review retained recovery evidence')
    replace(env_file, original_env); replace(COMPOSE, original_compose); recreate(); wait(secret, 'resend')
    print('Restored previous email environment and Compose; attention evidence retained for review.', flush=True)


def cutover(sha, apply=False):
    marker = ROOT / 'needs-attention.json'
    if marker.exists(): raise ValueError('Preserve unresolved deployment attention marker')
    before = json.loads(run(['docker', 'inspect', CONTAINER]))[0]; old = runtime_environment(before)
    if not re.fullmatch('[a-f0-9]{40}', sha) or json.loads((ROOT / 'current.json').read_text())['sha'] != sha or before['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != sha:
        raise ValueError('Exact deployed image/revision required')
    if old.get('NOTIFICATION_DELIVERY_MODE') != 'resend' or old.get('NODE_EXTRA_CA_CERTS') or any(key.startswith('OWNED_MAIL_') for key in old):
        raise ValueError('Preserve existing mail or extra trust configuration for review')
    accepted = json.loads((MAIL / 'owner-approved-test-20261110/gmail-acceptance.json').read_text())
    if any(accepted.get(key) != 'PASS' for key in ['spf', 'dkim', 'dmarc']) or accepted.get('inbox') is not True or accepted.get('messagesApproved') != 1 or accepted.get('messagesSubmitted') != 1:
        raise ValueError('Exact approved external inbox acceptance required')
    if json.loads((MAIL / 'manifest.json').read_text()).get('outboundEnabled') is not True:
        raise ValueError('Accepted owned SMTP outbound stage required')
    if json.loads(run(['docker', 'network', 'inspect', NETWORK]))[0]['Internal'] is not True: raise ValueError('Private gateway network required')
    # Do not reinterpret an in-flight acknowledgement from the old provider.
    query = '''const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,max:1});(async()=>{try{const r=await p.query(`SELECT count(*)::int n FROM "Notification" WHERE channel=$1 AND status=$2`,['EMAIL','PROCESSING']);if(r.rows[0].n)throw Error()}finally{await p.end()}})().catch(()=>process.exitCode=1);'''
    run(['docker', 'exec', CONTAINER, 'node', '-e', query]); probe(old['JOB_SECRET'], 'resend')
    secret = (MAIL / 'secrets/signing.secret').read_text().strip()
    if not re.fullmatch('[a-f0-9]{64}', secret): raise ValueError('Exact generated mail signing secret required')
    updates = {'NOTIFICATION_DELIVERY_MODE': 'owned-mail', 'OWNED_MAIL_BASE_URL': 'https://codexdentist-mail-gateway:3443',
        'OWNED_MAIL_FROM': 'no-reply@codexdentist.com', 'OWNED_MAIL_SIGNING_SECRET': secret, 'NODE_EXTRA_CA_CERTS': CA_TARGET}
    env_file = COMPOSE.parent / 'env/codexdentist.env'; original_env = env_file.read_bytes(); original_compose = COMPOSE.read_bytes()
    proposed_env = environment_text(original_env.decode(), updates).encode(); proposed_compose = compose_text(original_compose.decode()).encode()
    print(json.dumps({'revision': sha, 'previousMode': 'resend', 'nextMode': 'owned-mail', 'publicCaOnly': True, 'sameImage': True, 'mailSubmitted': False, 'apply': apply}), flush=True)
    if not apply: return
    spec = importlib.util.spec_from_file_location('deployer', ROOT / 'deploy-hostinger.py')
    deployer = importlib.util.module_from_spec(spec); spec.loader.exec_module(deployer); deployer.backup_current()
    state = MAIL / ('app-cutover-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())); state.mkdir(mode=0o700)
    for name, value in [('compose.before', original_compose), ('environment.before', original_env)]: replace(state / name, value)
    trust = CA_SOURCE.parent
    if trust.exists(): raise ValueError('Preserve pre-existing app trust directory')
    trust.mkdir(mode=0o700)
    cert = MAIL / 'secrets/gateway.cert.pem'
    run(['openssl', 'x509', '-in', str(cert), '-noout'])
    value = cert.read_bytes()
    if b'PRIVATE KEY' in value or not value.startswith(b'-----BEGIN CERTIFICATE-----'): raise ValueError('Public gateway certificate only')
    replace(CA_SOURCE, value); CA_SOURCE.chmod(0o644)
    original_resolved = json.loads(run(['docker', 'compose', '-f', str(COMPOSE), 'config', '--format', 'json']))
    operation = uuid.uuid4().hex; evidence = {'operation': operation, 'type': 'owned-mail-app-cutover', 'sha': sha, 'recovery': str(state)}
    replace(marker, json.dumps(evidence).encode())
    try:
        replace(env_file, proposed_env); replace(COMPOSE, proposed_compose)
        resolved = json.loads(run(['docker', 'compose', '-f', str(COMPOSE), 'config', '--format', 'json']))
        equivalent_config(original_resolved, resolved, updates)
        recreate(); wait(old['JOB_SECRET'], 'owned-mail')
        after = json.loads(run(['docker', 'inspect', CONTAINER]))[0]; validate_runtime(before, after, updates)
        replace(state / 'accepted.json', json.dumps({**evidence, 'effectiveEnvironment': True, 'sameImage': True, 'unrelatedMountsNetworks': True, 'noMessageSent': True}).encode())
        if json.loads(marker.read_text()).get('operation') != operation: raise ValueError('Preserve foreign attention marker')
        marker.unlink(); print('PASS same-image owned email cutover, signed readiness and preserved unrelated state; no email sent.')
    except BaseException:
        restore_if_owned(env_file, original_env, proposed_env, original_compose, proposed_compose, old['JOB_SECRET'])
        raise


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--sha', required=True); parser.add_argument('--apply', action='store_true'); args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Reviewed root-owned operation required')
    os.umask(0o077)
    import fcntl
    with (ROOT / 'deploy.lock').open('a') as deployment, (MAIL / 'operations.lock').open('a') as mail:
        fcntl.flock(deployment, fcntl.LOCK_EX | fcntl.LOCK_NB); fcntl.flock(mail, fcntl.LOCK_EX | fcntl.LOCK_NB)
        cutover(args.sha, args.apply)


if __name__ == '__main__': main()
