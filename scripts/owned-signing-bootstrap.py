#!/usr/bin/env python3
"""One-time private service accounts through CE APIs; never replay uncertainty."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import uuid

spec = importlib.util.spec_from_file_location('signing', Path(__file__).with_name('owned-signing-services.py'))
signing = importlib.util.module_from_spec(spec); spec.loader.exec_module(signing)
spec = importlib.util.spec_from_file_location('signing_recovery', Path(__file__).with_name('owned-signing-backup.py'))
recovery = importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)
ROOT = signing.ROOT
ACCOUNTS = [('main', 'signing-operator@codexdentist.com', 'Codexdentist signing service'),
    ('qa', 'signing-qa@codexdentist.com', 'Codexdentist synthetic acceptance')]
RECORDS = ['bootstrap.intent.json', 'bootstrap.before.json', 'bootstrap.api-result.json',
    'bootstrap.credentials.json', 'bootstrap.completed.json']


def client(value, record=None):
    code = Path(__file__).with_name('owned-signing-bootstrap-client.cjs').read_text()
    code += '\nmodule.exports.run(JSON.parse(require("node:fs").readFileSync(0,"utf8"))).catch(()=>{process.exitCode=1});'
    result = subprocess.run(['docker', 'exec', '-i', signing.PROJECT + '-app-1', 'node', '-e', code],
        input=json.dumps(value).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if record:
        # Keep acknowledged/partial tokens before checking process success. A
        # later failure must not discard the only plaintext acknowledgement.
        signing.private(record, result.stdout[:65536])
    if result.returncode or len(result.stdout) > 65536: raise RuntimeError('Private signing bootstrap failed; preserve its intent/result, never replay')
    return json.loads(result.stdout)


def apply(directory):
    signing.run(['docker', 'compose', '--project-directory', str(directory), '-f', str(directory / 'compose.json'),
        'up', '-d', '--no-deps', '--pull', 'never', 'app'])


def replace(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.new')
    signing.private(temporary, value); os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def private_members():
    wanted = {json.loads(signing.run(['docker', 'inspect', signing.PROJECT + '-' + name + '-1']))[0]['Id']
        for name in ['app', 'database', 'cache', 'capture']}
    network = json.loads(signing.run(['docker', 'network', 'inspect', signing.PROJECT + '_private']))[0]
    if network['Internal'] is not True or set(network['Containers']) != wanted:
        raise ValueError('Only the four reviewed private signing services may join bootstrap')


def temporary_runtime(expected):
    info = json.loads(signing.run(['docker', 'inspect', signing.PROJECT + '-app-1']))[0]
    environment = dict(value.split('=', 1) for value in info['Config']['Env'])
    if not info['State']['Running'] or info['State'].get('Restarting') or info['Config']['Image'] != signing.IMAGES['app'] or info['Config']['User'] != '1001:1001' or info['HostConfig'].get('PortBindings'):
        raise ValueError('Private bootstrap app isolation differs')
    if any(environment.get(key) != value for key, value in expected['services']['app']['environment'].items()):
        raise ValueError('Private bootstrap environment differs')
    private_members()


def credentials(value):
    if not isinstance(value, list) or len(value) != 2 or any(not isinstance(row, dict) for row in value) or {row.get('purpose') for row in value} != {'main', 'qa'}:
        raise ValueError('Exactly separate main/QA signing credentials required')
    for row in value:
        if set(row) != {'purpose', 'userId', 'teamId', 'tokenId', 'apiToken'} or any(type(row[key]) is not int or row[key] <= 0 for key in ['userId', 'teamId', 'tokenId']) or not isinstance(row['apiToken'], str) or not re.fullmatch(r'api_[A-Za-z0-9_-]{12,256}', row['apiToken']):
            raise ValueError('Signing service credential acknowledgement differs')
    for key in ['userId', 'teamId', 'tokenId', 'apiToken']:
        if len({row[key] for row in value}) != 2: raise ValueError('Signing identities must remain separate')
    return value


def bootstrap(directory):
    expected = signing.installation(directory); signing.status(directory); signing.health(directory); private_members()
    if any((directory / name).exists() for name in RECORDS): raise ValueError('Retained bootstrap evidence requires review; never replay signup or token creation')
    if client({'action': 'review'}) != {'seedOnly': True, 'envelopes': 0, 'teams': 2}: raise ValueError('Preserve nonempty signing installation')
    recovery.ROOT = directory; recovery.signing = signing
    snapshot = recovery.backup(); recovery.drill(snapshot)
    before = (directory / 'compose.json').read_bytes()
    intent = {'action': 'create', 'accounts': [{'purpose': purpose, 'email': email, 'name': name,
        'password': secrets.token_hex(32)} for purpose, email, name in ACCOUNTS]}
    signing.private(directory / 'bootstrap.intent.json', json.dumps(intent).encode())
    signing.private(directory / 'bootstrap.before.json', before)
    temporary = json.loads(json.dumps(expected)); temporary['services']['app']['environment']['NEXT_PUBLIC_DISABLE_SIGNUP'] = 'false'
    proposed = json.dumps(temporary).encode()
    try:
        replace(directory / 'compose.json', proposed); apply(directory); temporary_runtime(temporary)
        result = client(intent, directory / 'bootstrap.api-result.json')
        if result.get('pass') is not True or result.get('externalMailSent') is not False or result.get('separateTeams') is not True:
            raise ValueError('Private bootstrap acceptance differs')
        owned = credentials(result['completed'])
        signing.private(directory / 'bootstrap.credentials.json', json.dumps(owned).encode())
    finally:
        current = (directory / 'compose.json').read_bytes()
        if current == proposed: replace(directory / 'compose.json', before)
        elif current != before: raise ValueError('Preserve unexpected signing configuration; private bootstrap requires review')
        apply(directory); signing.status(directory); signing.health(directory)
    inspected = client({'action': 'inspect', 'credentials': owned})
    if inspected != {'pass': True, 'separateTeams': True, 'signupClosed': True, 'apiAvailable': True}:
        raise ValueError('Closed signing API acceptance differs')
    signing.private(directory / 'bootstrap.completed.json', json.dumps({'snapshotBefore': str(snapshot),
        'separateTeams': True, 'signupClosed': True, 'externalMailSent': False, 'applicationConnected': False}).encode())
    print('PASS private main/QA signing service bootstrap: separate verified APIs, closed signup, no external mail/core access.')


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['inspect', 'bootstrap']); args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Root-owned signing operator required')
    os.umask(0o077); signing.installation(ROOT)
    import fcntl
    with (ROOT / 'operations.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'bootstrap': bootstrap(ROOT)
        else:
            signing.status(ROOT); signing.health(ROOT)
            value = credentials(json.loads((ROOT / 'bootstrap.credentials.json').read_text()))
            result = client({'action': 'inspect', 'credentials': value})
            if result.get('pass') is not True: raise ValueError('Signing credential inspection failed')
            print('PASS closed private signing APIs; credential values withheld.')


if __name__ == '__main__': main()
