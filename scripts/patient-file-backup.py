#!/usr/bin/env python3
"""Reviewed private file snapshot and worker-free restore drill. No source deletion."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import uuid

ROOT = Path('/opt/codexdentist-deploy/backups')
CONTAINER = 'namecheap-migration-codexdentist-1'
LABEL = 'com.codexdentist.storage'
TREE = r'''const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root='/snapshot',rows=[];
function walk(dir){for(const name of fs.readdirSync(dir).sort()){const p=path.join(dir,name),s=fs.lstatSync(p);
 if(s.isSymbolicLink()||(!s.isFile()&&!s.isDirectory()))throw Error('unsafe-storage-entry');
 if(s.uid!==1000||s.gid!==1000||(s.mode&0o777)!==(s.isDirectory()?0o700:0o600))throw Error('unsafe-storage-mode');
 rows.push([path.relative(root,p),s.isDirectory()?'directory':crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),s.isDirectory()?0:s.size,s.mode&0o777]);
 if(s.isDirectory())walk(p);}}
const s=fs.lstatSync(root);if(s.uid!==1000||(s.mode&0o777)!==0o700)throw Error('unsafe-root');
walk(root);console.log(JSON.stringify(rows));'''


def run(command, **kwargs):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        raise RuntimeError('Private file backup command failed; source preserved')
    return result.stdout


def inspect(kind, name):
    return json.loads(run(['docker', kind, 'inspect', name]))[0]


def owned_volume(container):
    env = dict(entry.split('=', 1) for entry in container['Config']['Env'])
    root = env.get('PATIENT_FILE_STORAGE_ROOT')
    if env.get('PATIENT_FILE_LOCAL_DURABLE') != 'true' or root != '/data/patient-files':
        raise ValueError('Explicit owned durable storage configuration required')
    mounts = [m for m in container['Mounts'] if m['Destination'] == root]
    if len(mounts) != 1 or mounts[0]['Type'] != 'volume' or not mounts[0]['RW']:
        raise ValueError('Exact writable named storage volume required')
    name = mounts[0]['Name']
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', name):
        raise ValueError('Invalid volume name')
    if inspect('volume', name).get('Labels', {}).get(LABEL) != 'patient-files':
        raise ValueError('Storage volume ownership label differs')
    return name


def command(image, volume, writable=False):
    return ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--memory', '512m', '--cpus', '1',
            *(['-i', '--user', '0:0', '--cap-add', 'CHOWN', '--cap-add', 'FOWNER', '--cap-add', 'DAC_OVERRIDE'] if writable else []),
            '--mount', f'type=volume,source={volume},target=/snapshot,volume-nocopy' + ('' if writable else ',readonly'),
            '--entrypoint']


def inventory(image, volume):
    return json.loads(run(command(image, volume) + ['node', image, '-e', TREE]))


def validate_archive(archive):
    for member in archive.getmembers():
        p = PurePosixPath(member.name)
        if p.is_absolute() or '..' in p.parts or not (member.isfile() or member.isdir()):
            raise ValueError('Unsafe file snapshot archive')


def checksum(target):
    digest = hashlib.sha256()
    with target.open('rb') as data:
        for chunk in iter(lambda: data.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def backup(snapshot):
    current = inspect('container', CONTAINER)
    if not current['State'].get('Paused'):
        raise ValueError('Pause the owned app during its coordinated database/file snapshot')
    volume, image = owned_volume(current), current['Image']
    snapshot.mkdir(mode=0o700)
    before = inventory(image, volume)
    target = snapshot / 'files.tar'
    with target.open('xb') as data:
        result = subprocess.run(command(image, volume) + ['tar', image, '--numeric-owner', '-cpf', '-', '-C', '/snapshot', '.'], stdout=data, stderr=subprocess.PIPE)
        if result.returncode:
            raise RuntimeError('Private archive failed; preserve source and partial backup')
    with tarfile.open(target) as archive:
        validate_archive(archive)
    if inventory(image, volume) != before:
        raise RuntimeError('Storage changed during snapshot')
    (snapshot / 'manifest.json').write_text(json.dumps(dict(version=1, image=image, volume=volume,
        sha256=checksum(target), entries=before)))
    print('Private file snapshot completed; original volume unchanged')


def drill(snapshot):
    manifest = json.loads((snapshot / 'manifest.json').read_text())
    target = snapshot / 'files.tar'
    if manifest['version'] != 1 or checksum(target) != manifest['sha256'] or not re.fullmatch(r'sha256:[a-f0-9]{64}', manifest['image']):
        raise ValueError('File snapshot checksum/image invalid')
    with tarfile.open(target) as archive:
        validate_archive(archive)
    volume = 'codexdentist-files-restore-' + uuid.uuid4().hex
    run(['docker', 'volume', 'create', '--label', 'com.codexdentist.restore=' + volume, volume])
    try:
        # No application, PostgreSQL, mail worker, public port or network starts.
        with target.open('rb') as data:
            run(command(manifest['image'], volume, True) + ['tar', manifest['image'], '--numeric-owner', '-xpf', '-', '-C', '/snapshot'], stdin=data)
        if inventory(manifest['image'], volume) != manifest['entries']:
            raise RuntimeError('Restored file checksums or private modes differ')
        (snapshot / 'restore-verified').write_text('All bytes and private modes verified in a separate networkless volume\n')
        print('Private file restore verified; no source volume or records changed')
    finally:
        if inspect('volume', volume).get('Labels', {}).get('com.codexdentist.restore') != volume:
            raise RuntimeError('Restore volume ownership differs; preserve for review')
        run(['docker', 'volume', 'rm', volume])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['backup', 'drill'])
    parser.add_argument('--snapshot', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Requires reviewed root-owned operator execution')
    os.umask(0o077)
    snapshot = Path(args.snapshot)
    if not snapshot.is_absolute() or snapshot.resolve() != snapshot or ROOT not in snapshot.parents or snapshot.parent == ROOT:
        raise ValueError('Snapshot must be inside its owned release backup directory')
    (backup if args.action == 'backup' else drill)(snapshot)


if __name__ == '__main__':
    main()
