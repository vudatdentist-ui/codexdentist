#!/usr/bin/env python3
"""Exact same-image MTA size/buffering transition; no mail submission."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import uuid


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


activation = load('mime_activation', 'owned-mail-activation.py')
mail = activation.mail
backup = load('mime_backup', 'owned-mail-backup.py')


def exact_delta(before, after):
    if before.count('    max_message_size 96K\n') != 1 or before.count('    buffer ram\n') != 1:
        raise ValueError('Review an existing attachment-capable or changed MTA configuration')
    expected = before.replace('    max_message_size 96K\n', '    max_message_size 80M\n').replace(
        '    buffer ram\n', '    buffer auto 1M /data/buffer\n')
    if after != expected: raise ValueError('Only bounded size and private disk buffering may change')


def replace(path, data):
    identity = path.stat(); temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.new')
    mail.write_private(temporary, data); os.chown(temporary, identity.st_uid, identity.st_gid); os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def same_runtime(before, after):
    old_config = json.loads(json.dumps({key: value for key, value in before['Config'].items() if key != 'Hostname'}))
    new_config = json.loads(json.dumps({key: value for key, value in after['Config'].items() if key != 'Hostname'}))
    if new_config.get('Labels', {}).get('com.docker.compose.replace') != before['Id']:
        raise ValueError('Exact prior MTA container replacement identity required')
    for config in [old_config, new_config]: config.get('Labels', {}).pop('com.docker.compose.replace', None)
    if after['Image'] != before['Image'] or after['HostConfig'] != before['HostConfig'] or old_config != new_config or set(after['NetworkSettings']['Networks']) != set(before['NetworkSettings']['Networks']):
        raise ValueError('MTA image, mounts, ports, limits, networks or credentials changed')


def probe_limit():
    source = Path(__file__).with_name('owned-mail-smtp-size.cjs').read_text()
    source += "\nmodule.exports.probe({host:'codexdentist-mail-smtp',ca:require('node:fs').readFileSync('/secrets/smtp.cert.pem')}).then(r=>console.log(JSON.stringify(r))).catch(()=>process.exitCode=1);"
    value = json.loads(mail.run(['docker', 'exec', mail.PROJECT + '-gateway-1', 'node', '-e', source]))
    if value != {'pass': True, 'smtpMaxBytes': 80 * 1024 * 1024, 'declaredOversizeDenied': True, 'messageSubmitted': False}:
        raise ValueError('Actual MTA attachment size boundary differs')


def upgrade(sha, apply=False):
    if not re.fullmatch('[a-f0-9]{40}', sha): raise ValueError('Reviewed exact configuration revision required')
    source = activation.RELEASES / sha
    if mail.run(['git', '-C', str(source), 'rev-parse', 'HEAD']).decode().strip() != sha or mail.run(['git', '-C', str(source), 'status', '--porcelain']).strip():
        raise ValueError('Clean exact-revision release source required')
    directory = mail.ROOT; pin = json.loads((directory / 'manifest.json').read_text())
    activation.validate_stage(directory, pin)
    if pin.get('outboundEnabled') is not True or pin.get('configRevision'): raise ValueError('Accepted existing owned SMTP stage required')
    before = (directory / 'maddy.conf').read_bytes(); before_manifest = (directory / 'manifest.json').read_bytes()
    original = (source / 'scripts/owned-mail/maddy.conf').read_text()
    proposed = original.replace('hostname mail.codexdentist.com', 'hostname ' + pin['outboundHostname']).encode()
    exact_delta(before.decode(), proposed.decode())
    state = directory / ('attachment-upgrade-' + sha[:12])
    if state.exists(): raise FileExistsError('Preserve retained attachment transition evidence; do not replay')
    identities = {name: json.loads(mail.run(['docker', 'inspect', mail.PROJECT + '-' + name + '-1']))[0]
        for name in ['gateway', 'smtp']}
    if identities['smtp']['Config']['Image'] != mail.MADDY or identities['gateway']['Image'] != pin['gatewayImage']:
        raise ValueError('Exact original mail images required')
    activation.ready(directory, pin)
    print(json.dumps({'sameImages': True, 'gatewayRequestLimitUnchanged': True, 'maxSmtpBytes': 80 * 1024 * 1024,
        'privateDiskBufferAboveBytes': 1024 * 1024, 'noMessageSent': True, 'apply': apply}), flush=True)
    if not apply: return
    snapshot = backup.backup(); backup.drill(snapshot)
    if (directory / 'maddy.conf').read_bytes() != before or (directory / 'manifest.json').read_bytes() != before_manifest:
        raise ValueError('Preserve concurrent mail configuration changes')
    state.mkdir(mode=0o700)
    for name, data in [('maddy.before.conf', before), ('manifest.before.json', before_manifest),
            ('intent.json', json.dumps({'sha': sha, 'snapshotBefore': str(snapshot)}).encode())]: mail.write_private(state / name, data)
    proposed_manifest = json.dumps({**pin, 'configRevision': sha, 'sourceConfigSha256': hashlib.sha256(original.encode()).hexdigest()}).encode()
    def recreate(): mail.run(['docker', 'compose', '--project-directory', str(directory), '-f', str(directory / 'compose.json'),
        'up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', 'smtp'])
    try:
        replace(directory / 'maddy.conf', proposed); replace(directory / 'manifest.json', proposed_manifest); recreate()
        activation.validate_stage(directory, json.loads(proposed_manifest)); activation.ready(directory, pin); probe_limit()
        after = json.loads(mail.run(['docker', 'inspect', mail.PROJECT + '-smtp-1']))[0]
        same_runtime(identities['smtp'], after)
        gateway = json.loads(mail.run(['docker', 'inspect', mail.PROJECT + '-gateway-1']))[0]
        if gateway['Id'] != identities['gateway']['Id']: raise ValueError('Unrelated gateway was recreated')
    except BaseException:
        for path, old, new in [(directory / 'maddy.conf', before, proposed), (directory / 'manifest.json', before_manifest, proposed_manifest)]:
            if path.is_symlink() or path.read_bytes() not in [old, new]: raise ValueError('Preserve foreign mail changes during attachment rollback')
        replace(directory / 'maddy.conf', before); replace(directory / 'manifest.json', before_manifest); recreate(); activation.ready(directory, pin)
        mail.write_private(state / 'rolled-back.json', json.dumps({'pass': True, 'previousConfigurationRestored': True}).encode())
        raise
    mail.write_private(state / 'accepted.json', json.dumps({'pass': True, 'sameImagesAndPrivateMounts': True,
        'gatewayRequestLimitUnchanged': True, 'privateDiskBuffering': True, 'actualSmtpSizeAndDenialVerified': True, 'noMessageSent': True}).encode())
    print('PASS attachment-capable bounded MTA; same images/keys/routes, private disk buffering and no message sent.')


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--sha', required=True); parser.add_argument('--apply', action='store_true'); args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Root-owned reviewed MTA transition required')
    os.umask(0o077)
    import fcntl
    with Path('/opt/codexdentist-deploy/deploy.lock').open('a') as deploy, (mail.ROOT / 'operations.lock').open('a') as lock:
        fcntl.flock(deploy, fcntl.LOCK_EX | fcntl.LOCK_NB); fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        upgrade(args.sha, args.apply)


if __name__ == '__main__': main()
