#!/usr/bin/env python3
"""Actual pinned CE startup, restart, cold restore and corruption denial in isolation."""
import argparse
import importlib.util
import json
import os
import hashlib
from pathlib import Path
import shutil
import uuid


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def private_output(source, output):
    source, output = source.resolve(), output.resolve()
    if output == source or source in output.parents: raise ValueError('Keep private signing evidence outside the source/build tree')
    if output.exists(): raise ValueError('Preserve existing signing proof; choose a fresh private output')
    return output


def exercise(directory, app_image=None):
    signing = load('signing_linux', 'owned-signing-services.py')
    recovery = load('signing_recovery_linux', 'owned-signing-backup.py')
    bootstrap = load('signing_bootstrap_linux', 'owned-signing-bootstrap.py')
    seal = load('signing_seal_linux', 'owned-signing-seal.py')
    gateway = load('signing_gateway_linux', 'owned-signing-gateway.py')
    recipient = load('signing_recipient_linux', 'owned-signing-recipient.py')
    project = 'codexdentist-signing-test-' + uuid.uuid4().hex
    signing.PROJECT = project; signing.ROOT = directory
    recovery.signing = signing; recovery.ROOT = directory
    bootstrap.signing = signing; bootstrap.recovery = recovery; bootstrap.ROOT = directory
    seal.recovery_module = lambda: recovery
    gateway.ROOT = directory.parent / (project + '-gateway'); gateway.PROJECT = project + '-gateway'
    gateway.PROVIDER = directory; gateway.PROVIDER_PROJECT = project; gateway.PROBE_IMAGE = app_image
    recovery.GATEWAY_ROOT = gateway.ROOT
    recipient.gateway = gateway; recipient.ROOT = directory.parent / (project + '-recipient')
    recipient.PROJECT = project + '-recipient'; recipient.PROVIDER_PROJECT = project
    recipient.EDGE = recipient.PROJECT + '-edge'
    recovery.RECIPIENT_ROOT = recipient.ROOT
    command = ['docker', 'compose', '--project-directory', str(directory), '-f', str(directory / 'compose.json')]
    try:
        for image in signing.IMAGES.values(): signing.run(['docker', 'pull', image])
        signing.run(['docker', 'pull', gateway.IMAGE])
        signing.prepare(directory)
        signing.run(command + ['up', '-d', '--pull', 'never'])
        signing.status(directory); signing.health(directory)
        # Restart after Valkey has written private AOF files. The old root
        # entrypoint failed here despite Docker reporting Running=true.
        signing.run(['docker', 'stop', '--time', '30', project + '-app-1'])
        signing.run(['docker', 'restart', project + '-cache-1'])
        signing.run(['docker', 'start', project + '-app-1'])
        signing.status(directory); signing.health(directory)
        bootstrap.bootstrap(directory)
        wrong = json.loads((directory / 'bootstrap.credentials.json').read_text())
        wrong[0]['apiToken'], wrong[1]['apiToken'] = wrong[1]['apiToken'], wrong[0]['apiToken']
        try: bootstrap.client({'action': 'inspect', 'credentials': wrong})
        except RuntimeError: pass
        else: raise ValueError('Cross-owner signing API token substitution accepted')
        gateway.prepare(); gateway.installation()
        signing.run(['docker', 'compose', '--project-directory', str(gateway.ROOT), '-f', str(gateway.ROOT / 'compose.json'), 'up', '-d', '--pull', 'never'])
        gateway.status(); gateway.probe()
        signing.run(['docker', 'network', 'create', '--internal', '--label', 'com.codexdentist.recipient-proof=' + project, recipient.EDGE])
        recipient.prepare()
        signing.run(['docker', 'compose', '--project-directory', str(recipient.ROOT), '-f', str(recipient.ROOT / 'compose.json'), 'up', '-d', '--pull', 'never'])
        recipient.status(); recipient.probe()
        snapshot = recovery.backup(); recovery.drill(snapshot); recovery.drill(snapshot)
        # Synthetic recipient keys belong only to this private test namespace;
        # no real owner's recovery private key is ever uploaded to a server.
        recipient_certificate, private_key = directory / 'test-recipient.cert.pem', directory / 'test-recipient.key.pem'
        signing.run(['openssl', 'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '1',
            '-subj', '/CN=Synthetic CI recovery recipient', '-keyout', str(private_key), '-out', str(recipient_certificate)])
        pin = hashlib.sha256(signing.run(['openssl', 'x509', '-in', str(recipient_certificate), '-outform', 'DER'])).hexdigest().upper()
        seal.seal(snapshot, recipient_certificate, pin, 'openssl')
        seal.verify(directory / 'sealed-snapshots' / (snapshot.name + '.cms'), recipient_certificate, private_key, pin, 'openssl')
        # Corrupted keys or archives must fail before any restored service starts.
        for kind in ['key', 'archive']:
            target = directory / 'backups' / ('corrupt-' + kind); target.mkdir(mode=0o700)
            for name in list(json.loads((snapshot / 'backup-manifest.json').read_text())['files']) + ['backup-manifest.json']:
                (target / name).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                shutil.copyfile(snapshot / name, target / name); (target / name).chmod(0o600)
            if kind == 'key': (target / 'keys.json').write_bytes(b'corrupted private key copy')
            else: (target / 'database.tar').write_bytes(b'corrupted archive copy')
            try: recovery.validate_snapshot(target)
            except ValueError: pass
            else: raise RuntimeError('Corrupted signing recovery was accepted')
        signing.status(directory); signing.health(directory)
        proof = {'pass': True, 'images': signing.IMAGES, 'closedSignupApi': True, 'privateRestart': True,
            'separateVerifiedMainAndQaApis': True,
            'crossOwnerApiTokenSubstitutionDenied': True,
            'encryptedRecoveryAndAuthenticatedDecryption': True,
            'privateGatewayTlsAndRecipientSurface': True,
            'separateRecipientProcessAndRecovery': True,
            'authenticatedCache': True, 'allHashesAndModes': True, 'databaseCounts': True, 'cacheAofRecovery': True,
            'corruptedKeysAndArchiveDenied': True, 'externalMailSent': False, 'coreAccess': False, 'published': False}
    finally:
        if (recipient.ROOT / 'compose.json').is_file():
            signing.run(['docker', 'compose', '--project-directory', str(recipient.ROOT), '-f', str(recipient.ROOT / 'compose.json'), 'down', '--remove-orphans'])
        edge = __import__('subprocess').run(['docker', 'network', 'inspect', recipient.EDGE], capture_output=True)
        if edge.returncode == 0:
            if json.loads(edge.stdout)[0].get('Labels', {}).get('com.codexdentist.recipient-proof') != project: raise ValueError('Synthetic edge ownership differs')
            signing.run(['docker', 'network', 'rm', recipient.EDGE])
        if (gateway.ROOT / 'compose.json').is_file():
            signing.run(['docker', 'compose', '--project-directory', str(gateway.ROOT), '-f', str(gateway.ROOT / 'compose.json'), 'down', '--remove-orphans'])
        # Only this unique project's containers/volumes are eligible for cleanup.
        # Private evidence stays outside the build and is never an uploaded artifact.
        if (directory / 'compose.json').is_file():
            signing.run(command + ['down', '--remove-orphans'])
            for name in ['database', 'cache']:
                volume = project + '_' + name
                result = __import__('subprocess').run(['docker', 'volume', 'inspect', volume], capture_output=True)
                if result.returncode == 0:
                    info = json.loads(result.stdout)[0]
                    if info.get('Labels', {}).get('com.codexdentist.signing') != name: raise ValueError('Test volume ownership differs')
                    signing.run(['docker', 'volume', 'rm', volume])
    # Success includes cleanup. A failed finally must never leave a misleading
    # pass artifact while synthetic workers/volumes are still active.
    signing.private(directory / 'acceptance.json', json.dumps(proof).encode())
    print(json.dumps(proof))


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--source', required=True); parser.add_argument('--output', required=True); parser.add_argument('--image')
    args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Isolated signing Linux proof requires root')
    os.umask(0o077)
    directory = private_output(Path(args.source), Path(args.output))
    directory.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    exercise(directory, args.image)


if __name__ == '__main__': main()
