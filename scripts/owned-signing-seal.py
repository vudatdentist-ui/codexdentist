#!/usr/bin/env python3
"""Encrypt verified signing recovery for owner custody; verify without plaintext files."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''): digest.update(chunk)
    return digest.hexdigest()


def certificate(openssl, path, pin):
    if not re.fullmatch(r'[A-F0-9]{64}', pin): raise ValueError('Exact public recipient SHA-256 required')
    result = subprocess.run([openssl, 'x509', '-in', str(path), '-outform', 'DER'], capture_output=True)
    if result.returncode or hashlib.sha256(result.stdout).hexdigest().upper() != pin:
        raise ValueError('Preserve recovery: recipient certificate identity differs')


def recovery_module():
    spec = importlib.util.spec_from_file_location('signing_recovery', Path(__file__).with_name('owned-signing-backup.py'))
    recovery = importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)
    return recovery


def authenticated_envelope(path):
    # ContentInfo must declare RFC 5083 AuthEnvelopedData (1.2.840.113549.1.9.16.1.23).
    # OpenSSL then verifies its authentication tag before we publish proof. A
    # generic CMS decrypt also accepts unauthenticated CBC EnvelopedData.
    with path.open('rb') as source: header = source.read(32)
    if len(header) < 2 or header[0] != 0x30: raise ValueError('Authenticated CMS envelope required')
    length = header[1]; index = 2
    if length > 0x80:
        if length & 0x7f > 4: raise ValueError('Unsupported CMS header')
        index += length & 0x7f
    oid = bytes.fromhex('060b2a864886f70d0109100117')
    if header[index:index + len(oid)] != oid: raise ValueError('Authenticated CMS envelope required')


def seal(snapshot, recipient, pin, openssl):
    if not hasattr(os, 'geteuid') or os.geteuid() != 0: raise ValueError('Root-owned signing recovery required')
    recovery = recovery_module()
    manifest = recovery.validate_snapshot(snapshot)
    proof = json.loads((snapshot / 'restore-verified.json').read_text())
    for name in ['allHashes', 'ownershipAndModes', 'applicationConfigurationUsable', 'databaseCounts', 'cacheAuthenticationAndAof', 'certificatePassphrase']:
        if proof.get(name) is not True: raise ValueError('Complete signing restoration must precede encryption')
    if proof.get('appOrMailWorkersStarted') is not False: raise ValueError('Restored workers must never start')
    if set(recovery.GATEWAY) <= set(manifest['files']) and proof.get('gatewayConfigurationUsable') is not True:
        raise ValueError('Gateway key/configuration recovery must pass too')
    if set(recovery.RECIPIENT) <= set(manifest['files']) and proof.get('recipientConfigurationUsable') is not True:
        raise ValueError('Recipient configuration recovery must pass too')
    certificate(openssl, recipient, pin)
    allowed = set(manifest['files']) | {'database.tar', 'cache.tar', 'backup-manifest.json', 'restore-verified.json'}
    actual = {path.relative_to(snapshot).as_posix() for path in snapshot.rglob('*') if path.is_file()}
    if actual != allowed or any(path.is_symlink() or not (path.is_file() or path.is_dir() and path in [snapshot / 'gateway', snapshot / 'recipient']) for path in snapshot.rglob('*')):
        raise ValueError('Unexpected signing snapshot content; preserve for review')
    root = recovery.ROOT / 'sealed-snapshots'; root.mkdir(mode=0o700, exist_ok=True)
    target = root / (snapshot.name + '.cms'); partial = target.with_suffix('.cms.partial'); metadata = target.with_suffix('.cms.json')
    if any(path.exists() for path in [target, partial, metadata]): raise ValueError('Preserve existing encrypted recovery evidence')
    digest = hashlib.sha256(); size = 0
    with tempfile.TemporaryFile() as errors:
        archive = subprocess.Popen(['tar', '--format=posix', '-cf', '-', '-C', str(snapshot.parent), snapshot.name], stdout=subprocess.PIPE, stderr=errors)
        encrypted = None
        try:
            encrypted = subprocess.Popen([openssl, 'cms', '-encrypt', '-binary', '-aes-256-gcm', '-stream', '-outform', 'DER', '-out', str(partial),
                '-recip', str(recipient), '-keyopt', 'rsa_padding_mode:oaep', '-keyopt', 'rsa_oaep_md:sha256', '-keyopt', 'rsa_mgf1_md:sha256'], stdin=subprocess.PIPE, stderr=errors)
            for chunk in iter(lambda: archive.stdout.read(1024 * 1024), b''):
                digest.update(chunk); size += len(chunk); encrypted.stdin.write(chunk)
            encrypted.stdin.close()
            if archive.wait() or encrypted.wait(): raise RuntimeError('Signing encryption failed; preserve original and partial')
        finally:
            archive.stdout.close()
            for process in [archive, encrypted]:
                if process is not None and process.poll() is None: process.terminate(); process.wait()
    authenticated_envelope(partial)
    os.replace(partial, target); target.chmod(0o600)
    record = {'version': 1, 'snapshot': snapshot.name, 'ciphertext': target.name, 'cipherSha256': checksum(target),
        'plaintextTarSha256': digest.hexdigest(), 'plaintextBytes': size, 'recipientSha256': pin,
        'format': 'CMS AES-256-GCM / RSA-OAEP-SHA256', 'signingRestoreVerified': True, 'images': manifest['images']}
    recovery.signing.private(metadata, json.dumps(record).encode())
    print(json.dumps({'sealed': True, 'ciphertext': target.name, 'recipientPrivateKeyUsed': False}))


def verify(target, recipient, private_key, pin, openssl):
    certificate(openssl, recipient, pin)
    metadata = json.loads(target.with_suffix('.cms.json').read_text())
    if metadata.get('version') != 1 or metadata.get('signingRestoreVerified') is not True or metadata.get('recipientSha256') != pin or metadata.get('ciphertext') != target.name or not re.fullmatch(r'[0-9TZ]+-[a-f0-9]{8}', metadata.get('snapshot', '')):
        raise ValueError('Signing recovery identity differs')
    if checksum(target) != metadata['cipherSha256']: raise ValueError('Encrypted signing recovery checksum differs')
    authenticated_envelope(target)
    digest = hashlib.sha256(); total = 0
    class Reader:
        def __init__(self, source): self.source = source
        def read(self, size=-1):
            nonlocal total
            value = self.source.read(size); digest.update(value); total += len(value); return value
    hashes = {}; manifest = None; proof = None
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen([openssl, 'cms', '-decrypt', '-binary', '-inform', 'DER', '-in', str(target),
            '-inkey', str(private_key), '-recip', str(recipient)], stdout=subprocess.PIPE, stderr=errors)
        reader = Reader(process.stdout)
        try:
            with tarfile.open(fileobj=reader, mode='r|') as archive:
                for member in archive:
                    path = PurePosixPath(member.name)
                    if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != metadata['snapshot'] or not (member.isfile() or member.isdir()):
                        raise ValueError('Unsafe signing recovery archive')
                    if not member.isfile(): continue
                    name = '/'.join(path.parts[1:])
                    if name in hashes: raise ValueError('Duplicate recovery entry')
                    stream = archive.extractfile(member); hashed = hashlib.sha256(); body = []
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        hashed.update(chunk)
                        if name in ['backup-manifest.json', 'restore-verified.json']:
                            if member.size > 16 * 1024 * 1024: raise ValueError('Recovery manifest too large')
                            body.append(chunk)
                    hashes[name] = hashed.hexdigest()
                    if name == 'backup-manifest.json': manifest = json.loads(b''.join(body))
                    if name == 'restore-verified.json': proof = json.loads(b''.join(body))
            while reader.read(1024 * 1024): pass
            if process.wait(): raise ValueError('Authenticated signing decryption failed')
        finally:
            process.stdout.close()
            if process.poll() is None: process.terminate(); process.wait()
    if total != metadata['plaintextBytes'] or digest.hexdigest() != metadata['plaintextTarSha256'] or not manifest or not proof:
        raise ValueError('Recovered signing archive differs')
    recovery = recovery_module(); present = set(manifest.get('files', {}))
    if manifest.get('version') != 1 or manifest.get('images') != metadata['images'] or manifest['images'] != recovery.signing.IMAGES or set(manifest.get('volumes', {})) != {'database', 'cache'} or not set(recovery.CONFIG) <= present or not present <= set(recovery.CONFIG + recovery.BOOTSTRAP + recovery.GATEWAY + recovery.RECIPIENT) or (present & set(recovery.GATEWAY) and not set(recovery.GATEWAY) <= present) or (present & set(recovery.RECIPIENT) and not set(recovery.RECIPIENT) <= present):
        raise ValueError('Recovered signing manifest differs')
    if set(hashes) != present | {'database.tar', 'cache.tar', 'backup-manifest.json', 'restore-verified.json'}:
        raise ValueError('Recovered signing files differ')
    if set(manifest.get('fileMetadata', {})) != present: raise ValueError('Recovered configuration metadata missing')
    for name, record in manifest['volumes'].items():
        if hashes.get(name + '.tar') != record['sha256']: raise ValueError('Recovered volume checksum differs')
    for name, expected in manifest['files'].items():
        if hashes.get(name) != expected: raise ValueError('Recovered private configuration/key checksum differs')
        owner = recovery.config_owner(name)
        if manifest['fileMetadata'][name] != {'uid': owner, 'gid': owner, 'mode': 0o600}:
            raise ValueError('Recovered configuration custody differs')
    for name in ['allHashes', 'ownershipAndModes', 'applicationConfigurationUsable', 'databaseCounts', 'cacheAuthenticationAndAof', 'certificatePassphrase']:
        if proof.get(name) is not True: raise ValueError('Signing recovery acceptance missing')
    if proof.get('appOrMailWorkersStarted') is not False: raise ValueError('Signing recovery worker isolation differs')
    if present & set(recovery.GATEWAY) and proof.get('gatewayConfigurationUsable') is not True:
        raise ValueError('Gateway recovery acceptance missing')
    if present & set(recovery.RECIPIENT) and proof.get('recipientConfigurationUsable') is not True:
        raise ValueError('Recipient recovery acceptance missing')
    accepted = {'pass': True, 'authenticatedDecryption': True, 'allVolumeAndPrivateKeyChecksums': True,
        'plaintextStoredOnDisk': False, 'snapshot': metadata['snapshot']}
    destination = target.with_suffix('.restore-proof.json')
    if destination.exists():
        if destination.is_symlink() or json.loads(destination.read_text()) != accepted: raise ValueError('Preserve changed off-server recovery evidence')
    else:
        with destination.open('x', encoding='utf-8') as output: json.dump(accepted, output)
    print(json.dumps(accepted))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['seal', 'verify']); parser.add_argument('--recipient-cert', required=True)
    parser.add_argument('--recipient-sha256', required=True); parser.add_argument('--openssl', default=shutil.which('openssl'))
    parser.add_argument('--snapshot'); parser.add_argument('--ciphertext'); parser.add_argument('--private-key'); args = parser.parse_args()
    if not args.openssl: raise ValueError('Use the installed OpenSSL executable explicitly')
    os.umask(0o077)
    if args.action == 'seal':
        if not args.snapshot or args.ciphertext or args.private_key: raise ValueError('Seal uses only a snapshot and public recipient certificate')
        root = Path('/opt/codexdentist-owned-signing')
        if not hasattr(os, 'geteuid') or os.geteuid() != 0 or root.is_symlink() or root.stat().st_uid != 0 or root.stat().st_mode & 0o077:
            raise ValueError('Private root-owned signing recovery required')
        import fcntl
        with (root / 'operations.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            seal(Path(args.snapshot), Path(args.recipient_cert), args.recipient_sha256, args.openssl)
    else:
        if not args.ciphertext or not args.private_key or args.snapshot: raise ValueError('Verify on the owned recovery computer with its existing private key')
        verify(Path(args.ciphertext), Path(args.recipient_cert), Path(args.private_key), args.recipient_sha256, args.openssl)


if __name__ == '__main__': main()
